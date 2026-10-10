/**
 * Records a completed signup in GA4 (`sign_up`) and, when the visitor clicked a
 * signup link on one of the standalone games (public/games) in the last 30 days,
 * credits that game in the first-party game counters (/api/game-event).
 * The games store { g: gameId, t: timestamp } in localStorage under `rn_game_ref`.
 * No personal data is sent. Safe to call during SSR (no-op).
 */
export type SignupMethod = 'email' | 'google' | 'apple';

const GAME_REF_KEY = 'rn_game_ref';
const GAME_REF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const KNOWN_GAMES = new Set(['fade', 'shoebox', 'charge']);

export function readGameRef(now: number = Date.now()): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(GAME_REF_KEY);
    if (!raw) return null;
    const ref = JSON.parse(raw) as { g?: unknown; t?: unknown };
    const age = now - Number(ref.t);
    if (typeof ref.g !== 'string' || !KNOWN_GAMES.has(ref.g) || !(age >= 0 && age <= GAME_REF_MAX_AGE_MS)) {
      return null;
    }
    return ref.g;
  } catch {
    return null;
  }
}

export function trackSignup(method: SignupMethod): void {
  if (typeof window === 'undefined') return;
  const game = readGameRef();
  try {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    gtag?.('event', 'sign_up', game ? { method, game } : { method });
  } catch {
    /* analytics must never break signup */
  }
  if (!game) return;
  try {
    const body = JSON.stringify({ g: game, e: 'signup' });
    const sent = navigator.sendBeacon?.('/api/game-event', new Blob([body], { type: 'text/plain' }));
    if (!sent) {
      void fetch('/api/game-event', { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined);
    }
    globalThis.localStorage?.removeItem(GAME_REF_KEY);
  } catch {
    /* ignore */
  }
}
