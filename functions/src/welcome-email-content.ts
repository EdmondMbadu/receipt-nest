export function buildWelcomeEmailContent(baseUrl: string) {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const watchUrl = `${base}/getting-started#walkthrough`;
  const uploadUrl = `${base}/app?addReceipt=1`;
  const posterUrl = `${base}/media/getting-started/receiptnest-quick-start-v1.jpg`;
  const subject = 'Welcome to ReceiptNest — start with one receipt';
  const preheader = 'Snap or upload. We organize the details. Download whenever you need them.';
  const text = `Welcome to ReceiptNest!\n\nYour account is ready. Snap a receipt or upload a photo or PDF. ReceiptNest reads the key details, categorizes it and saves it automatically. For most receipts, that’s all you need to do.\n\nFind it later with search, download the original, or export a month when you need it.\n\nAdd your first receipt: ${uploadUrl}\n\nPrefer a quick demonstration?\nSee how to add a receipt, let ReceiptNest organize it, and download it later.\nWatch the 85-second walkthrough: ${watchUrl}`;
  const bodyHtml = `
    <p style="margin:0 0 12px; font-size:15px; line-height:1.6;">Welcome to ReceiptNest,</p>
    <p style="margin:0 0 16px; font-size:15px; line-height:1.7;">Your account is ready. Snap a receipt or upload a photo or PDF. ReceiptNest reads the key details, categorizes it and saves it automatically. For most receipts, that’s all you need to do.</p>
    <p style="margin:0 0 20px; font-size:15px; line-height:1.7;">Find it later with search, download the original, or export a month when you need it.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 28px;"><tr><td bgcolor="#047857" style="border-radius:12px;"><a href="${uploadUrl}" style="display:inline-block; padding:14px 22px; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none;">Add your first receipt</a></td></tr></table>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #d6fae8; border-radius:14px; background:#f8fafc;">
      <tr><td style="padding:20px;">
        <h2 style="margin:0 0 10px; font-size:18px; line-height:1.4; color:#0f172a;">Prefer a quick demonstration?</h2>
        <p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#475569;">See how to add a receipt, let ReceiptNest organize it, and download it later.</p>
        <a href="${watchUrl}" style="display:block; text-decoration:none;"><img src="${posterUrl}" width="480" alt="Watch the 85-second ReceiptNest walkthrough: snap, organize, download" style="display:block; width:100%; max-width:480px; height:auto; border:0; border-radius:10px;" /></a>
        <p style="margin:16px 0 0;"><a href="${watchUrl}" style="color:#047857; font-size:14px; line-height:1.6; font-weight:700; text-decoration:underline;">&#9654; Watch the 85-second walkthrough</a></p>
      </td></tr>
    </table>`;
  return { subject, preheader, text, bodyHtml };
}
