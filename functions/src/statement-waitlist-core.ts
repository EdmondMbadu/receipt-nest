/**
 * Pure helpers for the Statement Decoder early-access waitlist (no Firebase imports, unit-testable):
 * request validation and the confirmation email.
 */

export const WAITLIST_MAX_BODY_BYTES = 2048;
export const WAITLIST_SOURCES = ["charge_finish", "charge_article", "charge_link", "decoder_hero", "decoder_footer", "hub"] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

/** Which page's stats a signup is counted under. */
export const statsPageForSource = (source: WaitlistSource): "charge" | "decoder" | "hub" =>
  source.startsWith("decoder") ? "decoder" : source === "hub" ? "hub" : "charge";

const EMAIL_PATTERN = /^[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]{2,}$/;

export interface WaitlistRequest {
  name: string;
  email: string;
  source: WaitlistSource;
  bot: boolean;
}

export type WaitlistParseResult =
  | { ok: true; value: WaitlistRequest }
  | { ok: false; field: "name" | "email" | "body"; message: string };

/** Trim, collapse whitespace and strip control / markup characters from a first name. */
export const cleanName = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f<>{}\[\]\\/@]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
};

export const cleanEmail = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";

export const parseWaitlistRequest = (raw: string | undefined | null): WaitlistParseResult => {
  if (!raw || raw.length > WAITLIST_MAX_BODY_BYTES) return { ok: false, field: "body", message: "Invalid request." };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, field: "body", message: "Invalid request." };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, field: "body", message: "Invalid request." };
  const d = data as Record<string, unknown>;
  // Honeypot: real people never see or fill the "company" field; bots that fill it get a silent fake success.
  const bot = typeof d.company === "string" && d.company.trim().length > 0;
  const name = cleanName(d.name);
  const email = cleanEmail(d.email);
  if (!bot && name.length < 1) return { ok: false, field: "name", message: "Please add your first name." };
  if (!bot && !EMAIL_PATTERN.test(email)) return { ok: false, field: "email", message: "Please check your email address." };
  const source = (WAITLIST_SOURCES as readonly string[]).includes(String(d.source)) ? (d.source as WaitlistSource) : "charge_link";
  return { ok: true, value: { name, email, source, bot } };
};

const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "ana" -> "Ana"; leaves names with existing capitals alone ("DeShawn", "McKenzie"). */
export const displayName = (name: string): string =>
  name && name === name.toLowerCase() ? name.charAt(0).toUpperCase() + name.slice(1) : name;

export interface WaitlistEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

const SITE = "https://receipt-nest.com";
const ICON_URL = `${SITE}/apple-touch-icon.png?v=2`;
const REGISTER_URL = `${SITE}/register?utm_source=email&utm_medium=waitlist&utm_campaign=statement_decoder`;
const DECODER_URL = `${SITE}/statement-decoder?utm_source=email&utm_medium=waitlist&utm_campaign=statement_decoder`;

/**
 * Confirmation email, in the plain style of a major product's waitlist email: the app icon and name on top,
 * a short headline, a few sentences, one button, a sign-off and a quiet footer. Colours are limited to the ones the
 * shared dark-mode mapper (email-theme.ts) knows, so the email also reads well in dark mode.
 */
export const buildWaitlistEmail = (rawName: string): WaitlistEmail => {
  const name = displayName(cleanName(rawName));
  const greeting = name ? `Hi ${esc(name)},` : "Hi there,";
  const subject = "You’re on the Statement Decoder waitlist";
  const preheader = "We’ll email you as soon as it’s ready. Your first statement will be free.";

  const p = (html: string, extra = "") =>
    `<p style="margin:0 0 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:26px; color:#243244;${extra}">${html}</p>`;
  const li = (html: string) => `
                    <tr>
                      <td width="22" valign="top" style="padding:0 0 10px; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:26px; color:#059669;">&#8226;</td>
                      <td valign="top" style="padding:0 0 10px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:26px; color:#243244;">${html}</td>
                    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(subject)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f8fafc;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all;">${esc(preheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc;">
      <tr>
        <td align="center" style="padding:40px 16px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
            <tr>
              <td align="left" style="padding:0 4px 24px;">
                <a href="${SITE}" style="text-decoration:none;">
                  <img src="${ICON_URL}" width="40" height="40" alt="ReceiptNest" style="display:inline-block; vertical-align:middle; width:40px; height:40px; border:0; border-radius:10px;" />
                  <span style="display:inline-block; vertical-align:middle; margin-left:10px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:18px; font-weight:700; color:#0f172a;">ReceiptNest</span>
                </a>
              </td>
            </tr>
            <tr>
              <td style="background-color:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:36px 36px 30px;">
                <h1 style="margin:0 0 20px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:24px; line-height:32px; font-weight:700; color:#0f172a;">You’re on the waitlist</h1>
                ${p(greeting)}
                ${p("Thanks for signing up for early access to the <strong style=\"color:#0f172a;\">Statement Decoder</strong>. We’ll email you as soon as it’s ready, and your first statement will be free.")}
                ${p("Here’s what it will do:", " margin-bottom:10px;")}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px;">${li("Read each line of your bank statement and show who charged you, with a likely category.")}${li("Match each charge to the receipts you’ve saved in ReceiptNest.")}${li("List the charges that don’t have a receipt yet, ready to send to your bookkeeper.")}
                </table>
                ${p("Until then, you can start saving receipts in ReceiptNest. Every receipt you save now is one the decoder can match later.")}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;">
                  <tr>
                    <td align="center" bgcolor="#059669" style="border-radius:8px; background-color:#059669;">
                      <a href="${REGISTER_URL}" style="display:inline-block; padding:13px 24px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:600; line-height:20px; color:#ffffff; text-decoration:none; border-radius:8px;">Get started with ReceiptNest</a>
                    </td>
                  </tr>
                </table>
                ${p("If you have a question, just reply to this email.")}
                ${p("Gervais<br /><span style=\"color:#64748b;\">ReceiptNest</span>", " margin-bottom:0;")}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#64748b;">
                You’re receiving this because you joined the Statement Decoder waitlist at <span style="white-space:nowrap;">receipt-nest.com</span>.<br />
                <a href="${DECODER_URL}" style="color:#64748b; text-decoration:underline;">About the Statement Decoder</a>
                &nbsp;·&nbsp;
                <a href="${SITE}" style="color:#64748b; text-decoration:underline;">receipt-nest.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "You’re on the waitlist",
    "",
    name ? `Hi ${name},` : "Hi there,",
    "",
    "Thanks for signing up for early access to the Statement Decoder. We’ll email you as soon as it’s ready, and your first statement will be free.",
    "",
    "Here’s what it will do:",
    "- Read each line of your bank statement and show who charged you, with a likely category.",
    "- Match each charge to the receipts you’ve saved in ReceiptNest.",
    "- List the charges that don’t have a receipt yet, ready to send to your bookkeeper.",
    "",
    "Until then, you can start saving receipts in ReceiptNest. Every receipt you save now is one the decoder can match later.",
    `Get started: ${REGISTER_URL}`,
    "",
    "If you have a question, just reply to this email.",
    "",
    "Gervais",
    "ReceiptNest",
    "",
    "You’re receiving this because you joined the Statement Decoder waitlist at receipt-nest.com.",
    `About the Statement Decoder: ${DECODER_URL}`,
  ].join("\n");

  return { subject, preheader, html, text };
};
