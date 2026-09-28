import { useEffect, useLayoutEffect, useRef } from 'react';
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
  // The page each scroll event belongs to. Updated as soon as a new page is placed,
  // before the browser sends any scroll events for it, so the browser adjusting the
  // scroll for the new page can't overwrite the previous page's position.
  const pathRef = useRef(location.pathname);
  useLayoutEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);
  // True while a restore is waiting for the page to grow tall enough. Scroll events
  // then are the browser settling, not the user, and must not be saved.
  const pendingRef = useRef(false);

  // Save the position as the user scrolls, against the page they are on. Written
  // straight from the event (a cheap write): animation-frame callbacks don't run in
  // background tabs, so they can't be relied on to save anything.
  useEffect(() => {
    const onScroll = () => {
      if (!pendingRef.current) write(SCROLL_PREFIX + pathRef.current, String(Math.round(window.scrollY)));
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

  // On arriving at a page, restore its saved position.
  useEffect(() => {
    // The app restores scroll itself; the browser's own attempt runs before the
    // data has loaded and would fight it.
    try {
      history.scrollRestoration = 'manual';
    } catch {
      /* not supported: harmless */
    }

    const saved = Number(read(SCROLL_PREFIX + location.pathname) ?? 0);
    if (!(saved > 0)) {
      window.scrollTo(0, 0);
      return;
    }
    // Pages fill in after they appear (after a refresh the data alone takes several
    // seconds), so keep trying until the page is tall enough to reach the saved
    // position. Give up after 15s, or straight away if the user scrolls themselves.
    pendingRef.current = true;
    // Timers rather than animation frames: frames pause in a background tab, so a
    // page loaded behind another tab would never restore.
    let timer = 0;
    const stop = () => {
      pendingRef.current = false;
    };
    const inputs = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    inputs.forEach((e) => window.addEventListener(e, stop, { passive: true, once: true }));
    const started = performance.now();
    const tryRestore = () => {
      if (!pendingRef.current) return;
      if (document.documentElement.scrollHeight - window.innerHeight >= saved) {
        window.scrollTo(0, saved);
        pendingRef.current = false;
        return;
      }
      if (performance.now() - started > 15000) {
        pendingRef.current = false;
        return;
      }
      timer = window.setTimeout(tryRestore, 50);
    };
    timer = window.setTimeout(tryRestore, 0);
    return () => {
      window.clearTimeout(timer);
      inputs.forEach((e) => window.removeEventListener(e, stop));
      pendingRef.current = false;
    };
  }, [location.pathname]);
}
