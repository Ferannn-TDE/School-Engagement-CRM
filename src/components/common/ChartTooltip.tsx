import { TOOLTIP_CLS } from '../../constants/charts';

/** Tooltip for grouped and stacked bar charts.
 *  Falls back to the row's `fullCounty` when the axis label was truncated. */
export function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; payload: Record<string, unknown> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const displayLabel = (payload[0]?.payload as { fullCounty?: string })?.fullCounty ?? label;
  return (
    <div className={`${TOOLTIP_CLS} min-w-[140px]`}>
      {displayLabel && (
        <p className="font-semibold text-neutral-800 mb-2 max-w-[180px]">{displayLabel}</p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-neutral-500">{entry.name}</span>
            </div>
            <span className="font-medium text-neutral-800">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
