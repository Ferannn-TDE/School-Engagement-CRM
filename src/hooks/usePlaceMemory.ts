import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Per-tab memory for the current browser tab: the last address of each sidebar
// page and how far down it was scrolled. sessionStorage survives a refresh but not
// closing the tab. Every access is guarded: storage can be unavailable (private
// windows, blocked site data) and the app must work the same without it.

const URL_PREFIX = 'crm.lastUrl:';
const SCROLL_PREFIX = 'crm.scroll:';

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the page simply won't be remembered */
  }
}

/** The last address used on a sidebar page, e.g. "/schools?q=lincoln&page=3". */
export function rememberedUrl(path: string): string {
  const saved = read(URL_PREFIX + path);
  return saved && saved.startsWith(path) ? saved : path;
}

/**
 * Remembers where the user was on each sidebar page and restores their scroll
 * position when they come back. Mounted once, in the app layout.
 */
export function usePlaceMemory(sidebarPaths: string[]) {
  const location = useLocation();
  const scrollY = useRef(0);

  // Track scroll continuously; reading it during navigation is too late, because
  // the new page has already replaced the old one.
  useEffect(() => {
    const onScroll = () => {
      scrollY.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Remember the address of sidebar pages (not detail pages such as /schools/:id).
  useEffect(() => {
    if (sidebarPaths.includes(location.pathname)) {
      write(URL_PREFIX + location.pathname, location.pathname + location.search);
    }
  }, [location.pathname, location.search, sidebarPaths]);

  // On arriving at a page, restore its scroll; on leaving, save it.
  useEffect(() => {
    // The app restores scroll itself; the browser's own attempt runs before the
    // data has loaded and would fight it.
    try {
      history.scrollRestoration = 'manual';
    } catch {
      /* not supported: harmless */
    }

    const path = location.pathname;
    const saved = Number(read(SCROLL_PREFIX + path) ?? 0);
    // Pages fill in after they appear (after a refresh the data alone takes several
    // seconds), so keep trying until the page is tall enough to reach the saved
    // position. Give up after 15s, or straight away if the user scrolls themselves.
    // Until then nothing is saved, so a slow load can't overwrite the real position.
    let pending = saved > 0;
    let raf = 0;
    const stopOnUserInput = () => {
      pending = false;
    };
    const inputs = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    inputs.forEach((e) => window.addEventListener(e, stopOnUserInput, { passive: true, once: true }));
    const started = performance.now();
    const tryRestore = () => {
      if (!pending) return;
      if (document.documentElement.scrollHeight - window.innerHeight >= saved) {
        window.scrollTo(0, saved);
        scrollY.current = window.scrollY;
        pending = false;
        return;
      }
      if (performance.now() - started > 15000) {
        pending = false;
        return;
      }
      raf = requestAnimationFrame(tryRestore);
    };
    if (pending) raf = requestAnimationFrame(tryRestore);
    else window.scrollTo(0, 0);

    const save = (y: number) => {
      if (!pending) write(SCROLL_PREFIX + path, String(y));
    };
    // A refresh or closing the tab doesn't run the cleanup below, so save then too.
    const onPageHide = () => save(window.scrollY);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      cancelAnimationFrame(raf);
      inputs.forEach((e) => window.removeEventListener(e, stopOnUserInput));
      window.removeEventListener('pagehide', onPageHide);
      save(scrollY.current);
    };
  }, [location.pathname]);
}
