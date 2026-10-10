const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseGameEvent, counterKeys, dayKey, isAllowedSource, recentDayKeys } = require("../lib/game-stats-core.js");

test("accepts a valid start with player flags", () => {
  const ev = parseGameEvent(JSON.stringify({ g: "charge", e: "start", np: 0, ft: 1, rt: 1 }));
  assert.deepEqual(counterKeys(ev), ["start", "players_day", "players_return"]);
  const first = parseGameEvent(JSON.stringify({ g: "fade", e: "start", np: 1, ft: 1, rt: 0 }));
  assert.deepEqual(counterKeys(first), ["start", "players_new", "players_day"]);
});

test("records share method only for share_done and known methods", () => {
  assert.deepEqual(counterKeys(parseGameEvent('{"g":"shoebox","e":"share_done","m":"copy"}')), ["share_done", "share_copy"]);
  assert.deepEqual(counterKeys(parseGameEvent('{"g":"shoebox","e":"share_done","m":"evil"}')), ["share_done"]);
  assert.deepEqual(counterKeys(parseGameEvent('{"g":"shoebox","e":"view","m":"copy","np":1}')), ["view"]);
});

test("rejects unknown games, events, bad JSON and oversized bodies", () => {
  assert.equal(parseGameEvent('{"g":"x","e":"view"}'), null);
  assert.equal(parseGameEvent('{"g":"fade","e":"__proto__"}'), null);
  assert.equal(parseGameEvent("not json"), null);
  assert.equal(parseGameEvent("[1]"), null);
  assert.equal(parseGameEvent(JSON.stringify({ g: "fade", e: "view", pad: "x".repeat(600) })), null);
  assert.equal(parseGameEvent('{"g":"hub","e":"start"}'), null);
  assert.ok(parseGameEvent('{"g":"hub","e":"view"}'));
});

test("only our own pages may send events", () => {
  assert.equal(isAllowedSource("https://receipt-nest.com", undefined), true);
  assert.equal(isAllowedSource(undefined, "https://receipt-nest.com/games/fade"), true);
  assert.equal(isAllowedSource("https://evil.example", undefined), false);
  assert.equal(isAllowedSource(undefined, undefined), false);
});

test("buckets days in Los Angeles time", () => {
  assert.equal(dayKey(new Date("2026-10-09T06:30:00Z")), "2026-10-08");
  assert.equal(dayKey(new Date("2026-10-09T08:00:00Z")), "2026-10-09");
  const keys = recentDayKeys(3, new Date("2026-10-09T20:00:00Z"));
  assert.deepEqual(keys, ["2026-10-07", "2026-10-08", "2026-10-09"]);
});
