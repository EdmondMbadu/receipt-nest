const { test } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./fixtures/email-harness.cjs');
const sendgrid = require('../lib/sendgrid');
const { notifyAdminReceiptNeedsReview } = require('../lib/receipt-review-alerts');

test('alerts cover all users on entry into review and deduplicate Firestore retries', async t => {
  harness(t);
  const sent = [];
  let providerUnavailable = true;
  const send = sendgrid.sendSendgridMail;
  t.after(() => { sendgrid.sendSendgridMail = send; });
  sendgrid.sendSendgridMail = async (_, message) => {
    if (providerUnavailable) throw new Error('SendGrid unavailable');
    sent.push(message);
  };
  const snapshot = status => ({
    get: key => key === 'status' ? status : undefined,
    data: () => ({status, notes: 'Private receipt notes', totalAmount: 50}),
  });
  const run = (id, userId, before, after) => notifyAdminReceiptNeedsReview.run({
    id, params: {userId, receiptId:'r1'}, data:{before:snapshot(before), after:snapshot(after)},
  });
  await run('healthy', 'customer-a', 'processing', 'final');
  await run('already-in-review', 'customer-a', 'needs_review', 'needs_review');
  assert.equal(sent.length, 0);
  await assert.rejects(run('email-review', 'customer-a', undefined, 'needs_review'), /SendGrid unavailable/);
  providerUnavailable = false;
  await run('email-review', 'customer-a', undefined, 'needs_review');
  await run('email-review', 'customer-a', undefined, 'needs_review');
  await run('upload-review', 'customer-b', 'processing', 'needs_review');
  assert.deepEqual(sent.map(message => message.to), ['gervais@receipt-nest.com', 'gervais@receipt-nest.com']);
  assert.match(sent[0].text, /receipt-issues\/customer-a\/r1/);
  assert.match(sent[1].text, /receipt-issues\/customer-b\/r1/);
  assert.doesNotMatch(sent[0].text, /Private receipt notes/);
});
