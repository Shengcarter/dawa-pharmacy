import { useEffect, useRef } from 'react';

const KEY = 'dawa:last-activity';
const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/** Set when a session ends for inactivity, so the sign-in page can say why. */
export const IDLE_FLAG = 'dawa:signed-out-idle';

/**
 * Signs the user out after `minutes` without input. Activity in any tab counts
 * (shared through localStorage), so a second tab does not end a busy session.
 * Background polling does not count as activity; the server enforces the same
 * limit on refresh for closed browsers.
 */
export function useIdleLogout(minutes: number | undefined, enabled: boolean, onIdle: () => void) {
  const idle = useRef(onIdle);
  idle.current = onIdle;
  useEffect(() => {
    if (!enabled || !minutes) return;
    let last = Date.now();
    let lastWrite = 0;
    const store = (t: number) => { try { localStorage.setItem(KEY, String(t)); } catch { /* private mode */ } };
    const onActivity = () => {
      last = Date.now();
      if (last - lastWrite > 5_000) { lastWrite = last; store(last); }
    };
    store(last);
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const timer = window.setInterval(() => {
      let shared = last;
      try { shared = Math.max(last, Number(localStorage.getItem(KEY)) || 0); } catch { /* ignore */ }
      if (Date.now() - shared > minutes * 60_000) {
        try { sessionStorage.setItem(IDLE_FLAG, String(minutes)); } catch { /* ignore */ }
        idle.current();
      }
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [minutes, enabled]);
}
