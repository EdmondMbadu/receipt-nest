const assert = require("node:assert/strict");
const { test } = require("node:test");
const { addEmailDarkMode } = require("../lib/email-theme.js");

test("keeps the light email intact and adds dark colors for paired surfaces and text", () => {
  const html = '<html><head></head><body style="background:#f8f9ff"><table class="card" style="background:#ffffff; border:1px solid #d4e4fa; color:#0f172a"><tr><td style="color:#006c49">Total</td></tr></table></body></html>';
  const themed = addEmailDarkMode(html);

  assert.match(themed, /meta name="color-scheme" content="light dark"/);
  assert.match(themed, /@media \(prefers-color-scheme: dark\)/);
  assert.match(themed, /background:#0b1422 !important/);
  assert.match(themed, /background:#172435 !important/);
  assert.match(themed, /color:#f1f5f9 !important/);
  assert.match(themed, /color:#86efac !important/);
  assert.match(themed, /class="card rn-dark-\d+"/);
  assert.match(themed, /style="background:#ffffff; border:1px solid #d4e4fa; color:#0f172a"/);
});

test("preserves fixed image backings used by the logo and store icons", () => {
  const html = '<html><head></head><body><span style="background-color:#f1f5f9; background-image:linear-gradient(#f1f5f9,#f1f5f9)"><img src="logo.png" /></span><td style="background-color:#111827; background-image:linear-gradient(#111827,#111827)">App Store</td></body></html>';
  const themed = addEmailDarkMode(html);

  assert.equal(themed, html);
});

test("does not change HTML without a head element", () => {
  const html = '<p style="color:#0f172a">Hello</p>';
  assert.equal(addEmailDarkMode(html), html);
});
