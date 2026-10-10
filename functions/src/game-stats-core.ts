/**
 * Pure helpers for first-party game analytics (no Firebase imports, unit-testable).
 * Stores only daily aggregate counters. No IDs, IPs, cookies or personal data.
 */

export const GAME_IDS = ["hub", "fade", "shoebox", "charge"] as const;
export type GameId = (typeof GAME_IDS)[number];

export const GAME_EVENTS = [
  "view", // game page loaded
  "start", // a run started
  "finish", // a run ended (game over / today's 10 done)
  "share_click", // tapped "Share"
  "share_done", // share sheet completed or score copied
  "arrival", // visitor landed from a player's share link
  "cta", // clicked a ReceiptNest signup link on a game page
  "read", // scrolled into the article under the game
  "signup", // registered after clicking a game CTA (credited to that game)
] as const;
export type GameEvent = (typeof GAME_EVENTS)[number];

export const SHARE_METHODS = ["native", "native_image", "copy"] as const;
export const STATS_TIME_ZONE = "America/Los_Angeles";
export const MAX_BODY_BYTES = 512;

export interface ParsedGameEvent {
  game: GameId;
  event: GameEvent;
  newPlayer: boolean;
  firstToday: boolean;
  returning: boolean;
  method: string | null;
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/** Parse and validate a beacon body. Returns null for anything unexpected. */
export const parseGameEvent = (raw: string | undefined | null): ParsedGameEvent | null => {
  if (!raw || raw.length > MAX_BODY_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (!isOneOf(GAME_IDS, d.g) || !isOneOf(GAME_EVENTS, d.e)) return null;
  if (d.g === "hub" && d.e !== "view" && d.e !== "arrival") return null;
  return {
    game: d.g,
    event: d.e,
    newPlayer: d.e === "start" && d.np === 1,
    firstToday: d.e === "start" && d.ft === 1,
    returning: d.e === "start" && d.ft === 1 && d.np !== 1 && d.rt === 1,
    method: d.e === "share_done" && isOneOf(SHARE_METHODS, d.m) ? d.m : null,
  };
};

/** Counter increments for one event, as { counterName: 1 }. */
export const counterKeys = (ev: ParsedGameEvent): string[] => {
  const keys: string[] = [ev.event];
  if (ev.newPlayer) keys.push("players_new");
  if (ev.firstToday) keys.push("players_day");
  if (ev.returning) keys.push("players_return");
  if (ev.method) keys.push(`share_${ev.method}`);
  return keys;
};

/** Day bucket (YYYY-MM-DD) in the stats time zone. */
export const dayKey = (date: Date, timeZone: string = STATS_TIME_ZONE): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

const ALLOWED_HOSTS = new Set(["receipt-nest.com", "www.receipt-nest.com", "receiptnest.web.app", "receiptnest.firebaseapp.com", "localhost", "127.0.0.1"]);

/** Accept requests from our own pages only (Origin, else Referer). Missing both is rejected. */
export const isAllowedSource = (origin: string | undefined, referer: string | undefined): boolean => {
  const src = origin || referer;
  if (!src) return false;
  try {
    return ALLOWED_HOSTS.has(new URL(src).hostname);
  } catch {
    return false;
  }
};

/** Last `days` day keys, oldest first, ending today. */
export const recentDayKeys = (days: number, now: Date = new Date(), timeZone: string = STATS_TIME_ZONE): string[] => {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(dayKey(new Date(now.getTime() - i * 86400000), timeZone));
  }
  return Array.from(new Set(out));
};
