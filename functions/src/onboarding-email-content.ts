import { APP_STORE_URL, GOOGLE_PLAY_URL } from "./email-app-links";
import { EMAIL_SOCIAL_LINKS } from "./email-social-links";
import { renderEmailBrand, getSpendSummaryAttachments } from "./spend-summary-template";

export const escapeEmailText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const link = (label: string, href: string) => `<a href="${escapeEmailText(href)}" style="color:#626e67; text-decoration:underline;">${escapeEmailText(label)}</a>`;
export const getOnboardingEmailAttachments = () => getSpendSummaryAttachments().filter(item => item.filename === "receipt-nest.png");

export const renderOnboardingButton = (url: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;"><tr><td bgcolor="#32594a" style="background:#32594a; border-radius:6px; mso-padding-alt:14px 24px;"><a class="rn-button" href="${escapeEmailText(url)}" style="display:inline-block; padding:14px 24px; border:1px solid #32594a; border-radius:6px; background:#32594a; color:#ffffff; font-size:14px; line-height:20px; font-weight:600; text-decoration:none;">Add your first receipt &nbsp;→</a></td></tr></table>`;

export const buildOnboardingEmailHtml = (options: {
  subject: string; title: string; preheader: string; bodyHtml: string; baseUrl: string; unsubscribeUrl?: string;
}) => {
  const base = options.baseUrl.trim().replace(/\/+$/, "");
  return `<!DOCTYPE html><html lang="en"><head>
    <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" /><meta name="supported-color-schemes" content="light dark" />
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no" />
    <title>${escapeEmailText(options.subject)}</title>
    <style>
      body,table,td,p,h1,h2,a { font-family:Arial,Helvetica,sans-serif; }
      table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
      a { overflow-wrap:anywhere; }
      p,h1,h2 { overflow-wrap:anywhere; }
      @media screen and (max-width:600px) { .rn-content { padding:24px 22px 32px !important; } .rn-title { font-size:30px !important; } }
      @media (prefers-color-scheme:dark) {
        body,.rn-surface { background-color:#151e19 !important; color:#edf2ef !important; }
        p,h1,h2,td,a { color:#edf2ef !important; }
        p[style*="#626e67"],.rn-muted { color:#b2beb6 !important; }
        td[style*="border"],p[style*="border"] { border-color:#354039 !important; }
        .rn-button { background:#32594a !important; color:#ffffff !important; }
      }
    </style>
  </head><body style="margin:0; padding:0; width:100%; background-color:#ffffff; color:#17231f; -webkit-text-size-adjust:100%;">
    <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px;">${escapeEmailText(options.preheader)}</div>
    <table class="rn-surface" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; background-color:#ffffff;"><tr><td align="center">
      <!--[if mso]><table role="presentation" width="740" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table class="rn-surface" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; max-width:740px; background-color:#ffffff;"><tr><td class="rn-content" style="padding:28px 44px 40px; font-family:Arial,Helvetica,sans-serif;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding-bottom:22px;">${renderEmailBrand()}</td></tr>
          <tr><td style="padding:32px 0; border-top:1px solid #e0e5e1; color:#17231f;">
            <h1 class="rn-title" style="margin:0 0 22px; font-size:38px; line-height:1.18; letter-spacing:-1.2px; font-weight:700; color:#17231f;">${escapeEmailText(options.title)}</h1>
            ${options.bodyHtml}
          </td></tr>
          <tr><td style="padding:26px 0 0; border-top:1px solid #e0e5e1; font-size:12px; line-height:1.8; color:#626e67;">
            ${renderEmailBrand(true)}
            <p style="margin:10px 0 0; font-size:12px; line-height:1.8; color:#626e67;">Your receipts. A clearer picture.</p>
            <p style="margin:4px 0 0; font-size:12px; line-height:1.8; color:#626e67;">Get the app: ${link("App Store", APP_STORE_URL)} &nbsp;·&nbsp; ${link("Google Play", GOOGLE_PLAY_URL)}</p>
            <p id="receiptnest-social-footer" style="margin:4px 0 0; font-size:12px; line-height:1.8; color:#626e67;">${EMAIL_SOCIAL_LINKS.map(item => `<a href="${item.href}" aria-label="ReceiptNest on ${item.label}" style="display:inline-block; color:#626e67; text-decoration:underline;">${item.label}</a>`).join(" &nbsp;·&nbsp; ")}</p>
            <p style="margin:4px 0 0; font-size:12px; line-height:1.8; color:#626e67;">${link("Support", `${base}/support`)} &nbsp;·&nbsp; ${link("Email preferences", `${base}/app?settings=notifications`)} &nbsp;·&nbsp; ${link("Unsubscribe", options.unsubscribeUrl || `${base}/unsubscribe`)}</p>
            <p style="margin:12px 0 0; font-size:11px; line-height:1.8; color:#626e67;">© ${new Date().getFullYear()} ReceiptNest</p>
          </td></tr>
        </table>
      </td></tr></table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr></table>
  </body></html>`;
};

export const buildFirstReceiptReminder = (baseUrl: string, firstName: string, unsubscribeUrl: string) => {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const uploadUrl = `${base}/app?addReceipt=1`;
  const watchUrl = `${base}/getting-started#walkthrough`;
  const subject = "Start with one receipt. We’ll take it from there.";
  const preheader = "A small first step toward a little less paperwork.";
  const greeting = firstName.trim() ? `Hi ${firstName.trim()},` : "Hi there,";
  const bodyHtml = `
    <p style="margin:0 0 16px; font-size:16px; line-height:1.7; color:#17231f; overflow-wrap:anywhere;">${escapeEmailText(greeting)}</p>
    <p style="margin:0 0 16px; font-size:16px; line-height:1.7; color:#17231f;">Your ReceiptNest workspace is ready whenever you are.</p>
    <p style="margin:0 0 16px; font-size:16px; line-height:1.7; color:#17231f;">Start with a receipt you already have. Snap a photo, or upload an image or PDF. We’ll read the key details, organize them, and keep the original easy to find.</p>
    ${renderOnboardingButton(uploadUrl)}
    <p style="margin:0; font-size:14px; line-height:1.7; color:#626e67;">Prefer to see it first? <a href="${escapeEmailText(watchUrl)}" style="color:#32594a; text-decoration:underline;">Watch the 85-second walkthrough</a>.</p>
    <p style="margin:22px 0 0; font-size:14px; line-height:1.7; color:#626e67;">Already tried uploading? Your dashboard shows the receipt’s status. If you need a hand, <a href="${escapeEmailText(`${base}/support`)}" style="color:#32594a; text-decoration:underline;">we’re here to help</a>.</p>`;
  const text = `${greeting}\n\nYour ReceiptNest workspace is ready whenever you are.\n\nStart with a receipt you already have. Snap a photo, or upload an image or PDF. We’ll read the key details, organize them, and keep the original easy to find.\n\nAdd your first receipt: ${uploadUrl}\n\nWatch the 85-second walkthrough: ${watchUrl}\n\nAlready tried uploading? Your dashboard shows the receipt’s status. Need a hand? ${base}/support\n\nEmail preferences: ${base}/app?settings=notifications`;
  return { subject, preheader, text, html: buildOnboardingEmailHtml({ subject, title: "A little less paperwork.", preheader, bodyHtml, baseUrl: base, unsubscribeUrl }) };
};
