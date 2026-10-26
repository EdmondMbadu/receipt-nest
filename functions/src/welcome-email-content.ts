import { renderOnboardingButton } from "./onboarding-email-content";

export function buildWelcomeEmailContent(baseUrl: string) {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const watchUrl = `${base}/getting-started#walkthrough`;
  const uploadUrl = `${base}/app?addReceipt=1`;
  const posterUrl = `${base}/media/getting-started/receiptnest-quick-start-v1.jpg`;
  const subject = 'Welcome to ReceiptNest — start with one receipt';
  const preheader = 'Snap or upload. We organize the details. Download whenever you need them.';
  const text = `Welcome to ReceiptNest!\n\nYour account is ready. Snap a receipt or upload a photo or PDF. ReceiptNest reads the key details, categorizes it and saves it automatically. For most receipts, that’s all you need to do.\n\nFind it later with search, download the original, or export a month when you need it.\n\nAdd your first receipt: ${uploadUrl}\n\nPrefer a quick demonstration?\nSee how to add a receipt, let ReceiptNest organize it, and download it later.\nWatch the 85-second walkthrough: ${watchUrl}`;
  const bodyHtml = `
    <p style="margin:0 0 16px; font-size:15px; line-height:1.7;">Your account is ready. Snap a receipt or upload a photo or PDF. ReceiptNest reads the key details, categorizes it and saves it automatically. For most receipts, that’s all you need to do.</p>
    <p style="margin:0 0 20px; font-size:15px; line-height:1.7;">Find it later with search, download the original, or export a month when you need it.</p>
    ${renderOnboardingButton(uploadUrl)}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #e0e5e1;">
      <tr><td style="padding:24px 0 0;">
        <h2 style="margin:0 0 10px; font-size:18px; line-height:1.4; color:#17231f;">Prefer a quick demonstration?</h2>
        <p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#626e67;">See how to add a receipt, let ReceiptNest organize it, and download it later.</p>
        <a href="${watchUrl}" style="display:block; text-decoration:none;"><img src="${posterUrl}" width="480" alt="Watch the 85-second ReceiptNest walkthrough: snap, organize, download" style="display:block; width:100%; max-width:480px; height:auto; border:0; border-radius:6px;" /></a>
        <p style="margin:16px 0 0;"><a href="${watchUrl}" style="color:#32594a; font-size:14px; line-height:1.6; font-weight:700; text-decoration:underline;">&#9654; Watch the 85-second walkthrough</a></p>
      </td></tr>
    </table>`;
  return { subject, preheader, text, bodyHtml };
}
