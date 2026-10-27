/** Categorical series colours, drawn from the SIUE palette plus neutrals.
 *  Kept out of the tooltip component file so that file only exports components
 *  (react-refresh/only-export-components). */
export const CHART_COLORS = [
  '#CE1126', '#004B87', '#0F7837', '#FF8C00',
  '#8B2332', '#54585A', '#C41E3A', '#373A3C',
];

export const TOOLTIP_CLS =
  'bg-white border border-neutral-100 rounded-xl shadow-lg p-3 text-xs';

/** Reports: a colour-blind-safe order (blue, orange, aqua, yellow; checked with the
 *  data-viz palette validator) and a quiet grey for context bars. Red and green side by
 *  side, as in CHART_COLORS, fail that check, so the Reports page doesn't use them. */
export const REPORT_SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
export const REPORT_QUIET = '#C9CBCC';
