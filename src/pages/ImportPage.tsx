import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, X, Download } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Select } from '../components/common/Select';
import { Badge } from '../components/common/Badge';
import { useAppContext } from '../context/AppContext';
import { ContactRole } from '../types';
import { isValidEmail } from '../utils/helpers';
import { CONTACT_FIELD_OPTIONS, SCHOOL_FIELD_OPTIONS } from '../constants';
import toast from 'react-hot-toast';

type ImportTab = 'contacts' | 'schools';

interface ParsedRow {
  [key: string]: string;
}

interface ValidationResult {
  row: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export function ImportPage() {
  const { state, addContactsBulk, addSchool } = useAppContext();
  const [activeTab, setActiveTab] = useState<ImportTab>('contacts');
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<ValidationResult[]>([]);
  const [fileName, setFileName] = useState('');
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'done'>('upload');

  const fieldOptions = activeTab === 'contacts' ? CONTACT_FIELD_OPTIONS : SCHOOL_FIELD_OPTIONS;

  const parseFile = useCallback((file: File) => {
    setFileName(file.name);

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const data = results.data as ParsedRow[];
          const hdrs = results.meta.fields || [];
          setHeaders(hdrs);
          setParsedData(data);
          autoMapColumns(hdrs);
          setStep('mapping');
        },
        error: () => toast.error('Failed to parse CSV file'),
      });
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: '' });
        if (jsonData.length > 0) {
          const hdrs = Object.keys(jsonData[0]);
          setHeaders(hdrs);
          setParsedData(jsonData);
          autoMapColumns(hdrs);
          setStep('mapping');
        }
      };
      reader.readAsBinaryString(file);
    }
  }, [activeTab]);

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
        // Check duplicates
        const existingEmail = state.contacts.find((c) => c.email.toLowerCase() === mapped.email?.toLowerCase());
        if (existingEmail) {
          errors.push({ row: i, field: 'email', message: 'Duplicate email (already exists)', severity: 'warning' });
        }
      });
    } else {
      parsedData.forEach((row, i) => {
        const mapped = mapRow(row);
        if (!mapped.name) errors.push({ row: i, field: 'name', message: 'Missing school name', severity: 'error' });
        if (!mapped.county) errors.push({ row: i, field: 'county', message: 'Missing county', severity: 'error' });
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

  const handleImport = () => {
    const errorRows = new Set(validationErrors.filter((e) => e.severity === 'error').map((e) => e.row));

    if (activeTab === 'contacts') {
      const validContacts = parsedData
        .map((row, i) => ({ row, i }))
        .filter(({ i }) => !errorRows.has(i))
        .map(({ row }) => {
          const mapped = mapRow(row);
          // Try to find school by name
          const school = state.schools.find(
            (s) => s.name.toLowerCase() === (mapped.schoolId || '').toLowerCase()
          );
          return {
            firstName: mapped.firstName || '',
            lastName: mapped.lastName || '',
            email: mapped.email || '',
            phone: mapped.phone || undefined,
            role: (Object.values(ContactRole).find((r) => r === mapped.role?.toLowerCase()) ||
              ContactRole.COUNSELOR) as ContactRole,
            schoolId: school?.id || state.schools[0]?.id || '',
            isActive: true,
            notes: mapped.notes || undefined,
          };
        });

      addContactsBulk(validContacts);
      toast.success(`Imported ${validContacts.length} contacts (${errorRows.size} skipped)`);
    } else {
      let imported = 0;
      parsedData.forEach((row, i) => {
        if (errorRows.has(i)) return;
        const mapped = mapRow(row);
        addSchool({
          name: mapped.name || '',
          district: mapped.district || undefined,
          county: mapped.county || '',
          address: mapped.address || '',
          city: mapped.city || '',
          state: mapped.state || 'IL',
          zipCode: mapped.zipCode || '',
          schoolType: mapped.schoolType === 'middle_school' ? 'middle_school' : 'high_school',
          isActive: true,
          notes: mapped.notes || undefined,
        });
        imported++;
      });
      toast.success(`Imported ${imported} schools (${errorRows.size} skipped)`);
    }
    setStep('done');
  };

  const reset = () => {
    setParsedData([]);
    setHeaders([]);
    setColumnMapping({});
    setValidationErrors([]);
    setFileName('');
    setStep('upload');
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    onDrop: (files) => {
      if (files[0]) parseFile(files[0]);
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
          {(['contacts', 'schools'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); reset(); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-siue-red text-siue-red'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              Import {tab === 'contacts' ? 'Contacts' : 'Schools'}
            </button>
          ))}
        </div>

        {step === 'upload' && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-neutral-800">
                Upload {activeTab === 'contacts' ? 'Contact' : 'School'} File
              </h2>
              <Button variant="ghost" size="sm">
                <Download size={16} />
                Download Template
              </Button>
            </div>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                isDragActive ? 'border-siue-red bg-red-50' : 'border-neutral-300 hover:border-siue-red'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="w-12 h-12 mx-auto mb-4 text-neutral-400" />
              <p className="text-lg text-neutral-700 mb-2">
                {isDragActive ? 'Drop file here' : 'Drag and drop file, or click to browse'}
              </p>
              <p className="text-sm text-neutral-400">Supports CSV and Excel (.xlsx, .xls) files</p>
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

            {/* Validation Errors */}
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

            {/* Preview Table */}
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
              <Button variant="ghost" onClick={() => setStep('mapping')}>Back to Mapping</Button>
              <Button onClick={handleImport}>
                Import {parsedData.length - validationErrors.filter((e) => e.severity === 'error').length} Valid Rows
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
                Your data has been successfully imported.
              </p>
              <Button onClick={reset}>Import More Data</Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
