export function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-8 h-8 border-4 border-neutral-200 border-t-siue-red rounded-full animate-spin" />
      <p className="text-sm text-neutral-400">Loading data…</p>
    </div>
  );
}
