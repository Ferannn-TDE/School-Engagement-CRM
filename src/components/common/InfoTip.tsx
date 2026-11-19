import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

/**
 * An (i) next to a table header that explains the column in plain words. It opens on
 * hover and keyboard focus, and on a tap (touch screens can't hover); Escape, a tap
 * elsewhere or scrolling closes it. The text is drawn over the page, so a scrolling
 * table never cuts it off, and is the button's description for screen readers.
 */
export function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  // What the last press was, and whether the tip was already open: a tap toggles it,
  // a mouse click keeps it open (hover already opened it).
  const press = useRef<{ type: string; wasOpen: boolean }>({ type: 'mouse', wasOpen: false });

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
    const up = r.bottom + 160 > window.innerHeight && r.top > 160;
    setPos({ left, top: up ? r.top - 6 : r.bottom + 6, up });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!button.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={id}
        aria-expanded={open}
        // Inside a sortable header: explaining a column never sorts it.
        onPointerDown={(e) => { press.current = { type: e.pointerType, wasOpen: open }; }}
        onClick={(e) => {
          e.stopPropagation();
          if (e.detail === 0) setOpen((o) => !o); // Enter or Space
          else setOpen(press.current.type === 'mouse' ? true : !press.current.wasOpen);
        }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setOpen(true); }}
        onBlur={() => setOpen(false)}
        className="relative inline-flex shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 focus-visible:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red after:absolute after:-inset-3.5 after:content-['']"
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {/* Always in the page (hidden when closed) so aria-describedby has text to read. */}
      {createPortal(
        <div
          id={id}
          role="tooltip"
          hidden={!open || !pos}
          className="fixed z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg bg-neutral-800 px-3 py-2 text-xs font-normal normal-case tracking-normal leading-relaxed text-white shadow-lg whitespace-pre-line"
          style={pos ? { left: pos.left, top: pos.top, transform: pos.up ? 'translateY(-100%)' : undefined } : undefined}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}

/** A header's text with its (i), for tables. */
export function HeaderWithInfo({ label, info }: { label: string; info: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTip label={label} text={info} />
    </span>
  );
}
