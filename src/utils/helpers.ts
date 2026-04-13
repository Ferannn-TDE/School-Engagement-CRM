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
