const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { EMAIL_SOCIAL_LINKS, appendEmailSocialHtml, appendEmailSocialText } = require("../lib/email-social-links.js");
const { appendUnsubscribeHtml, appendUnsubscribeText } = require("../lib/email-suppression.js");

test("all five social destinations match the website footer and have email icons", () => {
  const root = path.resolve(__dirname, "../..");
  const footer = readFileSync(path.join(root, "src/app/features/landing/landing.component.html"), "utf8");
  assert.equal(EMAIL_SOCIAL_LINKS.length, 5);
  for (const link of EMAIL_SOCIAL_LINKS) {
    assert.ok(footer.includes(`href="${link.href}"`), link.label);
    assert.ok(existsSync(path.join(root, `public/email/social/${link.key}.png`)), link.key);
  }
});

test("adds a single accessible footer inside the body without changing content", () => {
  const original = '<!DOCTYPE html><html><head><title>ReceiptNest</title></head><body><a href="https://receipt-nest.com/reset-password?oobCode=example">Reset password</a></body></html>';
  const html = appendEmailSocialHtml(original);
  assert.ok(html.includes('<a href="https://receipt-nest.com/reset-password?oobCode=example">Reset password</a>'));
  assert.equal((html.match(/id="receiptnest-social-footer"/g) || []).length, 1);
  assert.ok(html.indexOf('id="receiptnest-social-footer"') < html.indexOf('</body>'));
  assert.match(html, /prefers-color-scheme: dark/);
  assert.doesNotMatch(html, /<svg|display:flex|display:grid/);
  for (const { label, href } of EMAIL_SOCIAL_LINKS) {
    assert.ok(html.includes(`aria-label="ReceiptNest on ${label}"`));
    assert.ok(html.includes(`href="${href}"`));
  }
  assert.equal(appendEmailSocialHtml(html), html);
});

test("wraps custom HTML fragments with a viewport and preserves their contents", () => {
  const html = appendEmailSocialHtml('<p>Your receipt is ready.</p>');
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<body[^>]*><p>Your receipt is ready\.<\/p>/);
  assert.match(html, /<\/body><\/html>$/);
});

test("keeps the custom email unsubscribe footer after the social links", () => {
  const url = 'https://receipt-nest.com/unsubscribe?token=example';
  const html = appendEmailSocialHtml(appendUnsubscribeHtml('<html><head></head><body>Hello</body></html>', url));
  assert.ok(html.indexOf('id="receiptnest-social-footer"') < html.indexOf(`href="${url}"`));
  const text = appendEmailSocialText(appendUnsubscribeText('Hello', url));
  assert.ok(text.startsWith('Hello\n\nFollow ReceiptNest:'));
  assert.ok(text.endsWith(url));
  assert.equal(appendEmailSocialText(text), text);
});

test("plain text includes all destinations and is safe to prepare twice", () => {
  const text = appendEmailSocialText('Your summary is ready.');
  for (const { label, href } of EMAIL_SOCIAL_LINKS) assert.ok(text.includes(`${label}: ${href}`));
  assert.equal(appendEmailSocialText(text), text);
});

test("the shared transport decorates HTML/text and preserves delivery metadata", async (t) => {
  const sgMail = require('@sendgrid/mail');
  const originalRequest = sgMail.client.request;
  const originalSetApiKey = sgMail.setApiKey;
  const requests = [];
  sgMail.setApiKey = () => undefined;
  sgMail.client.request = async (request) => { requests.push(request); return [{statusCode:202}, {}]; };
  t.after(() => { sgMail.client.request = originalRequest; sgMail.setApiKey = originalSetApiKey; });
  const { sendSendgridMail } = require('../lib/sendgrid.js');
  const message = {
    to: 'preview@example.com', from: {email:'info@receipt-nest.com',name:'ReceiptNest'},
    replyTo: {email:'info@receipt-nest.com',name:'ReceiptNest'}, subject:'Weekly spend summary',
    html:'<html><head></head><body>Summary</body></html>', text:'Summary',
    headers:{'List-Unsubscribe':'<https://receipt-nest.com/unsubscribe?token=example>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},
    attachments:[{content:Buffer.from('preview').toString('base64'),filename:'preview.png',type:'image/png',disposition:'inline',contentId:'preview-icon'}],
  };
  await sendSendgridMail('local-only',message);
  const body = JSON.parse(JSON.stringify(requests[0].body));
  assert.equal(requests[0].url, '/v3/mail/send');
  assert.equal(body.subject, message.subject);
  assert.deepEqual(body.from, message.from);
  assert.deepEqual(body.reply_to, message.replyTo);
  assert.deepEqual(body.headers, message.headers);
  assert.equal(body.attachments[0].content_id, 'preview-icon');
  for (const content of body.content) assert.match(content.value, /Follow ReceiptNest/);
  assert.equal(message.text, 'Summary');
  assert.doesNotMatch(message.html, /Follow ReceiptNest/);
  await sendSendgridMail('local-only',{to:message.to,from:message.from,subject:'Plain text',text:'Hello'});
  assert.equal(requests[1].body.content.length, 1);
  assert.equal(requests[1].body.content[0].type, 'text/plain');
  assert.match(requests[1].body.content[0].value,/Follow ReceiptNest/);
});
