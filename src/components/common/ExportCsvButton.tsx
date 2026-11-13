import { Download } from 'lucide-react';
import { Button } from './Button';
import { downloadCsv, type CsvColumn } from '../../utils/csv';

/** "Export CSV": the rows given (the current filtered, sorted view), with these columns. */
export function ExportCsvButton<T>({ name, columns, rows, label = 'Export CSV' }: {
  name: string;
  columns: CsvColumn<T>[];
  rows: T[];
  label?: string;
}) {
  return (
    <Button size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => downloadCsv(name, columns, rows)}
      title={`Download these ${rows.length.toLocaleString()} rows as a spreadsheet`}>
      <Download size={14} />
      {label}
    </Button>
  );
}
