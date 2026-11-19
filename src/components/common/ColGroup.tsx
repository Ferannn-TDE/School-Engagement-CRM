import { useLayoutEffect, useRef, useState } from 'react';
import { columnWidth, sharedWidths, type ColumnSpec } from './tableColumns';

/**
 * The <colgroup> for a table built from column types. It measures its table so a wide
 * table shares its space (sharedWidths): the name about a third, the rest spread over
 * the other columns. Before the first measure, and for tables with nothing to share
 * with, the plain type widths apply.
 */
export function ColGroup({ specs }: { specs: ColumnSpec[] }) {
  const ref = useRef<HTMLTableColElement>(null);
  const [tableWidth, setTableWidth] = useState(0);

  useLayoutEffect(() => {
    // Measure the box the table sits in, not the table: px column widths set the table's
    // own width, so measuring it would never notice the page getting narrower.
    const box = ref.current?.closest('table')?.parentElement;
    if (!box) return;
    const measure = () => {
      const cs = getComputedStyle(box);
      setTableWidth(box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const remPx = typeof window === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const shared = sharedWidths(specs, tableWidth, remPx);
  return (
    <colgroup ref={ref}>
      {specs.map((spec, i) => (
        <col key={i} style={{ width: shared ? `${shared[i]}px` : columnWidth(spec) }} />
      ))}
    </colgroup>
  );
}
