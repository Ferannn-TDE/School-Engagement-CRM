import { columnWidth, type ColumnSpec } from './tableColumns';

/** The <colgroup> for a table built from column types. */
export function ColGroup({ specs }: { specs: ColumnSpec[] }) {
  return (
    <colgroup>
      {specs.map((spec, i) => (
        <col key={i} style={{ width: columnWidth(spec) }} />
      ))}
    </colgroup>
  );
}
