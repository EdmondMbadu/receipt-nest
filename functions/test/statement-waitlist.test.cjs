const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseWaitlistRequest, cleanName, displayName, buildWaitlistEmail, statsPageForSource } = require("../lib/statement-waitlist-core.js");
const { parseGameEvent } = require("../lib/game-stats-core.js");

test("accepts a valid signup and normalizes fields", () => {
  const r = parseWaitlistRequest(JSON.stringify({ name: "  Ana  María ", email: " Ana@Example.COM ", source: "charge_finish" }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { name: "Ana María", email: "ana@example.com", source: "charge_finish", bot: false });
});

test("rejects missing name, bad email and junk bodies with a field hint", () => {
  assert.equal(parseWaitlistRequest(JSON.stringify({ name: "", email: "a@b.co" })).field, "name");
  assert.equal(parseWaitlistRequest(JSON.stringify({ name: "Ana", email: "ana@" })).field, "email");
  assert.equal(parseWaitlistRequest(JSON.stringify({ name: "Ana", email: "ana@example" })).field, "email");
  assert.equal(parseWaitlistRequest("nope").field, "body");
  assert.equal(parseWaitlistRequest(JSON.stringify({ name: "x".repeat(3000), email: "a@b.co" })).field, "body");
});

test("unknown sources fall back, honeypot marks bots", () => {
  assert.equal(parseWaitlistRequest(JSON.stringify({ name: "Ana", email: "a@b.co", source: "evil" })).value.source, "charge_link");
  const bot = parseWaitlistRequest(JSON.stringify({ name: "", email: "", company: "Acme" }));
  assert.equal(bot.ok, true);
  assert.equal(bot.value.bot, true);
});

test("names are stripped of markup and capitalized gently", () => {
  assert.equal(cleanName("<b>Ana</b>"), "bAnab");
  assert.equal(cleanName("ana\u0000\n smith"), "ana smith");
  assert.equal(displayName("ana"), "Ana");
  assert.equal(displayName("DeShawn"), "DeShawn");
});

test("email is a clean, personal, escaped confirmation signed by Gervais", () => {
  const m = buildWaitlistEmail("ana");
  assert.equal(m.subject, "You’re on the Statement Decoder waitlist");
  assert.match(m.html, /Hi Ana,/);
  assert.match(m.html, /apple-touch-icon\.png/);
  assert.match(m.html, /You’re on the waitlist/);
  assert.match(m.html, /Gervais/);
  assert.doesNotMatch(m.html, /Edmond/);
  assert.match(m.html, /utm_campaign=statement_decoder/);
  assert.match(m.text, /Hi Ana,/);
  assert.match(m.text, /receipts you’ve saved in ReceiptNest/);
  const hostile = buildWaitlistEmail('"><img src=x onerror=1>');
  assert.doesNotMatch(hostile.html, /<img src=x/);
  assert.match(buildWaitlistEmail("").html, /Hi there,/);
});

test("clients cannot claim server-only waitlist joins", () => {
  assert.equal(parseGameEvent('{"g":"charge","e":"waitlist_join"}'), null);
  assert.ok(parseGameEvent('{"g":"charge","e":"waitlist_open"}'));
});

test("decoder page sources are accepted and counted under the decoder page", () => {
  assert.equal(parseWaitlistRequest(JSON.stringify({ name: "Ana", email: "a@b.co", source: "decoder_hero" })).value.source, "decoder_hero");
  assert.equal(statsPageForSource("decoder_footer"), "decoder");
  assert.equal(statsPageForSource("charge_finish"), "charge");
});

test("the decoder page only reports page events, never game runs", () => {
  assert.ok(parseGameEvent('{"g":"decoder","e":"view"}'));
  assert.ok(parseGameEvent('{"g":"decoder","e":"waitlist_open"}'));
  assert.equal(parseGameEvent('{"g":"decoder","e":"start","np":1}'), null);
  assert.equal(parseGameEvent('{"g":"decoder","e":"share_done","m":"copy"}'), null);
});
