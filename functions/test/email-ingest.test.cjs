const {test} = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('cheerio');
const {emailExtractionText,buildEmailHtml,extractionExcerpt} = require('../lib/email-content');
const {validateEmailValues,emailMoney,emailDate} = require('../lib/email-intelligence');
const {freezeEmailAssets,publicAssetUrl,publicAssetAddress} = require('../lib/email-renderer');
const {enrichInboundPayload,isInlineEmailAsset,emailDeliveryId,parseInboundEmail} = require('../lib/email-ingest');
const {source,html,image} = require('./fixtures/forwarded-transfer.cjs');

test('Western Union chooses total paid, retains principal/fees/recipient and correct transaction date/category despite a wrong AI answer', () => {
  const text=emailExtractionText(html,'ignored plain alternative');
  assert.ok(!text.includes('Hidden preheader')); assert.ok(!text.includes('\u200c'));
  const result=validateEmailValues({total:600,merchant:'Western Union',category:'Shopping',date:'2026-11-08'},text,'customer@example.com');
  assert.equal(result.totalAmount.value,670.99);assert.equal(result.currency.value,'USD');
  assert.equal(result.transferAmount.value,600);assert.equal(result.fees.value,70.99);assert.equal(result.recipientAmount.value,600);
  assert.equal(result.date.value,'2026-11-07');assert.equal(result.category.id,'money_transfers');
  assert.match(result.totalAmount.rawText,/Total 670.99 USD/);assert.deepEqual(result.reviewReasons,[]);
});

test('mismatched arithmetic, conflicting totals, unsupported currency and missing dates require review', () => {
  const text=emailExtractionText(html,'');
  assert.ok(validateEmailValues({},text.replace(/670\.99/g,'680.99'),'').reviewReasons.includes('Transfer amount plus fees does not match total paid'));
  assert.ok(validateEmailValues({},text.replace('Total | 670.99','Total | 800.00'),'').reviewReasons.includes('Conflicting labeled totals'));
  assert.ok(validateEmailValues({},'Total $25.00\nTransaction date 2026-11-07','').reviewReasons.includes('Missing or ambiguous currency'));
  assert.ok(validateEmailValues({},'Total 25.00 USD\nForwarded on 2026-11-08','').reviewReasons.includes('Missing or ambiguous transaction date'));
});

test('a forwarded SunStrong payment confirmation supports USD and its labeled payment date', () => {
  const html = `<div>---------- Forwarded message ---------<br>From: &lt;NOREPLY@myaccountinfo.com&gt;<br>
    Date: Wed, Nov 11, 2026</div>
    <table><tr><td>Bill Charge Credit Card Payment Confirmation</td></tr>
    <tr><td>Total Amount:</td><td>$50.00</td></tr>
    <tr><td>Request Date:</td><td>11/09/2026</td></tr>
    <tr><td>Payment Date:</td><td>11/10/2026</td></tr></table>
    <p>For questions please call 866-279-5421.</p>`;
  const body = emailExtractionText(html, '');
  const validate = text => validateEmailValues({merchant: 'Bill Charge'}, text, 'customer@example.com');
  const result = validate(body);
  assert.deepEqual(result.reviewReasons, []);
  assert.equal(result.totalAmount.value, 50);
  assert.equal(result.currency.value, 'USD');
  assert.equal(result.date.value, '2026-11-10');
  assert.match(result.date.rawText, /Payment Date.*11\/10\/2026/i);
  assert.equal(validate(body.replace('866-279-5421', '866-111-2222')).currency, undefined);
  assert.equal(validate(body.replace('NOREPLY@myaccountinfo.com', 'merchant@example.com')).currency, undefined);
  assert.equal(validate(body.replace('Payment Date:', 'Scheduled Payment Date:')).date, undefined);
  assert.equal(validate(body + '\nPayment Date: 11/12/2026').date, undefined);
});

const cardAlert = `<div>---------- Forwarded message ---------<br>
  From: Bank Alerts &lt;alerts@notify.wellsfargo.com&gt;<br>
  Date: 11/15/2026<br>Subject: Card purchase<br>To: &lt;customer@example.com&gt;</div>
  <table><tr><td><p>You made a purchase of $100.00</p></td></tr>
  <tr><td><p>Card number: <strong>…0000</strong></p></td></tr>
  <tr><td><p>Purchase amount: <strong>$100.00</strong></p></td></tr>
  <tr><td><p>Merchant: <strong>EXAMPLE *SUBSCRIPTION</strong> in <strong>CA, USA</strong></p></td></tr>
  <tr><td><p>Date: <strong>11/07/2026</strong></p></td></tr></table>`;
const cardAlertText = emailExtractionText(cardAlert, '');

test('a forwarded card purchase alert supports source amount, merchant, currency and date without using the forward headers as evidence', () => {
  const result = validateEmailValues({total: 500, date: '2026-11-15', dateEvidence: 'Date: 11/15/2026', category: 'Subscriptions'}, cardAlertText, 'customer@example.com');
  assert.deepEqual(result.reviewReasons, []);
  assert.equal(result.transactionType, 'purchase');
  assert.equal(result.totalAmount.value, 100);
  assert.equal(result.currency.value, 'USD');
  assert.equal(result.date.value, '2026-11-07');
  assert.equal(result.supplierName.value, 'EXAMPLE *SUBSCRIPTION');
  assert.match(result.totalAmount.rawText, /^Purchase amount/i);
  assert.match(result.date.rawText, /11\/07\/2026/);

  const otherIssuer = cardAlertText.replace('alerts@notify.wellsfargo.com', 'alerts@example.ca')
    .replaceAll('$100.00', 'CAD 100.00').replace('Purchase amount', 'Transaction amount').replace('11/07/2026', '2026-11-07');
  const other = validateEmailValues({}, otherIssuer, 'customer@example.com');
  assert.deepEqual(other.reviewReasons, []);
  assert.equal(other.totalAmount.value, 100);
  assert.equal(other.currency.value, 'CAD');
  assert.equal(other.date.value, '2026-11-07');

  const plainText = cardAlertText.replace('Purchase amount: $100.00', 'Purchase amount: * $100.00 *')
    .replace('EXAMPLE *SUBSCRIPTION in CA, USA', '*EXAMPLE *SUBSCRIPTION* *in* *CA, USA*')
    .replace('Date: 11/07/2026', 'Date: * 11/07/2026 *');
  const plain = validateEmailValues({}, emailExtractionText('', plainText), 'customer@example.com');
  assert.deepEqual(plain.reviewReasons, []);
  assert.equal(plain.currency.value, 'USD');
  assert.equal(plain.supplierName.value, 'EXAMPLE *SUBSCRIPTION');
  assert.equal(plain.date.value, '2026-11-07');
  assert.equal(validateEmailValues({}, cardAlertText.replace('11/07/2026', 'November 7, 2026'), '').date.value, '2026-11-07');
});

test('card alert evidence leaves conflicting amounts, ambiguous currency and unrelated dates for review', () => {
  const validate = text => validateEmailValues({}, text, 'customer@example.com');
  const noDate = cardAlertText.replace('Date: 11/07/2026', 'Scheduled date: 11/07/2026');
  assert.equal(validate(noDate).date, undefined);
  assert.equal(validate(cardAlertText.replace('Date: 11/07/2026', 'Date: 11/07/2026\nDate: 11/08/2026')).date, undefined);
  assert.equal(validate(cardAlertText.replace('notify.wellsfargo.com', 'wellsfargo.com.example.ca')).currency, undefined);
  assert.equal(validate(cardAlertText.replace('CA, USA', 'Toronto, Canada')).currency, undefined);
  assert.equal(validate(cardAlertText.replace('CA, USA', 'Toronto, Canada') + '\nBilling help in EUR').currency, undefined);
  assert.equal(validate(cardAlertText.replace('Purchase amount: $100.00', 'Purchase amount: $120.00')).totalAmount, undefined);
  assert.equal(validate(cardAlertText.replace('You made a purchase of', 'Your pending authorization is for')).totalAmount, undefined);
  assert.equal(validate(cardAlertText + '\nGrand total 125.00 USD').totalAmount, undefined);
  assert.equal(validate(cardAlertText.replace('11/07/2026', 'February 30, 2026')).date, undefined);
});

test('money/date parsing rejects malformed input and calendar rollover, preserves international decimal amounts', () => {
  for(const [raw,value] of [['670.99 USD',670.99],['1,234.56 USD',1234.56],['1.234,56 EUR',1234.56],['12,50 EUR',12.5]])assert.equal(emailMoney(raw),value);
  for(const raw of ['600abc99','1,2,3','--3','NaN','Infinity'])assert.equal(emailMoney(raw),undefined);
  assert.equal(emailDate('2026-02-31'),undefined);assert.equal(emailDate('2026-13-01'),undefined);
  assert.equal(emailDate('11-07-2026'),undefined);assert.equal(emailDate('11-07-2026',true),'2026-11-07');
});

test('long emails retain late transaction evidence in the AI budget', () => {
  const value='Opening\n'+'Long terms text.\n'.repeat(3000)+'\nGrand total | 123.45 EUR\nTransaction date | 2026-11-07\nFooter';
  const excerpt=extractionExcerpt(value);assert.ok(excerpt.length<=18000);assert.match(excerpt,/123.45 EUR/);assert.match(excerpt,/2026-11-07/);
});

test('saved display preserves CSS, tables, all terms and inline images while excluding active content', () => {
  const document=buildEmailHtml({...source,html:source.html+'<script>alert(1)</script><img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe><a href="javascript:alert(1)">bad</a>'});
  const $=load(document);assert.match($('style').text(),/ffdd00/);assert.equal($('table').length,1);
  assert.match($('img').first().attr('src'),/^data:image\/png/);assert.match($('body').text(),/final footer retained/);
  assert.equal($('script,iframe,[onerror]').length,0);assert.equal($('a[href^="javascript:"]').length,0);
  assert.match($('meta[http-equiv="Content-Security-Policy"]').attr('content'),/default-src 'none'/);
});

test('asset capture deduplicates requests, embeds available images and degrades without losing text', async () => {
  const calls=[];
  const result=await freezeEmailAssets('<html><body><p>Keep this</p><img src="https://images.example.com/logo.png"><img src="https://images.example.com/logo.png"><img alt="Missing logo" src="https://images.example.com/missing.png"><img src="http://127.0.0.1/private"></body></html>',async url=>{
    calls.push(url);if(url.endsWith('missing.png'))throw new Error('timeout');return image;
  });
  assert.equal(calls.length,2);assert.equal(result.missingAssets,2);assert.match(result.html,/Keep this/);assert.match(result.html,/data:image\/png/);assert.match(result.html,/Missing logo/);
  assert.doesNotMatch(result.html,/<img[^>]*src="https?:/);
});

test('remote asset policy rejects local, private, credentialed and non-HTTPS destinations', () => {
  for(const url of ['http://images.example.com/a','https://127.0.0.1/a','https://[::1]/a','https://metadata.google.internal/a','https://user:secret@example.com/a','file:///etc/passwd','https://example.com:8443/a'])assert.throws(()=>publicAssetUrl(url));
  for(const ip of ['127.0.0.1','10.1.2.3','192.168.1.1','169.254.169.254','100.64.0.1','::1','fe80::1','::ffff:127.0.0.1'])assert.equal(publicAssetAddress(ip),false,ip);
  assert.equal(publicAssetAddress('8.8.8.8'),true);
});

test('MIME parsing preserves nested alternatives and embedded images without turning a logo into a receipt', async () => {
  const raw=['From: Store <store@example.com>','To: customer@inbound.example.com','Subject: Test receipt','Date: Sat, 07 Nov 2026 16:13:52 +0000','Message-ID: <original@example.com>','MIME-Version: 1.0','Content-Type: multipart/related; boundary=outer','','--outer','Content-Type: multipart/alternative; boundary=inner','','--inner','Content-Type: text/plain; charset=utf-8','','Total 670.99 USD','--inner','Content-Type: text/html; charset=utf-8','Content-Transfer-Encoding: quoted-printable','','<p>Total 670.99 USD</p><img src=3D"cid:logo">','--inner--','--outer','Content-Type: image/png','Content-ID: <logo>','Content-Disposition: inline; filename=logo.png','Content-Transfer-Encoding: base64','',image.split(',')[1],'--outer--',''].join('\r\n');
  const parsed=await enrichInboundPayload({fields:{email:raw},attachments:[]});
  assert.match(parsed.fields.html,/cid:logo/);assert.equal(parsed.fields['message-id'],'<original@example.com>');
  assert.equal(parsed.attachments.length,1);assert.equal(isInlineEmailAsset(parsed.attachments[0],parsed.fields),true);
  assert.equal(parsed.fields.email,raw);assert.equal(emailDeliveryId(parsed),emailDeliveryId(parsed));
});

test('provider content-id metadata distinguishes inline logos from invoice attachments', async()=>{
  const parsed=await enrichInboundPayload({fields:{html:'<img src="cid:brand">','content-ids':'{"brand":"attachment1"}'},attachments:[
    {fieldName:'attachment1',fileName:'logo.png',mimeType:'image/png',data:Buffer.from('logo')},
    {fieldName:'attachment2',fileName:'invoice.pdf',mimeType:'application/pdf',data:Buffer.from('pdf')},
  ]});
  assert.equal(isInlineEmailAsset(parsed.attachments[0],parsed.fields),true);assert.equal(isInlineEmailAsset(parsed.attachments[1],parsed.fields),false);
});

test('multipart transport preserves binary attachment bytes including trailing newlines',async()=>{
  const bytes=Buffer.from([0,255,13,10]);
  const rawBody=Buffer.concat([Buffer.from('--boundary\r\nContent-Disposition: form-data; name="attachment1"; filename="invoice.pdf"\r\nContent-Type: application/pdf\r\n\r\n'),bytes,Buffer.from('\r\n--boundary--\r\n')]);
  const result=await parseInboundEmail({headers:{'content-type':'multipart/form-data; boundary=boundary'},rawBody});
  assert.deepEqual(result.attachments[0].data,bytes);
});
