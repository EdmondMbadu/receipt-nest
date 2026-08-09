const assert = require("node:assert/strict");
const test = require("node:test");
const Mail = require("@sendgrid/helpers/classes/mail");

const {
  appendUnsubscribeHtml,
  appendUnsubscribeText,
  buildUnsubscribeToken,
  buildUnsubscribeUrls,
  emailSuppressionDocumentId,
  normalizeEmailAddress,
  verifyUnsubscribeToken,
} = require("../lib/email-suppression.js");

const secret = "local-test-secret-with-enough-entropy";

test("normalizes equivalent email addresses to one suppression key", () => {
  assert.equal(normalizeEmailAddress(" Person+News@Example.com "), "person+news@example.com");
  assert.equal(
    emailSuppressionDocumentId(" Person+News@Example.com "),
    emailSuppressionDocumentId("person+news@example.com")
  );
});

test("verifies valid unsubscribe tokens and rejects tampering", () => {
  const token = buildUnsubscribeToken("Person@Example.com", secret);

  assert.equal(verifyUnsubscribeToken(token, secret), "person@example.com");
  assert.equal(verifyUnsubscribeToken(`${token}x`, secret), null);
  assert.equal(verifyUnsubscribeToken(token, `${secret}-wrong`), null);
  assert.equal(verifyUnsubscribeToken("not-a-token", secret), null);
});

test("builds public and one-click URLs without duplicate slashes", () => {
  const urls = buildUnsubscribeUrls("person@example.com", "https://receipt-nest.com/", secret);

  assert.match(urls.pageUrl, /^https:\/\/receipt-nest\.com\/unsubscribe\?token=/);
  assert.match(urls.oneClickUrl, /^https:\/\/receipt-nest\.com\/api\/email\/unsubscribe\?token=/);
});

test("adds unsubscribe content to HTML and text versions", () => {
  const url = "https://receipt-nest.com/unsubscribe?token=test";
  const html = appendUnsubscribeHtml("<html><body><p>Hello</p></body></html>", url);
  const text = appendUnsubscribeText("Hello", url);

  assert.match(html, /<p>Hello<\/p>[\s\S]*Unsubscribe[\s\S]*<\/body>/);
  assert.match(text, /Hello[\s\S]*Unsubscribe from non-essential ReceiptNest AI emails/);
});

test("SendGrid serialization preserves one-click unsubscribe headers", () => {
  const mail = Mail.create({
    to: "person@example.com",
    from: "info@receipt-nest.com",
    subject: "Test",
    text: "Test",
    html: "<p>Test</p>",
    headers: {
      "List-Unsubscribe": "<https://receipt-nest.com/api/email/unsubscribe?token=test>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  const serialized = mail.toJSON();

  assert.equal(
    serialized.headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click"
  );
});
