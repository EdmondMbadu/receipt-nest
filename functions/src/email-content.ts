import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";

export interface EmailDocumentSource {
  subject: string;
  sender: string;
  recipient: string;
  sentAt?: string;
  html: string;
  text: string;
  inlineImages?: Record<string, string>;
}

export const EMAIL_PIPELINE_VERSION = 2;
export const MAX_EMAIL_SOURCE_BYTES = 28 * 1024 * 1024;

export function escapeEmailHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only the archive retains untrusted originals. This derivative is safe to display offline. */
export function buildEmailHtml(source: EmailDocumentSource): string {
  const $ = load(source.html || `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeEmailHtml(source.text)}</pre>`);
  $("script,iframe,object,embed,form,input,button,textarea,select,video,audio,source,link,meta,base,svg,math").remove();
  // Keep document-head CSS: email layouts depend heavily on it.
  const css = $("head style").map((_, el) => $(el).html() || "").get().join("\n");
  const bodyStyle = $("body").attr("style") || "";
  const body = $("body").html() || "";
  const clean = sanitizeHtml(`<style>${css}</style><div style="${escapeEmailHtml(bodyStyle)}">${body}</div>`, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "style", "font", "center"],
    allowedAttributes: { "*": ["class", "id", "style", "dir", "lang", "align", "valign", "width", "height", "bgcolor", "role"],
      a: ["href", "title"], img: ["src", "alt", "title", "width", "height"],
      table: ["cellpadding", "cellspacing", "border", "width", "height", "align", "bgcolor", "background", "style", "class", "role"],
      td: ["colspan", "rowspan", "width", "height", "align", "valign", "bgcolor", "background", "style", "class"],
      th: ["colspan", "rowspan", "width", "height", "align", "valign", "bgcolor", "style", "class"], font: ["face", "color", "size"] },
    allowedSchemes: ["https", "http", "mailto"], allowedSchemesByTag: { img: ["https", "http", "data", "cid"] },
    allowProtocolRelative: false, allowVulnerableTags: true,
  });
  const doc = load(clean);
  // CSS asset URLs are resolved separately under the same network policy as images.
  doc("style").each((_, el) => { doc(el).text((doc(el).html() || "").replace(/@import\s+[^;]+;/gi, "")); });
  doc("img").each((_, el) => {
    const img = doc(el);
    const src = img.attr("src") || "";
    if (src.startsWith("cid:")) img.attr("src", source.inlineImages?.[src.slice(4).replace(/^<|>$/g, "")] || "");
    // Invisible tracking pixels do not belong in a printable email.
    if (Number(img.attr("width")) === 1 && Number(img.attr("height")) === 1) img.remove();
  });
  const header = `<header class="rn-email-header"><strong>${escapeEmailHtml(source.subject || "Forwarded email")}</strong><div>From: ${escapeEmailHtml(source.sender)}</div><div>To: ${escapeEmailHtml(source.recipient)}</div>${source.sentAt ? `<div>Date: ${escapeEmailHtml(source.sentAt)}</div>` : ""}</header>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeEmailHtml(source.subject)}</title>${doc("head").html() || ""}<style>
    html{color-scheme:light}body{margin:0;background:#fff;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .rn-email-header{font:12px/1.6 Arial,sans-serif;padding:16px 20px;border-bottom:1px solid #ddd;margin-bottom:16px;overflow-wrap:anywhere}
    .rn-email-header strong{display:block;font-size:15px;margin-bottom:4px}
    img{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}@page{size:Letter;margin:10mm}
  </style></head><body>${header}${doc("body").html() || ""}</body></html>`;
}

/** Keep label/value rows and dates, remove hidden preheaders, tracking URLs and boilerplate noise. */
export function emailExtractionText(html: string, text: string): string {
  if (!html) return cleanText(text.replace(/https?:\/\/\S+/g, " "));
  const $ = load(html);
  $("head,script,style,noscript,svg,canvas,[hidden],[aria-hidden='true']").remove();
  $("[style]").each((_, el) => {
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)/i.test($(el).attr("style") || "")) $(el).remove();
  });
  $("br").replaceWith("\n");
  $("td,th").append(" | ");
  $("tr,p,div,section,li,h1,h2,h3,h4,table").append("\n");
  return cleanText($("body").text());
}

export function cleanText(value: string): string {
  return value.replace(/[\u0000\u200b-\u200f\ufeff]/g, "").replace(/\r/g, "")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Budget AI input without throwing away a total/date near the bottom of a long message. */
export function extractionExcerpt(text: string, limit = 18000): string {
  if (text.length <= limit) return text;
  const lines = text.split("\n");
  const relevant = new Set<number>();
  lines.forEach((line, i) => {
    if (/total|amount|paid|fee|tax|subtotal|refund|date|invoice|receipt|currency|transfer|payment/i.test(line)) {
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 2); j++) relevant.add(j);
    }
  });
  const evidence = [...relevant].sort((a, b) => a - b).map(i => lines[i]).join("\n");
  return `${text.slice(0, 2500)}\n[Relevant transaction sections]\n${evidence.slice(0, limit - 3500)}\n[End of email]\n${text.slice(-800)}`;
}
