import { v4Style } from './id';

export function generateId(): string {
  return v4Style();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function formatSchoolType(type: string): string {
  return type === 'high_school' ? 'High School' : 'Middle School';
}

export function classNames(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function downloadFile(content: string, filename: string, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function contactsToCsv(
  contacts: Array<Record<string, unknown>>,
  fields: string[]
): string {
  const header = fields.join(',');
  const rows = contacts.map((c) =>
    fields.map((f) => {
      const val = String(c[f] ?? '');
      return val.includes(',') || val.includes('"')
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    }).join(',')
  );
  return [header, ...rows].join('\n');
}


export function nowISO(): string {
  return new Date().toISOString();
}

/** Largest spreadsheet we accept. Parsing happens in the browser, so a file
 *  much bigger than this locks up the tab rather than failing cleanly. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Turns a react-dropzone rejection into something a non-technical user can act on.
 *  `accepted` describes the allowed formats in plain words, e.g. "Excel (.xlsx or .xls)". */
export function describeFileRejection(
  rejection: {
    file: { name: string; size: number };
    errors: readonly { readonly code: string }[];
  },
  accepted: string
): string {
  const codes = rejection.errors.map((e) => e.code);
  const name = rejection.file.name;

  if (codes.includes('file-too-large')) {
    return `"${name}" is ${formatBytes(rejection.file.size)}, which is over the ${formatBytes(
      MAX_UPLOAD_BYTES
    )} limit. Try splitting it into smaller files.`;
  }
  if (codes.includes('too-many-files')) {
    return 'Please add one file at a time.';
  }
  if (codes.includes('file-invalid-type')) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    return `"${name}" isn't a supported file${
      ext ? ` (${ext} files can't be read here)` : ''
    }. Please upload ${accepted}.`;
  }
  return `"${name}" couldn't be accepted. Please upload ${accepted}.`;
}
