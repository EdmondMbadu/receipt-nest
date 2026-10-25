const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const {buildSpendSummaryHtml, getSpendSummaryAttachments} = require('../lib/spend-summary-template');
const {appendEmailSocialHtml, EMAIL_SOCIAL_LINKS} = require('../lib/email-social-links');
const {buildUnsubscribeUrls, verifyUnsubscribeToken} = require('../lib/email-suppression');
const {APP_STORE_URL, GOOGLE_PLAY_URL} = require('../lib/email-app-links');
const {fixture, emptyFixture, rawReceipts} = require('./fixtures/spend-summary.cjs');

async function document(html) {
  const {parse} = await import('parse5');
  const errors = [];
  const root = parse(html, {onParseError: error => errors.push(error.code)});
  assert.deepEqual(errors, [], 'HTML must parse without repairs');
  const elements = [];
  const visit = node => { if (node.tagName) elements.push(node); (node.childNodes || []).forEach(visit); };
  visit(root);
  return elements;
}
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');

for (const period of ['week', 'month']) test(`${period}: complete calm layout, correct copy, links and no duplicate social card`, async () => {
  const data = fixture(period);
  const signed = buildUnsubscribeUrls('preview@example.com', 'https://receipt-nest.com', 'local-test-signing-secret');
  const html = buildSpendSummaryHtml(data, {unsubscribeUrl: signed.pageUrl});
  const nodes = await document(html);
  assert.match(text(nodes.find(n => n.tagName === 'h1')), new RegExp(`Your ${period}, at a glance`));
  assert.match(html, period === 'week' ? /Thursday accounted for 77%/ : /Week 3 .* accounted for 81%/);
  assert.match(html, /\$777\.63/); assert.match(html, /\$70\.69/);
  assert.equal((html.match(/>Total spend</g) || []).length, 1);
  assert.equal((html.match(/>Open dashboard /g) || []).length, 1);
  assert.doesNotMatch(html, /gradient\(|box-shadow|VERIFIED|REVIEW SECURITY|#eef4ff|<svg|display:flex|display:grid/);
  assert.ok(Buffer.byteLength(html) < 80_000, 'Leave headroom below Gmail clipping');
  const hrefs = nodes.filter(n => n.tagName === 'a').map(n => attr(n, 'href'));
  for (const href of ['https://receipt-nest.com', 'https://receipt-nest.com/app', 'https://receipt-nest.com/support', 'https://receipt-nest.com/terms', signed.pageUrl, APP_STORE_URL, GOOGLE_PLAY_URL, ...EMAIL_SOCIAL_LINKS.map(x => x.href)]) {
    assert.ok(hrefs.includes(href), href);
  }
  for (const href of hrefs) assert.equal(new URL(href).protocol, 'https:');
  const unsubscribe = hrefs.find(url => url.includes('/unsubscribe'));
  assert.equal(verifyUnsubscribeToken(new URL(unsubscribe).searchParams.get('token'), 'local-test-signing-secret'), 'preview@example.com');
  assert.equal(appendEmailSocialHtml(html), html, 'transport must preserve compact footer');
  assert.equal(nodes.filter(n => attr(n, 'id') === 'receiptnest-social-footer').length, 1);
  for (const receipt of data.recentReceipts) assert.ok(text(nodes.find(n => n.tagName === 'body')).includes(receipt.merchantName));
});

test('embedded logo is byte-for-byte the official brand asset, and every CID resolves', async () => {
  const attachments = getSpendSummaryAttachments();
  const logo = attachments.find(a => a.filename === 'receipt-nest.png');
  assert.deepEqual(Buffer.from(logo.content, 'base64'), readFileSync(require('node:path').resolve(__dirname, '../../public/receipt-nest.png')));
  const nodes = await document(buildSpendSummaryHtml(fixture()));
  for (const img of nodes.filter(n => n.tagName === 'img')) {
    const cid = attr(img, 'src').slice(4);
    assert.ok(attachments.some(a => a.contentId === cid), `unresolved CID ${cid}`);
    assert.ok(attr(img, 'width') && attr(img, 'height'));
  }
});

test('bars scale exactly to the largest amount, with no artificial minimum or zero fills', async () => {
  const nodes = await document(buildSpendSummaryHtml(fixture()));
  const chart = nodes.find(n => n.tagName === 'table' && attr(n, 'aria-label') === 'Daily spending');
  const rows = chart.childNodes.find(n => n.tagName === 'tbody').childNodes.filter(n => n.tagName === 'tr');
  const descendants = node => [node, ...(node.childNodes || []).flatMap(descendants)];
  const widths = rows.map(row => descendants(row).find(n => attr(n, 'class') === 'rn-bar')).map(bar => bar ? Number(attr(bar, 'width').replace('%', '')) : 0);
  assert.deepEqual(widths, [5.17, 16.68, 3.34, 100, 4.5, 0, 0]);
});

test('empty weekly and monthly summaries remain complete without fabricated highlights', async () => {
  for (const period of ['week', 'month']) {
    const html = buildSpendSummaryHtml(emptyFixture(period));
    await document(html);
    assert.match(html, /No receipts were recorded/);
    assert.match(html, /No spending recorded/);
    assert.doesNotMatch(html, /accounted for|class="rn-bar"|NaN|Infinity|undefined/);
  }
});

test('mixed currencies and refunds keep their caveats and suppress misleading insights', () => {
  const mixed = fixture(); mixed.mixedCurrencies = true;
  const mixedHtml = buildSpendSummaryHtml(mixed);
  assert.match(mixedHtml, /Totals are combined without currency conversion/);
  assert.doesNotMatch(mixedHtml, /accounted for|69% of total/);
  const refunded = fixture(); refunded.activity[0].amount = -10;
  const refundHtml = buildSpendSummaryHtml(refunded);
  assert.match(refundHtml, /-\$10\.00/);
  assert.match(refundHtml, /Refunds reduce the totals/);
  assert.doesNotMatch(refundHtml, /accounted for|width="-/);
});

test('personal text and URL parameters are escaped without breaking destinations', async () => {
  const data = fixture();
  data.userName = '<Edmond> Test';
  data.recentReceipts[0] = {...data.recentReceipts[0], merchantName: 'A&B <script>alert(1)</script> "Shop"', categoryName: '<Utilities>'};
  const url = 'https://receipt-nest.com/app?a=1&b="two"';
  const html = buildSpendSummaryHtml(data, {dashboardUrl: url});
  const nodes = await document(html);
  assert.equal(nodes.filter(n => n.tagName === 'script').length, 0);
  assert.match(html, /Hi &lt;Edmond&gt;/);
  assert.match(html, /A&amp;B &lt;script&gt;/);
  assert.ok(nodes.some(n => attr(n, 'href') === url));
});

test('real admin and scheduled sends use the new template, correct periods and delivery metadata', async t => {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({projectId: 'demo-summary-email-tests'});
  const db = admin.firestore();
  const sg = require('@sendgrid/mail');
  const originals = {doc: db.doc, collection: db.collection, getAll: db.getAll, request: sg.client.request, key: sg.setApiKey};
  const savedEnv = Object.fromEntries(['SENDGRID_API_KEY', 'APP_BASE_URL', 'UNSUBSCRIBE_TOKEN_SECRET'].map(k => [k, process.env[k]]));
  process.env.SENDGRID_API_KEY = 'local-only'; process.env.APP_BASE_URL = 'https://receipt-nest.com/'; process.env.UNSUBSCRIBE_TOKEN_SECRET = 'local-test-signing-secret';
  t.after(() => {
    db.doc = originals.doc; db.collection = originals.collection; db.getAll = originals.getAll; sg.client.request = originals.request; sg.setApiKey = originals.key;
    for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const requests = []; const scheduleWrites = [];
  const user = {email: 'preview@example.com', firstName: 'Edmond', lastName: 'Mbadu'};
  let period = 'week';
  db.doc = path => {
    if (path === 'users/summary-fixture') return {get: async () => ({exists: true, data: () => user})};
    if (path === 'systemConfig/spendSummaryEmailSchedule') return {
      get: async () => ({data: () => ({timeZone: 'America/Los_Angeles', weekly: {enabled: period === 'week', dayOfWeek: 'monday', time: '08:00'}, monthly: {enabled: period === 'month', dayOfMonth: 1, time: '08:00'}})}),
      set: async data => scheduleWrites.push(data),
    };
    throw new Error('Unexpected document: ' + path);
  };
  db.collection = path => {
    if (path === 'users/summary-fixture/receipts') return {get: async () => ({docs: rawReceipts.map(data => ({data: () => data}))})};
    if (path === 'users') return {get: async () => ({docs: [{id: 'summary-fixture', data: () => user}]})};
    if (path === 'emailSuppressions') return {doc: id => ({id})};
    throw new Error('Unexpected collection: ' + path);
  };
  db.getAll = async (...refs) => refs.map(() => ({exists: false}));
  sg.setApiKey = () => undefined;
  sg.client.request = async request => {requests.push(JSON.parse(JSON.stringify(request.body))); return [{statusCode: 202}, {}];};
  const {sendSpendSummaryEmail, dispatchScheduledSpendSummaryEmails} = require('../lib/spend-summary-email');
  for (period of ['week', 'month']) {
    const result = await sendSpendSummaryEmail.run({auth: {uid: 'admin', token: {admin: true}}, data: {
      to: user.email, userId: 'summary-fixture', periodType: period, week: '2026-W42', month: '2026-10',
    }});
    assert.equal(result.receiptCount, 11); assert.ok(Math.abs(result.totalSpend - 777.63) < 0.00001);
    const body = requests.at(-1);
    assert.equal(body.from.name, 'ReceiptNest'); assert.equal(body.reply_to.email, 'info@receipt-nest.com');
    assert.match(body.subject, period === 'week' ? /Weekly.*Week of October 12/ : /Monthly.*October 2026/);
    const html = body.content.find(c => c.type === 'text/html').value;
    assert.match(html, new RegExp(`Your ${period}, at a glance`));
    if (period === 'month') {
      assert.match(html, /Oct 29–31/);
      assert.equal((html.match(/class="rn-chart-label"/g) || []).length, 5);
    }
    assert.equal((html.match(/id="receiptnest-social-footer"/g) || []).length, 1);
    assert.match(body.content.find(c => c.type === 'text/plain').value, /Open dashboard: https:\/\/receipt-nest.com\/app/);
    assert.ok(body.attachments.some(a => a.content_id === 'receiptnest-summary-logo'));
    await dispatchScheduledSpendSummaryEmails.run({scheduleTime: period === 'week' ? '2026-10-19T15:00:00Z' : '2026-11-01T16:00:00Z'});
    const scheduled = requests.at(-1);
    assert.equal(scheduled.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    const oneClick = new URL(scheduled.headers['List-Unsubscribe'].slice(1, -1));
    assert.equal(oneClick.pathname, '/api/email/unsubscribe');
    assert.equal(verifyUnsubscribeToken(oneClick.searchParams.get('token'), 'local-test-signing-secret'), user.email);
    const scheduledHtml = scheduled.content.find(c => c.type === 'text/html').value;
    assert.ok(scheduledHtml.includes('/unsubscribe?token='));
    assert.match(scheduledHtml, new RegExp(`Your ${period}, at a glance`));
  }
  assert.equal(requests.length, 4); assert.equal(scheduleWrites.length, 2);
});
