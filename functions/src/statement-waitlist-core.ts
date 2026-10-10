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
const REGISTER_URL = `${SITE}/register?utm_source=email&utm_medium=waitlist&utm_campaign=statement_decoder`;
const GAME_URL = `${SITE}/games/charge?utm_source=email&utm_medium=waitlist&utm_campaign=statement_decoder`;

const SAMPLE = [
  { line: "SQ *GRNLINE PLMB SUP", amount: "86.40", who: "Greenline Plumbing Supply", cat: "Hardware", receipt: true },
  { line: "TST* EL CAMINO TAQ", amount: "24.18", who: "El Camino Taqueria", cat: "Meals", receipt: true },
  { line: "SHOPIFY* 104729381", amount: "39.00", who: "Shopify, your store plan", cat: "Software", receipt: false },
];

/**
 * Confirmation email. Layout: night header with the logo, a serif headline, a three-line "decoded statement"
 * preview with a highlighter on each code, three steps, one primary button. Colours on white/#f8fafc/#0f172a
 * are picked so the shared dark-mode mapper (email-theme.ts) recolours them correctly.
 */
export const buildWaitlistEmail = (rawName: string): WaitlistEmail => {
  const name = displayName(cleanName(rawName)) || "there";
  const safeName = esc(name);
  const subject = name === "there" ? "You’re on the list for the Statement Decoder" : `You’re on the list, ${name}`;
  const preheader = "We’ll email you the day the Statement Decoder opens. Your first statement is on us.";

  const rows = SAMPLE.map(
    (r) => `
                <tr>
                  <td style="padding:12px 0; border-bottom:1px solid #e2e8f0; font-family:'Courier New',Courier,monospace; font-size:13px; line-height:18px; color:#0f172a;">
                    <span style="background-color:#ffe27a; color:#1d1b17; padding:2px 4px; border-radius:3px;">${esc(r.line)}</span>
                    <div style="margin-top:6px; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:18px; color:#475569;">${esc(r.who)} · ${esc(r.cat)}</div>
                  </td>
                  <td align="right" valign="top" style="padding:12px 0 12px 12px; border-bottom:1px solid #e2e8f0; font-family:'Courier New',Courier,monospace; font-size:13px; line-height:18px; color:#0f172a; white-space:nowrap;">
                    -${r.amount}
                    <div style="margin-top:6px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:18px; font-weight:700; color:${r.receipt ? "#047857" : "#9f1239"};">${r.receipt ? "&#10003; Receipt" : "&#10007; Missing"}</div>
                  </td>
                </tr>`
  ).join("");

  const step = (n: string, title: string, body: string) => `
                <tr>
                  <td width="34" valign="top" style="padding:0 0 14px;">
                    <div style="width:26px; height:26px; border-radius:13px; background-color:#0f172a; color:#ffffff; text-align:center; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:700; line-height:26px;">${n}</div>
                  </td>
                  <td valign="top" style="padding:2px 0 14px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:22px; color:#0f172a;">
                    <strong>${title}</strong> <span style="color:#475569;">${body}</span>
                  </td>
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
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px; background-color:#ffffff; border:1px solid #e2e8f0; border-radius:18px; overflow:hidden;">
            <tr>
              <td style="padding:22px 28px; background-color:#1b1916;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td valign="middle">
                      <img src="${SITE}/receipt-nest.png" width="28" height="28" alt="ReceiptNest" style="display:inline-block; vertical-align:middle; width:28px; height:28px; border-radius:7px; border:0;" />
                      <span style="display:inline-block; vertical-align:middle; margin-left:8px; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:700; color:#f3ead6;">ReceiptNest</span>
                    </td>
                    <td align="right" valign="middle" style="font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#ffd23f;">Early access</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 28px 8px;">
                <p style="margin:0 0 10px; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#9a3412;">Statement Decoder</p>
                <h1 style="margin:0; font-family:Georgia,'Times New Roman',serif; font-size:32px; line-height:38px; font-weight:400; color:#0f172a;">You’re on the list, ${safeName}.</h1>
                <p style="margin:16px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:25px; color:#475569;">Thanks for raising your hand. The Statement Decoder turns a cryptic bank statement into a list your bookkeeper can actually use, and shows you exactly which receipts are missing.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px 6px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:12px;">
                  <tr>
                    <td style="padding:14px 18px 4px;">
                      <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#64748b;">A preview of what you’ll get</p>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}
                      </table>
                      <p style="margin:10px 0 12px; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:19px; color:#64748b;">1 receipt missing. That’s the one your bookkeeper will ask about.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 4px;">
                <p style="margin:0 0 14px; font-family:Georgia,'Times New Roman',serif; font-size:21px; line-height:28px; color:#0f172a;">How it will work</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${step("1", "Upload a statement.", "A PDF or CSV from your bank. No bank login, ever.")}${step("2", "We decode every line.", "Who charged you and a likely category, with anything uncertain clearly marked.")}${step("3", "See what’s missing.", "Every charge without a receipt, in one list you can hand to your bookkeeper.")}
                </table>
                <p style="margin:6px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:23px; color:#0f172a;">We’ll email you once, the day it opens. <strong>Your first statement is on us.</strong></p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 6px;">
                <p style="margin:0 0 12px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:23px; color:#475569;">While you wait, start keeping the receipts. When the decoder opens, it will match them for you.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#ffd23f" style="border-radius:12px; background-color:#ffd23f;">
                      <a href="${REGISTER_URL}" style="display:inline-block; padding:14px 24px; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:700; color:#1d1b17; text-decoration:none; border-radius:12px;">Start keeping receipts, free</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:14px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:21px; color:#475569;">Or keep your eye sharp with <a href="${GAME_URL}" style="color:#9a3412; text-decoration:underline;">today’s Guess the Charge</a>.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 30px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e2e8f0;">
                  <tr>
                    <td style="padding-top:18px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:22px; color:#475569;">
                      One question: what’s the most confusing charge on your statement right now? Just hit reply. I read every answer.
                      <br /><br />Edmond<br /><span style="color:#64748b;">Founder, ReceiptNest</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0; max-width:560px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:18px; color:#94a3b8;">You’re receiving this because you joined the Statement Decoder early-access list at receipt-nest.com. ReceiptNest never asks for your bank login.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `You’re on the list, ${name}.`,
    "",
    "Thanks for raising your hand. The Statement Decoder turns a cryptic bank statement into a list your bookkeeper can actually use, and shows you exactly which receipts are missing.",
    "",
    "A preview of what you’ll get:",
    ...SAMPLE.map((r) => `  ${r.line}  -${r.amount}  →  ${r.who} · ${r.cat} · ${r.receipt ? "receipt ✓" : "MISSING"}`),
    "",
    "How it will work:",
    "  1. Upload a statement. A PDF or CSV from your bank. No bank login, ever.",
    "  2. We decode every line. Who charged you and a likely category, with anything uncertain clearly marked.",
    "  3. See what’s missing. Every charge without a receipt, in one list you can hand to your bookkeeper.",
    "",
    "We’ll email you once, the day it opens. Your first statement is on us.",
    "",
    `While you wait, start keeping the receipts: ${REGISTER_URL}`,
    `Or play today’s Guess the Charge: ${GAME_URL}`,
    "",
    "One question: what’s the most confusing charge on your statement right now? Just hit reply. I read every answer.",
    "",
    "Edmond",
    "Founder, ReceiptNest",
  ].join("\n");

  return { subject, preheader, html, text };
};
