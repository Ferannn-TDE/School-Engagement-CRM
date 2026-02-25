import { v4Style } from './id';

export function generateId(): string {
  return v4Style();
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function nowISO(): string {
  return new Date().toISOString();
}
