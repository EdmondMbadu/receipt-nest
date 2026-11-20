// Synthetic USCIS/Pay.gov template; no customer identifiers or source bytes.
const source = {
  subject: 'Fwd: Pay.gov Payment Confirmation: USCIS N-400',
  sender: 'Customer <customer@example.com>',
  recipient: 'customer@inbound.example.com',
  text: '',
  html: `<div>---------- Forwarded message ---------<br>
From: &lt;ELISdonotreply@uscis.dhs.gov&gt;<br>
Date: Thu, Nov 19, 2026 at 9:41 PM<br>
Subject: Pay.gov Payment Confirmation: USCIS N-400<br>
To: &lt;customer@example.com&gt;</div>
<p>Your payment has been submitted to Pay.gov and the details are below. If you have questions about this notification or need technical support, please contact us online.</p>
<p>Application Name: USCIS N-400&nbsp; &nbsp;</p>
<p>Pay.Gov Tracking ID: EXAMPLE123</p>
<p>Agency Tracking ID: EXAMPLE456</p>
<p>Transaction Type: Credit Card</p>
<p>Transaction Amount: $710.00</p>
<p>Payment Date: Nov 20, 2026</p>
<p>Transaction Date: Nov 20, 2026 12:41:21 AM</p>
<p>Your payment was applied to the following case(s): EXAMPLE789</p>
<p>THIS IS AN AUTOMATED MESSAGE. PLEASE DO NOT REPLY.</p>`,
};
module.exports = {source};
