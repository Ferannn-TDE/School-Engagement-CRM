import { useStateFilter } from '../../hooks/useStateFilter';
import { REGIONS } from '../../utils/region';
import { classNames } from '../../utils/helpers';

/** The shared All / IL / MO switch. Shown in the header of every page it affects. */
export function StateFilter() {
  const [region, setRegion] = useStateFilter();
  return (
    <div role="group" aria-label="Filter by state" className="flex rounded-lg border border-neutral-200 overflow-hidden">
      {REGIONS.map(({ value, label }) => (
        <button
          key={label}
          type="button"
          onClick={() => setRegion(value)}
          aria-pressed={region === value}
          title={value ? `Only ${value === 'IL' ? 'Illinois' : 'Missouri'}` : 'Illinois and Missouri'}
          className={classNames(
            'px-3 py-1.5 text-sm font-medium transition-colors',
            region === value ? 'bg-siue-red text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
