/**
 * An empty table cell: a muted dash, with what's missing ("No email") as the hover
 * text and for screen readers. The same in every table, so a column of gaps reads
 * quietly instead of repeating the same words down the page.
 */
export function Missing({ label }: { label: string }) {
  return (
    <span className="text-neutral-400" title={label}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
