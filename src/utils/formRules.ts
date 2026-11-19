import { z } from 'zod';

// The rules every form uses, so a field means the same thing everywhere: required
// fields, email, phone, website and zip formats, whole numbers of at least 1, and a
// maximum length on every text box. Values are checked trimmed and saved trimmed
// (trimStrings). Messages are plain sentences shown under the field.
//
// Zod v4 + React Hook Form: rules are refinements on plain strings (no coerce or
// preprocess), and numbers stay strings in the form, converted on submit.

/** Maximum lengths, in characters. */
export const MAX = {
  name: 200,
  personName: 100,
  title: 150,
  email: 254,
  phone: 40,
  address: 200,
  city: 100,
  zip: 10,
  gradeRange: 20,
  other: 100,
  location: 300,
  notes: 2000,
  description: 2000,
  report: 5000,
} as const;

const PHONE = /^\+?1?[\s.\-()]*(\d[\s.\-()]*){10}(\s*(ext\.?|x|extension|#)\s*\d{1,6})?$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;
// Stored zips include "62360 1033" (1,630 schools), so a space is accepted too.
const ZIP = /^\d{5}([ -]?\d{4})?$/;

const t = (v: string | undefined | null) => (v ?? '').trim();

// ---------------------------------------------------------------------------
// Plain checks: '' when fine, otherwise the message. Used by the schema rules
// below and directly by forms that don't use a schema.
// ---------------------------------------------------------------------------

export function textProblem(value: string | undefined, label: string, opts: { required?: boolean; max: number }): string {
  const v = t(value);
  if (opts.required && !v) return `${label} is required.`;
  if (v.length > opts.max) return `${label} must be ${opts.max} characters or fewer (it's ${v.length}).`;
  return '';
}

export function emailProblem(value: string | undefined, label = 'Email'): string {
  const v = t(value);
  if (!v) return '';
  if (v.length > MAX.email) return `${label} must be ${MAX.email} characters or fewer.`;
  return EMAIL.test(v) ? '' : `${label} doesn't look like an email address (name@example.org).`;
}

export function phoneProblem(value: string | undefined, label = 'Phone'): string {
  const v = t(value);
  if (!v) return '';
  if (v.length > MAX.phone) return `${label} must be ${MAX.phone} characters or fewer.`;
  return PHONE.test(v) ? '' : `${label} needs a 10-digit number, e.g. 618-555-0100 (an extension like "ext. 12" is fine).`;
}

export function urlProblem(value: string | undefined, label = 'Website'): string {
  const v = t(value);
  if (!v) return '';
  return URL_RE.test(v) ? '' : `${label} doesn't look like a web address (e.g. www.school.org).`;
}

export function zipProblem(value: string | undefined, label = 'Zip code'): string {
  const v = t(value);
  if (!v) return `${label} is required.`;
  return ZIP.test(v) ? '' : `${label} must be 5 digits, or 5+4 like 62026-1234.`;
}

/** A whole number of at least `min` (1 by default); blank is fine unless required. */
export function wholeNumberProblem(value: string | undefined, label: string, opts: { required?: boolean; min?: number; max?: number } = {}): string {
  const v = t(value);
  const min = opts.min ?? 1;
  const max = opts.max ?? 1_000_000;
  if (!v) return opts.required ? `${label} is required.` : '';
  if (!/^\d+$/.test(v)) return `${label} must be a whole number${min === 1 ? ' of at least 1' : ''}.`;
  const n = Number(v);
  if (n < min) return `${label} must be at least ${min}.`;
  if (n > max) return `${label} must be ${max.toLocaleString()} or less.`;
  return '';
}

/** End must be after start (both "yyyy-MM-ddTHH:mm" or "yyyy-MM-dd"); blank end is fine. */
export function endAfterStartProblem(start: string | undefined, end: string | undefined): string {
  if (!t(end) || !t(start)) return '';
  return new Date(t(end)) > new Date(t(start)) ? '' : 'End must be after the start.';
}

// ---------------------------------------------------------------------------
// Schema rules for React Hook Form + Zod.
// ---------------------------------------------------------------------------

const rule = (check: (v: string | undefined) => string) =>
  z.string().optional().superRefine((v, ctx) => {
    const message = check(v);
    if (message) ctx.addIssue({ code: 'custom', message });
  });

/** Typed as a plain string; a field never touched gets the same "is required" message. */
export const requiredText = (label: string, max: number) =>
  z.string({ error: `${label} is required.` }).superRefine((v, ctx) => {
    const message = textProblem(v, label, { required: true, max });
    if (message) ctx.addIssue({ code: 'custom', message });
  });
export const optionalText = (label: string, max: number) => rule((v) => textProblem(v, label, { max }));
export const optionalEmail = (label?: string) => rule((v) => emailProblem(v, label));
export const optionalPhone = (label?: string) => rule((v) => phoneProblem(v, label));
export const optionalUrl = (label?: string) => rule((v) => urlProblem(v, label));
export const zipCode = () =>
  z.string({ error: 'Zip code is required.' }).superRefine((v, ctx) => {
    const message = zipProblem(v);
    if (message) ctx.addIssue({ code: 'custom', message });
  });
export const wholeNumber = (label: string, opts?: { required?: boolean; min?: number; max?: number }) =>
  rule((v) => wholeNumberProblem(v, label, opts));
/** A required pick from a list (a select): "Choose a …". */
export const requiredChoice = (message: string) => z.string({ error: message }).min(1, message);

/** Every string trimmed, before saving. */
export function trimStrings<T extends object>(data: T): T {
  const out = { ...data } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) if (typeof v === 'string') out[k] = v.trim();
  return out as T;
}

/**
 * For forms without a schema: show the problems, focus the first field that has one,
 * and say whether the form can be saved. `fields` is in on-screen order, id → message.
 */
export function focusFirstProblem(fields: Array<[id: string, message: string]>): boolean {
  const first = fields.find(([, m]) => m);
  if (!first) return true;
  document.getElementById(first[0])?.focus();
  return false;
}
