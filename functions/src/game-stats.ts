/**
 * First-party analytics for the standalone browser games in public/games.
 * gameEvent: POST beacon from game pages (hosting rewrite /api/game-event), increments daily counters.
 * getGameStats: admin-only callable returning the daily counters for the admin dashboard.
 */
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { assertAdmin } from "./authz";
import {
  GAME_EVENTS,
  GAME_IDS,
  MAX_BODY_BYTES,
  STATS_TIME_ZONE,
  counterKeys,
  dayKey,
  isAllowedSource,
  parseGameEvent,
  recentDayKeys,
} from "./game-stats-core";

const COLLECTION = "gameStats";
/** Each day is split over a few documents so a traffic spike doesn't hit Firestore's per-document write limit. */
const SHARDS = 5;

/** Increment daily counters for a game from server code (e.g. the waitlist function). */
export const incrementGameCounters = async (game: string, keys: string[]): Promise<void> => {
  const inc = admin.firestore.FieldValue.increment(1);
  const counters: Record<string, admin.firestore.FieldValue> = {};
  for (const k of keys) counters[k] = inc;
  const day = dayKey(new Date());
  const shard = Math.floor(Math.random() * SHARDS);
  await admin.firestore().collection(COLLECTION).doc(`${day}_${shard}`).set(
    { day, [game]: counters, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
};

export const gameEvent = onRequest(
  { region: "us-central1", maxInstances: 5, memory: "256MiB", concurrency: 80 },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).send("");
      return;
    }
    if (!isAllowedSource(request.get("origin"), request.get("referer"))) {
      response.status(403).send("");
      return;
    }
    const raw = request.rawBody && request.rawBody.length <= MAX_BODY_BYTES
      ? request.rawBody.toString("utf8")
      : typeof request.body === "string" ? request.body : "";
    const ev = parseGameEvent(raw);
    if (!ev) {
      response.status(400).send("");
      return;
    }
    try {
      await incrementGameCounters(ev.game, counterKeys(ev));
      response.status(204).send("");
    } catch (error) {
      logger.error("gameEvent write failed", { error, game: ev.game, event: ev.event });
      response.status(500).send("");
    }
  }
);

export const getGameStats = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }
  await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

  const requested = Number((request.data as { days?: unknown } | undefined)?.days ?? 30);
  const days = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 120) : 30;
  const keys = recentDayKeys(days);
  const snap = await admin
    .firestore()
    .collection(COLLECTION)
    .where(admin.firestore.FieldPath.documentId(), ">=", `${keys[0]}_`)
    .where(admin.firestore.FieldPath.documentId(), "<=", `${keys[keys.length - 1]}_~`)
    .get();

  const totals = new Map<string, Record<string, Record<string, number>>>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const day = typeof data.day === "string" ? data.day : doc.id.slice(0, 10);
    const games = totals.get(day) || {};
    for (const g of GAME_IDS) {
      const src = (data[g] || {}) as Record<string, unknown>;
      const out = games[g] || (games[g] = {});
      for (const [k, v] of Object.entries(src)) if (typeof v === "number") out[k] = (out[k] || 0) + v;
    }
    totals.set(day, games);
  }
  const rows = keys.map((day) => {
    const found = totals.get(day) || {};
    const games: Record<string, Record<string, number>> = {};
    for (const g of GAME_IDS) games[g] = found[g] || {};
    return { day, games };
  });

  return { timeZone: STATS_TIME_ZONE, games: GAME_IDS, events: GAME_EVENTS, days: rows };
});
