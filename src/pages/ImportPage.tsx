import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, AlertTriangle, X, Download, Loader2, Users, School as SchoolIcon } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Select } from '../components/common/Select';
import { Badge } from '../components/common/Badge';
import { useAppContext } from '../context/AppContext';
import { ContactRole } from '../types';
import {
  isValidEmail,
  downloadFile,
  describeFileRejection,
  formatBytes,
  MAX_UPLOAD_BYTES,
} from '../utils/helpers';
import { CONTACT_FIELD_OPTIONS, SCHOOL_FIELD_OPTIONS } from '../constants';
import {
  interpretCombinedWorkbook,
  looksLikeSpreadsheet,
  type ParsedRow,
} from '../utils/importParsing';
import { importContactsBulk } from '../services/contactsService';
import { importSchoolsBulk } from '../services/schoolsService';
import toast from 'react-hot-toast';

type ImportTab = 'contacts' | 'schools' | 'combined';

const ROLE_LOOKUP: Record<string, ContactRole> = {
  superintendent:          ContactRole.SUPERINTENDENT,
  principal:               ContactRole.PRINCIPAL,
  counselor:               ContactRole.COUNSELOR,
  cs_teacher:              ContactRole.CS_TEACHER,
  engineering_teacher:     ContactRole.ENGINEERING_TEACHER,
  math_teacher:            ContactRole.MATH_TEACHER,
  science_teacher:         ContactRole.SCIENCE_TEACHER,
  'cs teacher':                  ContactRole.CS_TEACHER,
  'computer science teacher':    ContactRole.CS_TEACHER,
  'computer science':            ContactRole.CS_TEACHER,
  'computing teacher':           ContactRole.CS_TEACHER,
  'engineering teacher':         ContactRole.ENGINEERING_TEACHER,
  engineering:                   ContactRole.ENGINEERING_TEACHER,
  'math teacher':                ContactRole.MATH_TEACHER,
  'mathematics teacher':         ContactRole.MATH_TEACHER,
  mathematics:                   ContactRole.MATH_TEACHER,
  math:                          ContactRole.MATH_TEACHER,
  'science teacher':             ContactRole.SCIENCE_TEACHER,
  science:                       ContactRole.SCIENCE_TEACHER,
  'guidance counselor':          ContactRole.COUNSELOR,
  'school counselor':            ContactRole.COUNSELOR,
  guidance:                      ContactRole.COUNSELOR,
  'district superintendent':     ContactRole.SUPERINTENDENT,
  supt:                          ContactRole.SUPERINTENDENT,
};

function resolveRole(value: string | undefined): ContactRole {
  if (!value) return ContactRole.COUNSELOR;
  return ROLE_LOOKUP[value.toLowerCase().trim()] ?? ContactRole.COUNSELOR;
}

/** Persistent, dismissible explanation of why an upload didn't work.
 *  Deliberately not a toast — toasts disappear after 3s and this is the only
 *  thing telling the user what went wrong. */
function UploadError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 p-4 rounded-lg border border-red-200 bg-red-50"
    >
      <AlertCircle size={18} className="text-error shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-error">That file couldn&rsquo;t be uploaded</p>
        <p className="text-sm text-neutral-700 mt-0.5">{message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="p-1 rounded hover:bg-red-100 text-neutral-500 shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}

/** Shared dropzone interior so the idle / dragging / reading states stay
 *  identical between the two upload areas. */
function DropzoneBody({
  isParsing,
  isDragActive,
  idleLabel,
  hint,
}: {
  isParsing: boolean;
  isDragActive: boolean;
  idleLabel: string;
  hint: string;
}) {
  if (isParsing) {
    return (
      <>
        <Loader2 className="w-12 h-12 mx-auto mb-4 text-siue-red animate-spin" />
        <p className="text-lg text-neutral-700 mb-2">Reading your file…</p>
        <p className="text-sm text-neutral-400">This can take a moment for large spreadsheets.</p>
      </>
    );
  }
  return (
    <>
      <Upload className="w-12 h-12 mx-auto mb-4 text-neutral-400" />
      <p className="text-lg text-neutral-700 mb-2">
        {isDragActive ? 'Drop file here' : idleLabel}
      </p>
      <p className="text-sm text-neutral-400">{hint}</p>
    </>
  );
}

interface ValidationResult {
  row: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

interface CombinedPreview {
  schoolRows: ParsedRow[];
  contactRows: ParsedRow[];
  duplicateNames: string[];
  fileName: string;
  schoolSheetName: string;
  contactSheetName: string | null;
  warnings: string[];
}

export function ImportPage() {
  const { state, dispatch, addSchoolsBulk } = useAppContext();

  // Single-entity import state
  const [activeTab, setActiveTab] = useState<ImportTab>('combined');
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<ValidationResult[]>([]);
  const [fileName, setFileName] = useState('');
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'done'>('upload');
  const [isImporting, setIsImporting] = useState(false);

  // Shared upload feedback. Only one tab is active at a time, and both reset
  // helpers clear these, so a single pair covers every dropzone on the page.
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Combined import state
  const [combinedPreview, setCombinedPreview] = useState<CombinedPreview | null>(null);
  const [combinedStep, setCombinedStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [combinedResult, setCombinedResult] = useState<{
    schoolsCreated: number; schoolsUpdated: number; schoolsFailed: number;
    contactsCreated: number; contactsUpdated: number; contactsFailed: number;
  } | null>(null);

  const fieldOptions = activeTab === 'contacts' ? CONTACT_FIELD_OPTIONS : SCHOOL_FIELD_OPTIONS;

  // ── Combined import helpers ─────────────────────────────────────────────────

  const parseCombinedFile = useCallback(
    (file: File) => {
      setParseError(null);
      setIsParsing(true);

      const reader = new FileReader();

      reader.onerror = () => {
        setIsParsing(false);
        setParseError(
          `We couldn't read "${file.name}". The file may be in use by another program — close it in Excel and try again.`
        );
      };

      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) throw new Error('empty read result');

          const bytes = new Uint8Array(data as ArrayBuffer);
          const workbook = XLSX.read(bytes, { type: 'array' });
          const result = interpretCombinedWorkbook(
            workbook,
            state.schools.map((s) => s.name)
          );

          if (!result.ok) {
            setIsParsing(false);
            // XLSX.read turns junk into an empty workbook rather than throwing,
            // so distinguish "not really a spreadsheet" from "genuinely empty".
            setParseError(
              !looksLikeSpreadsheet(bytes)
                ? `"${file.name}" doesn't look like a real Excel file, even though it's named like one. Try opening it in Excel and re-saving it as .xlsx, then upload again.`
                : result.reason === 'no-sheets'
                  ? `"${file.name}" has no sheets in it. Check you uploaded the right file.`
                  : `"${file.name}" doesn't contain any data rows. Make sure the first row is a header (name, county, city…) with at least one row of data beneath it.`
            );
            return;
          }

          setCombinedPreview({ ...result.data, fileName: file.name });
          setIsParsing(false);
          setCombinedStep('preview');
        } catch (err) {
          console.error('Combined file parse failed:', err);
          setIsParsing(false);
          setParseError(
            `We couldn't read "${file.name}". It may be damaged or not a real Excel file. Try opening it in Excel and re-saving it as .xlsx, then upload again.`
          );
        }
      };

      reader.readAsArrayBuffer(file);
    },
    [state.schools]
  );

  const handleCombinedImport = async () => {
    if (!combinedPreview) return;
    setIsImporting(true);
    try {
      // ── Schools ──────────────────────────────────────────────────────────────
      // importSchoolsBulk does a fresh DB pre-fetch so it handles duplicates
      // correctly even across sessions (not relying on potentially-stale state).
      const schoolResult = await importSchoolsBulk(
        combinedPreview.schoolRows
          .filter((r) => (r['name'] as string)?.trim())
          .map((r) => ({
            name: (r['name'] as string).trim(),
            district: (r['district'] as string) || undefined,
            county: (r['county'] as string) || '',
            address: (r['address'] as string) || '',
            city: (r['city'] as string) || '',
            state: (r['state'] as string) || 'IL',
            zipCode: (r['zipCode'] as string) || '',
            schoolType: ((r['schoolType'] as string) || '')
              .toLowerCase()
              .includes('middle')
              ? 'middle_school'
              : 'high_school',
          }))
      );

      // Dispatch only newly created schools — importSchoolsBulk returns new ones first
      dispatch({ type: 'ADD_SCHOOLS_BULK', payload: schoolResult.schools.slice(0, schoolResult.created) });

      // Build name→id map from ALL schools (new + existing returned by importSchoolsBulk)
      const nameToId = new Map<string, string>();
      for (const s of state.schools) nameToId.set(s.name.toLowerCase(), s.id);
      for (const s of schoolResult.schools) nameToId.set(s.name.toLowerCase(), s.id);

      // ── Contacts ─────────────────────────────────────────────────────────────
      const contactsToImport = combinedPreview.contactRows
        .map((r) => ({
          firstName: (r['firstName'] as string) || '',
          lastName: (r['lastName'] as string) || '',
          email: ((r['email'] as string) || '').trim(),
          phone: (r['phone'] as string) || undefined,
          role: resolveRole(r['role'] as string),
          schoolId: nameToId.get(((r['schoolName'] as string) || '').toLowerCase()) ?? '',
        }))
        .filter((c) => c.firstName && c.email && isValidEmail(c.email));

      const contactResult = await importContactsBulk(contactsToImport);

      // Dispatch newly created contacts only
      dispatch({ type: 'ADD_CONTACTS_BULK', payload: contactResult.contacts.slice(0, contactResult.created) });

      const stats = {
        schoolsCreated: schoolResult.created,
        schoolsUpdated: schoolResult.updated,
        schoolsFailed: schoolResult.failed,
        contactsCreated: contactResult.created,
        contactsUpdated: contactResult.updated,
        contactsFailed: contactResult.failed,
      };

      setCombinedResult(stats);
      setCombinedStep('done');

      const totalNew = stats.schoolsCreated + stats.contactsCreated;
      const totalUpdated = stats.schoolsUpdated + stats.contactsUpdated;
      const totalFailed = stats.schoolsFailed + stats.contactsFailed;

      if (totalFailed === 0) {
        toast.success(`Import complete — ${totalNew} new, ${totalUpdated} updated`);
      } else {
        toast.error(
          `Import finished, but ${totalFailed} record${totalFailed !== 1 ? 's' : ''} couldn't be saved. See the summary below.`
        );
      }
    } catch (err) {
      console.error('Combined import failed:', err);
      setParseError(
        'The import could not be completed and nothing was saved. Check your internet connection and try again.'
      );
      setCombinedStep('upload');
      toast.error('Import failed — nothing was saved');
    } finally {
      setIsImporting(false);
    }
  };

  const resetCombined = () => {
    setCombinedPreview(null);
    setCombinedStep('upload');
    setCombinedResult(null);
    setIsParsing(false);
    setParseError(null);
  };

  // ── Single-entity import helpers ────────────────────────────────────────────

  const parseFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      setParseError(null);
      setIsParsing(true);

      // Shared landing point for both CSV and Excel once rows are in hand.
      // `notASpreadsheet` is only ever true on the Excel path, where junk parses
      // to an empty workbook instead of throwing.
      const accept = (rows: ParsedRow[], hdrs: string[], notASpreadsheet = false) => {
        if (rows.length === 0) {
          setIsParsing(false);
          setParseError(
            notASpreadsheet
              ? `"${file.name}" doesn't look like a real spreadsheet, even though it's named like one. Try opening it in Excel and re-saving it, then upload again.`
              : `"${file.name}" doesn't contain any data rows. Make sure the first row is a header and there is at least one row of data beneath it.`
          );
          return;
        }
        if (hdrs.length === 0) {
          setIsParsing(false);
          setParseError(
            `"${file.name}" has no column headings, so its columns can't be matched up. Add a header row and try again.`
          );
          return;
        }
        setHeaders(hdrs);
        setParsedData(rows);
        autoMapColumns(hdrs);
        setIsParsing(false);
        setStep('mapping');
      };

      if (file.name.toLowerCase().endsWith('.csv')) {
        Papa.parse<ParsedRow>(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            accept(results.data, results.meta.fields ?? []);
          },
          error: (err) => {
            console.error('CSV parse failed:', err);
            setIsParsing(false);
            setParseError(
              `We couldn't read "${file.name}". Try opening it in Excel and re-saving it as a CSV, then upload again.`
            );
          },
        });
        return;
      }

      const reader = new FileReader();

      reader.onerror = () => {
        setIsParsing(false);
        setParseError(
          `We couldn't read "${file.name}". The file may be in use by another program — close it in Excel and try again.`
        );
      };

      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) throw new Error('empty read result');

          const bytes = new Uint8Array(data as ArrayBuffer);
          const workbook = XLSX.read(bytes, { type: 'array' });
          if (workbook.SheetNames.length === 0) {
            setIsParsing(false);
            setParseError(`"${file.name}" has no sheets in it. Check you uploaded the right file.`);
            return;
          }

          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: '' });
          accept(
            jsonData,
            jsonData.length > 0 ? Object.keys(jsonData[0]) : [],
            !looksLikeSpreadsheet(bytes)
          );
        } catch (err) {
          console.error('Spreadsheet parse failed:', err);
          setIsParsing(false);
          setParseError(
            `We couldn't read "${file.name}". It may be damaged or not a real spreadsheet. Try opening it in Excel and re-saving it, then upload again.`
          );
        }
      };

      reader.readAsArrayBuffer(file);
    },
    [activeTab] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const autoMapColumns = (hdrs: string[]) => {
    const mapping: Record<string, string> = {};
    const normalizeMap: Record<string, string> = {
      'first name': 'firstName',
      'firstname': 'firstName',
      'first_name': 'firstName',
      'last name': 'lastName',
      'lastname': 'lastName',
      'last_name': 'lastName',
      'email': 'email',
      'email address': 'email',
      'phone': 'phone',
      'phone number': 'phone',
      'role': 'role',
      'title': 'role',
      'school': 'schoolId',
      'school name': 'name',
      'name': activeTab === 'schools' ? 'name' : 'firstName',
      'district': 'district',
      'county': 'county',
      'address': 'address',
      'city': 'city',
      'state': 'state',
      'zip': 'zipCode',
      'zipcode': 'zipCode',
      'zip code': 'zipCode',
      'type': 'schoolType',
      'school type': 'schoolType',
      'notes': 'notes',
    };

    for (const h of hdrs) {
      const normalized = h.toLowerCase().trim();
      if (normalizeMap[normalized]) {
        mapping[h] = normalizeMap[normalized];
      }
    }
    setColumnMapping(mapping);
  };

  const validateData = () => {
    const errors: ValidationResult[] = [];

    if (activeTab === 'contacts') {
      parsedData.forEach((row, i) => {
        const mapped = mapRow(row);
        if (!mapped.firstName) errors.push({ row: i, field: 'firstName', message: 'Missing first name', severity: 'error' });
        if (!mapped.lastName) errors.push({ row: i, field: 'lastName', message: 'Missing last name', severity: 'error' });
        if (!mapped.email) {
          errors.push({ row: i, field: 'email', message: 'Missing email', severity: 'error' });
        } else if (!isValidEmail(mapped.email)) {
          errors.push({ row: i, field: 'email', message: 'Invalid email format', severity: 'error' });
        }
        const existingEmail = state.contacts.find((c) => c.email.toLowerCase() === mapped.email?.toLowerCase());
        if (existingEmail) {
          errors.push({ row: i, field: 'email', message: 'Duplicate email (already exists)', severity: 'warning' });
        }
        if (mapped.schoolId) {
          const schoolMatch = state.schools.find(
            (s) => s.name.toLowerCase() === mapped.schoolId.toLowerCase()
          );
          if (!schoolMatch) {
            errors.push({ row: i, field: 'schoolId', message: `School "${mapped.schoolId}" not found — row will be skipped`, severity: 'error' });
          }
        }
      });
    } else {
      parsedData.forEach((row, i) => {
        const mapped = mapRow(row);
        if (!mapped.name) errors.push({ row: i, field: 'name', message: 'Missing school name', severity: 'error' });
        if (!mapped.county) errors.push({ row: i, field: 'county', message: 'Missing county', severity: 'error' });
        const dup = state.schools.find((s) => s.name.toLowerCase() === mapped.name?.toLowerCase());
        if (dup) errors.push({ row: i, field: 'name', message: 'School already exists — will be skipped', severity: 'warning' });
      });
    }

    setValidationErrors(errors);
    setStep('preview');
  };

  const mapRow = (row: ParsedRow): Record<string, string> => {
    const mapped: Record<string, string> = {};
    for (const [header, field] of Object.entries(columnMapping)) {
      if (field && row[header] !== undefined) {
        mapped[field] = String(row[header]).trim();
      }
    }
    return mapped;
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const errorRows = new Set(validationErrors.filter((e) => e.severity === 'error').map((e) => e.row));

      if (activeTab === 'contacts') {
        const validContacts = parsedData
          .map((row, i) => ({ row, i }))
          .filter(({ i }) => !errorRows.has(i))
          .map(({ row }) => {
            const mapped = mapRow(row);
            const school = state.schools.find(
              (s) => s.name.toLowerCase() === (mapped.schoolId || '').toLowerCase()
            );
            return {
              firstName: mapped.firstName || '',
              lastName: mapped.lastName || '',
              email: mapped.email || '',
              phone: mapped.phone || undefined,
              role: resolveRole(mapped.role),
              schoolId: school?.id ?? '',
              isActive: true,
              dataSource: 'imported' as const,
              isVerified: false as const,
              notes: mapped.notes || undefined,
            };
          });

        const result = await importContactsBulk(validContacts);
        dispatch({ type: 'ADD_CONTACTS_BULK', payload: result.contacts.slice(0, result.created) });
        toast.success(`Imported ${result.created} new, ${result.updated} updated (${result.failed + errorRows.size} skipped/failed)`);
      } else {
        const existingNames = new Set(state.schools.map((s) => s.name.toLowerCase()));
        const validSchools = parsedData
          .map((row, i) => ({ row, i }))
          .filter(({ i }) => !errorRows.has(i))
          .map(({ row }) => {
            const mapped = mapRow(row);
            return {
              name: mapped.name || '',
              district: mapped.district || undefined,
              county: mapped.county || '',
              address: mapped.address || '',
              city: mapped.city || '',
              state: mapped.state || 'IL',
              zipCode: mapped.zipCode || '',
              schoolType: (mapped.schoolType === 'middle_school' ? 'middle_school' : 'high_school') as 'high_school' | 'middle_school',
              isActive: true,
              dataSource: 'imported' as const,
              isVerified: false as const,
              notes: mapped.notes || undefined,
            };
          })
          .filter((s) => !existingNames.has(s.name.toLowerCase()));

        await addSchoolsBulk(validSchools);
        toast.success(`Imported ${validSchools.length} schools (${errorRows.size + (parsedData.length - validSchools.length - errorRows.size)} skipped)`);
      }
      setStep('done');
    } catch (err) {
      console.error('Import failed:', err);
      setParseError(
        'The import could not be completed and nothing was saved. Check your internet connection and try again.'
      );
      toast.error('Import failed — nothing was saved');
    } finally {
      setIsImporting(false);
    }
  };

  const reset = () => {
    setParsedData([]);
    setHeaders([]);
    setColumnMapping({});
    setValidationErrors([]);
    setFileName('');
    setStep('upload');
    setIsParsing(false);
    setParseError(null);
  };

  const downloadTemplate = () => {
    if (activeTab === 'contacts') {
      const csv = [
        'firstName,lastName,email,phone,role,schoolName,notes',
        'Jane,Smith,jane.smith@example.com,6185550100,counselor,Edwardsville High School,',
      ].join('\n');
      downloadFile(csv, 'contacts-template.csv', 'text/csv');
    } else if (activeTab === 'schools') {
      const csv = [
        'name,district,county,address,city,state,zipCode,schoolType,notes',
        'Edwardsville High School,Edwardsville CUSD 7,Madison,1200 Tigers Trail,Edwardsville,IL,62025,high_school,',
      ].join('\n');
      downloadFile(csv, 'schools-template.csv', 'text/csv');
    }
  };

  const { getRootProps: getCombinedRootProps, getInputProps: getCombinedInputProps, isDragActive: isCombinedDragActive } = useDropzone({
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    maxSize: MAX_UPLOAD_BYTES,
    disabled: isParsing,
    onDrop: (files) => { if (files[0]) parseCombinedFile(files[0]); },
    // Without this a rejected file does nothing at all — no message, no state
    // change — and the page looks broken.
    onDropRejected: (rejections) => {
      const message = describeFileRejection(rejections[0], 'an Excel file (.xlsx or .xls)');
      setParseError(message);
      toast.error(message);
    },
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    maxSize: MAX_UPLOAD_BYTES,
    disabled: isParsing,
    onDrop: (files) => { if (files[0]) parseFile(files[0]); },
    onDropRejected: (rejections) => {
      const message = describeFileRejection(rejections[0], 'a CSV or Excel file (.csv, .xlsx, .xls)');
      setParseError(message);
      toast.error(message);
    },
  });

  return (
    <div>
      <Header
        title="Import Data"
        subtitle="Import contacts and schools from spreadsheets"
      />
      <div className="p-8 space-y-6">
        {/* Tabs */}
        <div className="flex border-b border-neutral-200">
          {([
            { key: 'combined', label: 'Import Schools + Contacts' },
            { key: 'contacts', label: 'Import Contacts' },
            { key: 'schools', label: 'Import Schools' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key);
                reset();
                resetCombined();
              }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-siue-red text-siue-red'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {parseError && (
          <UploadError message={parseError} onDismiss={() => setParseError(null)} />
        )}

        {/* ── Combined Import Tab ─────────────────────────────────────────── */}
        {activeTab === 'combined' && (
          <>
            {combinedStep === 'upload' && (
              <Card>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-neutral-800">Upload Schools + Contacts File</h2>
                  <p className="text-sm text-neutral-500 mt-1">
                    Upload an Excel file with a <strong>Schools</strong> sheet and a <strong>Contacts</strong> sheet.
                    All records will enter as <Badge variant="warning" className="inline-flex">Unverified</Badge> for staff review.
                  </p>
                </div>
                <div
                  {...getCombinedRootProps()}
                  className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                    isParsing
                      ? 'border-neutral-200 bg-neutral-50 cursor-wait'
                      : isCombinedDragActive
                        ? 'border-siue-red bg-red-50 cursor-pointer'
                        : 'border-neutral-300 hover:border-siue-red cursor-pointer'
                  }`}
                >
                  <input {...getCombinedInputProps()} />
                  <DropzoneBody
                    isParsing={isParsing}
                    isDragActive={isCombinedDragActive}
                    idleLabel="Drag and drop Excel file, or click to browse"
                    hint={`Accepts .xlsx or .xls files with Schools + Contacts sheets — up to ${formatBytes(MAX_UPLOAD_BYTES)}`}
                  />
                </div>
                <div className="mt-4 p-4 bg-neutral-50 rounded-lg text-sm text-neutral-600 space-y-1">
                  <p className="font-medium text-neutral-700">Expected column names:</p>
                  <p><span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border border-neutral-200">Schools sheet:</span> name, district, county, address, city, state, zipCode, schoolType</p>
                  <p><span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border border-neutral-200">Contacts sheet:</span> firstName, lastName, email, phone, role, schoolName</p>
                </div>
              </Card>
            )}

            {combinedStep === 'preview' && combinedPreview && (
              <Card>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-800">Import Preview</h2>
                    <p className="text-sm text-neutral-400 flex items-center gap-2 mt-1">
                      <FileSpreadsheet size={16} />
                      {combinedPreview.fileName}
                    </p>
                    <p className="text-xs text-neutral-400 mt-1">
                      Reading schools from the &ldquo;{combinedPreview.schoolSheetName}&rdquo; sheet
                      {combinedPreview.contactSheetName
                        ? ` and contacts from the “${combinedPreview.contactSheetName}” sheet.`
                        : '. No second sheet found for contacts.'}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={resetCombined}>
                    <X size={16} />
                    Cancel
                  </Button>
                </div>

                {combinedPreview.warnings.length > 0 && (
                  <div className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50">
                    <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                      <AlertTriangle size={16} className="shrink-0" />
                      Check this before importing
                    </p>
                    <ul className="mt-2 space-y-1 list-disc list-inside">
                      {combinedPreview.warnings.map((w, i) => (
                        <li key={i} className="text-sm text-amber-900">{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="p-4 bg-neutral-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <SchoolIcon size={16} className="text-siue-red" />
                      <p className="text-sm font-semibold text-neutral-700">Schools</p>
                    </div>
                    <p className="text-2xl font-bold text-neutral-800">{combinedPreview.schoolRows.length}</p>
                    {combinedPreview.duplicateNames.length > 0 && (
                      <p className="text-xs text-warning mt-1">
                        {combinedPreview.duplicateNames.length} already exist (will skip)
                      </p>
                    )}
                    <p className="text-xs text-neutral-400 mt-1">
                      {combinedPreview.schoolRows.length - combinedPreview.duplicateNames.length} new schools
                    </p>
                  </div>
                  <div className="p-4 bg-neutral-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Users size={16} className="text-siue-red" />
                      <p className="text-sm font-semibold text-neutral-700">Contacts</p>
                    </div>
                    <p className="text-2xl font-bold text-neutral-800">{combinedPreview.contactRows.length}</p>
                    <p className="text-xs text-neutral-400 mt-1">will be linked by school name</p>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2 mb-6">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>All imported records will be marked <strong>Unverified</strong>. Review them on the Schools and Contacts pages before treating them as confirmed data.</span>
                </div>

                {/* Schools preview table */}
                {combinedPreview.schoolRows.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Schools to import</p>
                    <div className="overflow-x-auto border border-neutral-100 rounded-lg">
                      <table className="min-w-full divide-y divide-neutral-100 text-sm">
                        <thead className="bg-neutral-50">
                          <tr>
                            {['Name', 'County', 'City', 'Type', 'Status'].map((h) => (
                              <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-50">
                          {combinedPreview.schoolRows.slice(0, 8).map((row, i) => {
                            const isDup = combinedPreview.duplicateNames.some(
                              (n) => n.toLowerCase() === ((row['name'] as string) ?? '').toLowerCase()
                            );
                            return (
                              <tr key={i} className={isDup ? 'bg-amber-50/50' : ''}>
                                <td className="px-3 py-2 font-medium text-neutral-700">{row['name'] as string}</td>
                                <td className="px-3 py-2 text-neutral-500">{row['county'] as string}</td>
                                <td className="px-3 py-2 text-neutral-500">{row['city'] as string}</td>
                                <td className="px-3 py-2 text-neutral-500">{row['schoolType'] as string}</td>
                                <td className="px-3 py-2">
                                  {isDup ? (
                                    <Badge variant="warning">Duplicate — skip</Badge>
                                  ) : (
                                    <Badge variant="success">New</Badge>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {combinedPreview.schoolRows.length > 8 && (
                        <p className="text-xs text-neutral-400 p-3 text-center bg-neutral-50">
                          Showing first 8 of {combinedPreview.schoolRows.length} schools
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Contacts preview table */}
                {combinedPreview.contactRows.length > 0 && (
                  <div className="mb-6">
                    <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Contacts to import</p>
                    <div className="overflow-x-auto border border-neutral-100 rounded-lg">
                      <table className="min-w-full divide-y divide-neutral-100 text-sm">
                        <thead className="bg-neutral-50">
                          <tr>
                            {['Name', 'Email', 'Role', 'School'].map((h) => (
                              <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-50">
                          {combinedPreview.contactRows.slice(0, 8).map((row, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 font-medium text-neutral-700">
                                {row['firstName'] as string} {row['lastName'] as string}
                              </td>
                              <td className="px-3 py-2 text-neutral-500">{row['email'] as string}</td>
                              <td className="px-3 py-2 text-neutral-500">{row['role'] as string}</td>
                              <td className="px-3 py-2 text-neutral-500">{row['schoolName'] as string}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {combinedPreview.contactRows.length > 8 && (
                        <p className="text-xs text-neutral-400 p-3 text-center bg-neutral-50">
                          Showing first 8 of {combinedPreview.contactRows.length} contacts
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-neutral-100">
                  <Button variant="ghost" onClick={resetCombined} disabled={isImporting}>Cancel</Button>
                  <Button
                    onClick={() => void handleCombinedImport()}
                    disabled={
                      isImporting ||
                      (combinedPreview.schoolRows.length - combinedPreview.duplicateNames.length === 0 &&
                        combinedPreview.contactRows.length === 0)
                    }
                  >
                    {isImporting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Importing…
                      </>
                    ) : combinedPreview.schoolRows.length - combinedPreview.duplicateNames.length === 0 &&
                      combinedPreview.contactRows.length === 0 ? (
                      <>Nothing new to import</>
                    ) : (
                      <>Import {combinedPreview.schoolRows.length - combinedPreview.duplicateNames.length} Schools + {combinedPreview.contactRows.length} Contacts</>
                    )}
                  </Button>
                </div>
              </Card>
            )}

            {combinedStep === 'done' && combinedResult && (
              <Card>
                <div className="text-center py-8">
                  <CheckCircle size={48} className="mx-auto mb-4 text-success" />
                  <h2 className="text-xl font-semibold text-neutral-800 mb-2">Import Complete</h2>
                  <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-6 text-left">
                    <div className="p-3 bg-neutral-50 rounded-lg">
                      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Schools</p>
                      <p className="text-sm text-neutral-700"><strong className="text-success">{combinedResult.schoolsCreated}</strong> new</p>
                      <p className="text-sm text-neutral-700"><strong className="text-info">{combinedResult.schoolsUpdated}</strong> updated</p>
                      {combinedResult.schoolsFailed > 0 && (
                        <p className="text-sm text-neutral-700"><strong className="text-error">{combinedResult.schoolsFailed}</strong> failed</p>
                      )}
                    </div>
                    <div className="p-3 bg-neutral-50 rounded-lg">
                      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Contacts</p>
                      <p className="text-sm text-neutral-700"><strong className="text-success">{combinedResult.contactsCreated}</strong> new</p>
                      <p className="text-sm text-neutral-700"><strong className="text-info">{combinedResult.contactsUpdated}</strong> updated</p>
                      {combinedResult.contactsFailed > 0 && (
                        <p className="text-sm text-neutral-700"><strong className="text-error">{combinedResult.contactsFailed}</strong> failed</p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-2 inline-block mb-6">
                    New records are marked <strong>Unverified</strong> — navigate to Schools to review and verify.
                  </p>
                  <div className="flex justify-center gap-3">
                    <Button variant="secondary" onClick={resetCombined}>Import More</Button>
                  </div>
                </div>
              </Card>
            )}
          </>
        )}

        {/* ── Single-entity Import Tabs ───────────────────────────────────── */}
        {activeTab !== 'combined' && (
          <>
            {step === 'upload' && (
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-neutral-800">
                    Upload {activeTab === 'contacts' ? 'Contact' : 'School'} File
                  </h2>
                  <Button variant="ghost" size="sm" onClick={downloadTemplate}>
                    <Download size={16} />
                    Download Template
                  </Button>
                </div>
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                    isParsing
                      ? 'border-neutral-200 bg-neutral-50 cursor-wait'
                      : isDragActive
                        ? 'border-siue-red bg-red-50 cursor-pointer'
                        : 'border-neutral-300 hover:border-siue-red cursor-pointer'
                  }`}
                >
                  <input {...getInputProps()} />
                  <DropzoneBody
                    isParsing={isParsing}
                    isDragActive={isDragActive}
                    idleLabel="Drag and drop file, or click to browse"
                    hint={`Supports CSV and Excel (.xlsx, .xls) files — up to ${formatBytes(MAX_UPLOAD_BYTES)}`}
                  />
                </div>
              </Card>
            )}

            {step === 'mapping' && (
              <Card>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-800">Map Columns</h2>
                    <p className="text-sm text-neutral-400 flex items-center gap-2 mt-1">
                      <FileSpreadsheet size={16} />
                      {fileName} - {parsedData.length} rows found
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <X size={16} />
                    Cancel
                  </Button>
                </div>
                <div className="space-y-3">
                  {headers.map((header) => (
                    <div key={header} className="flex items-center gap-4">
                      <span className="text-sm text-neutral-600 w-48 truncate font-mono bg-neutral-50 px-3 py-2 rounded">
                        {header}
                      </span>
                      <span className="text-neutral-400">→</span>
                      <Select
                        options={fieldOptions.map((f) => ({ value: f.value, label: f.label }))}
                        placeholder="Skip this column"
                        value={columnMapping[header] || ''}
                        onChange={(e) =>
                          setColumnMapping((prev) => ({ ...prev, [header]: e.target.value }))
                        }
                        className="w-64"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-neutral-100">
                  <Button variant="ghost" onClick={reset}>Cancel</Button>
                  <Button onClick={validateData}>Validate & Preview</Button>
                </div>
              </Card>
            )}

            {step === 'preview' && (
              <Card>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-800">Import Preview</h2>
                    <div className="flex gap-4 mt-1">
                      <span className="text-sm text-neutral-400">{parsedData.length} total rows</span>
                      {validationErrors.filter((e) => e.severity === 'error').length > 0 && (
                        <Badge variant="error">
                          <AlertCircle size={12} className="mr-1" />
                          {validationErrors.filter((e) => e.severity === 'error').length} errors
                        </Badge>
                      )}
                      {validationErrors.filter((e) => e.severity === 'warning').length > 0 && (
                        <Badge variant="warning">
                          {validationErrors.filter((e) => e.severity === 'warning').length} warnings
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <X size={16} />
                    Cancel
                  </Button>
                </div>

                {validationErrors.length > 0 && (
                  <div className="mb-4 p-4 bg-red-50 rounded-lg border border-red-100">
                    <h4 className="text-sm font-medium text-error mb-2">Validation Issues</h4>
                    <ul className="space-y-1 max-h-40 overflow-y-auto">
                      {validationErrors.slice(0, 20).map((err, i) => (
                        <li key={i} className="text-xs flex items-center gap-2">
                          <span className={err.severity === 'error' ? 'text-error' : 'text-warning'}>
                            {err.severity === 'error' ? <AlertCircle size={12} /> : '⚠'}
                          </span>
                          <span className="text-neutral-600">
                            Row {err.row + 1}: {err.message} ({err.field})
                          </span>
                        </li>
                      ))}
                      {validationErrors.length > 20 && (
                        <li className="text-xs text-neutral-400">
                          ...and {validationErrors.length - 20} more issues
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                <div className="overflow-x-auto border border-neutral-100 rounded-lg">
                  <table className="min-w-full divide-y divide-neutral-100 text-sm">
                    <thead className="bg-neutral-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">Row</th>
                        {Object.entries(columnMapping)
                          .filter(([, v]) => v)
                          .map(([h, v]) => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">
                              {fieldOptions.find((f) => f.value === v)?.label || v}
                            </th>
                          ))}
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-50">
                      {parsedData.slice(0, 10).map((row, i) => {
                        const rowErrors = validationErrors.filter((e) => e.row === i);
                        const hasError = rowErrors.some((e) => e.severity === 'error');
                        return (
                          <tr key={i} className={hasError ? 'bg-red-50/50' : ''}>
                            <td className="px-3 py-2 text-neutral-400">{i + 1}</td>
                            {Object.entries(columnMapping)
                              .filter(([, v]) => v)
                              .map(([h]) => (
                                <td key={h} className="px-3 py-2 text-neutral-700 max-w-[200px] truncate">
                                  {row[h]}
                                </td>
                              ))}
                            <td className="px-3 py-2">
                              {hasError ? (
                                <Badge variant="error">Error</Badge>
                              ) : rowErrors.length > 0 ? (
                                <Badge variant="warning">Warning</Badge>
                              ) : (
                                <Badge variant="success">
                                  <CheckCircle size={12} className="mr-1" />
                                  OK
                                </Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {parsedData.length > 10 && (
                    <p className="text-xs text-neutral-400 p-3 text-center bg-neutral-50">
                      Showing first 10 of {parsedData.length} rows
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-neutral-100">
                  <Button variant="ghost" onClick={() => setStep('mapping')} disabled={isImporting}>Back to Mapping</Button>
                  <Button onClick={() => void handleImport()} disabled={isImporting}>
                    {isImporting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Importing…
                      </>
                    ) : (
                      <>Import {parsedData.length - validationErrors.filter((e) => e.severity === 'error').length} Valid Rows</>
                    )}
                  </Button>
                </div>
              </Card>
            )}

            {step === 'done' && (
              <Card>
                <div className="text-center py-8">
                  <CheckCircle size={48} className="mx-auto mb-4 text-success" />
                  <h2 className="text-xl font-semibold text-neutral-800 mb-2">Import Complete</h2>
                  <p className="text-neutral-400 mb-6">
                    Your data has been successfully imported as <strong>Unverified</strong> records.
                  </p>
                  <Button onClick={reset}>Import More Data</Button>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
