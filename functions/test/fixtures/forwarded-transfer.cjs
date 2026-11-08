// Synthetic fixture: the amount/date structure reproduces the reported failure without personal data.
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const rows = [
  ['Date of Transactions', '11-07-2026 11:13:45 ET'], ['Sender country', 'UNITED STATES'],
  ['Transfer Amount', '600.00 USD'], ['Transfer Fees', '+ 70.99 USD'], ['Total', '670.99 USD'],
  ['Transfer Amount', '600.00 USD'], ['Total', '670.99 USD'], ['Total to Final Receiver', '600.00 USD'],
];
const html = `<!doctype html><html><head><style>
body{font-family:Arial,sans-serif}table{border-collapse:collapse}.receipt{width:720px;margin:auto}.brand{background:#ffdd00;padding:24px;font-size:30px;font-weight:bold}.row td{padding:12px 18px;border-bottom:1px solid #ddd}.total{background:#fff3a3;font-weight:bold}.terms{font-size:11px;line-height:1.5;padding:18px}
</style></head><body><div style="display:none">Hidden preheader ${'\u200c '.repeat(230)}</div>
<table class="receipt"><tr><td colspan="2" class="brand">Western Union <img src="cid:logo" alt="Test image" width="24" height="24"></td></tr>
<tr><td colspan="2" style="padding:24px"><h1>Your transfer is ready for pickup</h1><p>Hello Sample Customer,</p><p>Your money transfer is available. This is a synthetic test receipt.</p></td></tr>
${rows.map(([label, value]) => `<tr class="row ${label === 'Total' ? 'total' : ''}"><td>${label}</td><td>${value}</td></tr>`).join('')}
<tr><td colspan="2" class="terms">${Array.from({length:70},(_,i)=>`<p>Test terms section ${i+1}. This paragraph verifies that a long forwarded email is preserved across PDF pages. It includes selectable text, punctuation, accents such as café and currencies such as € and £.</p>`).join('')}<p>END OF COMPLETE EMAIL — final footer retained.</p></td></tr></table></body></html>`;
const source = {subject:'Fwd: Your transfer is ready for pickup',sender:'Sample Customer <customer@example.com>',recipient:'customer@inbound.example.com',sentAt:'2026-11-07T16:14:55Z',html,text:rows.map(row=>row.join('\n')).join('\n'),inlineImages:{logo:image}};
module.exports = {html,source,image,rows};
