interface SkeletonRowProps {
  cols: number;
  rows?: number;
}

function SingleSkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 bg-neutral-100 rounded animate-pulse"
            style={{ width: i === 0 ? '60%' : i === cols - 1 ? '40%' : '75%' }}
          />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonRow({ cols, rows = 5 }: SkeletonRowProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SingleSkeletonRow key={i} cols={cols} />
      ))}
    </>
  );
}
