// Browser-safe: the admin preview and outgoing emails use the same footer.
export const EMAIL_SOCIAL_LINKS = [
  { label: "YouTube", key: "youtube", href: "https://www.youtube.com/@ReceiptNestAI" },
  { label: "X", key: "x", href: "https://x.com/ReceiptNestAI" },
  { label: "TikTok", key: "tiktok", href: "https://www.tiktok.com/@receiptnest" },
  { label: "Instagram", key: "instagram", href: "https://www.instagram.com/receiptnest" },
  { label: "Facebook", key: "facebook", href: "https://www.facebook.com/ReceiptNestAI" },
] as const;

const footerId = "receiptnest-social-footer";
const heading = "Follow ReceiptNest";
const styles = `<style>
  @media (prefers-color-scheme: dark) {
    .rn-social-surface { background-color:#111c2b !important; }
    .rn-social-card { background-color:#172435 !important; border-color:#334155 !important; }
    .rn-social-heading { color:#86efac !important; }
    .rn-social-link { color:#e2e8f0 !important; }
  }
</style>`;

const renderLink = (link: typeof EMAIL_SOCIAL_LINKS[number], width: string) => `
  <td width="${width}" align="center" valign="top" style="padding:2px;">
    <a class="rn-social-link" href="${link.href}" target="_blank" rel="noopener noreferrer"
      aria-label="ReceiptNest on ${link.label}"
      style="display:block; padding:8px 2px; font-family:Arial,sans-serif; font-size:13px; line-height:20px; font-weight:600; text-align:center; text-decoration:none; color:#475569;">
      <img src="https://receipt-nest.com/email/social/${link.key}.png" width="32" height="32" alt="" border="0"
        style="display:block; width:32px; height:32px; margin:0 auto 5px; border:0;" />
      ${link.label}
    </a>
  </td>`;

const renderFooter = () => `
<table id="${footerId}" class="rn-social-surface" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
  style="width:100%; background-color:#f8fafc; border-collapse:collapse;">
  <tr><td align="center" style="padding:16px 12px 24px;">
    <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table class="rn-social-card" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
      style="width:100%; max-width:600px; background-color:#ffffff; border:1px solid #e2e8f0; border-radius:14px;">
      <tr><td align="center" style="padding:18px 10px 12px;">
        <p class="rn-social-heading" style="margin:0 0 10px; font-family:Arial,sans-serif; font-size:14px; line-height:20px; font-weight:700; color:#065f46;">${heading}</p>
        <!--[if mso]><table role="presentation" width="330" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; max-width:330px; table-layout:fixed;">
          <tr>${EMAIL_SOCIAL_LINKS.slice(0, 3).map(link => renderLink(link, "33.33%")).join("")}</tr>
          <tr><td colspan="3" align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="66.66%" style="width:66.66%; table-layout:fixed;">
              <tr>${EMAIL_SOCIAL_LINKS.slice(3).map(link => renderLink(link, "50%")).join("")}</tr>
            </table>
          </td></tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
</table>`;

export const appendEmailSocialHtml = (html: string): string => {
  if (new RegExp(`\\bid=["']${footerId}["']`, "i").test(html)) return html;

  // Custom admin templates may be fragments rather than complete documents.
  let document = html;
  if (!/<html\b/i.test(document)) {
    const body = /<body\b/i.test(document) ? document : `<body style="margin:0;padding:0;">${document}</body>`;
    document = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>${body}</html>`;
  }
  if (!/<head\b/i.test(document)) {
    document = document.replace(/<html\b[^>]*>/i, "$&<head></head>");
  }
  document = document.replace(/<\/head\s*>/i, `${styles}</head>`);

  // Keep the automatically appended custom-email unsubscribe footer last.
  const unsubscribeIndex = document.indexOf("<!-- receiptnest-unsubscribe-footer -->");
  const bodyIndex = document.search(/<\/body\s*>/i);
  const insertAt = unsubscribeIndex >= 0 ? unsubscribeIndex : bodyIndex;
  if (insertAt >= 0) return `${document.slice(0, insertAt)}${renderFooter()}\n${document.slice(insertAt)}`;
  return document.replace(/<\/html\s*>/i, `${renderFooter()}</html>`);
};

export const appendEmailSocialText = (text: string): string => {
  const block = `${heading}:\n${EMAIL_SOCIAL_LINKS.map(link => `${link.label}: ${link.href}`).join("\n")}`;
  if (text.includes(block)) return text;
  const unsubscribeIndex = text.indexOf("\n\nUnsubscribe from non-essential ReceiptNest emails:");
  if (unsubscribeIndex >= 0) {
    return `${text.slice(0, unsubscribeIndex).trimEnd()}\n\n${block}${text.slice(unsubscribeIndex)}`;
  }
  return `${text.trimEnd()}\n\n${block}`;
};
