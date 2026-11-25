// Synthetic Wells Fargo Zelle template; no customer identifiers or source bytes.
const source = {
  subject: 'Fwd: You sent money with Zelle',
  sender: 'Customer <customer@example.com>',
  recipient: 'customer@inbound.example.com',
  text: '',
  html: `<div>---------- Forwarded message ---------<br>
From: Wells Fargo &lt;alerts@notify.wellsfargo.com&gt;<br>
Date: Thu, Nov 26, 2026 at 2:01 PM<br>
Subject: You sent money with Zelle<br>
To: &lt;customer@example.com&gt;</div>
<table><tr><td><table><tr><td><p>You sent $125.50 to EXAMPLE RECIPIENT</p></td></tr>
<tr><td><p>Date: 11/07/2026</p></td></tr>
<tr><td><p>From account: ...0000</p></td></tr>
<tr><td><p>Confirmation: EXAMPLE1234</p></td></tr>
<tr><td><p>See Zelle® Activity</p></td></tr>
<tr><td><p>Didn't send this money? Please contact us.</p></td></tr>
<tr><td><p>Thank you for choosing Wells Fargo.</p></td></tr></table></td></tr>
<tr><td><p>Enrollment with Zelle® through Wells Fargo Online® is required.
Account fees may apply. Please do not reply to this automated email.</p></td></tr></table>`,
};
module.exports = {source};
