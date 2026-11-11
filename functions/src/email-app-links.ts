import { readFileSync } from "node:fs";
import path from "node:path";
import {
  APP_STORE_URL,
  EMAIL_APP_BADGES,
  emailAppBadgeUrl,
  GOOGLE_PLAY_URL,
  renderAppDownloadBadges,
} from "./email-app-badges";

export { APP_STORE_URL, GOOGLE_PLAY_URL } from "./email-app-badges";

const badgeImages = EMAIL_APP_BADGES.map(({ filename, contentId }) => ({
  source: emailAppBadgeUrl(filename),
  attachment: {
    content: readFileSync(path.join(__dirname, "..", "assets", "email", filename)).toString("base64"),
    filename,
    type: "image/png",
    disposition: "inline",
    contentId,
  },
}));

export const embedEmailAppBadges = (html: string) => {
  const attachments: Array<typeof badgeImages[number]["attachment"]> = [];
  for (const { source, attachment } of badgeImages) {
    const sourceAttribute = `src="${source}"`;
    if (!html.includes(sourceAttribute)) continue;
    html = html.split(sourceAttribute).join(`src="cid:${attachment.contentId}"`);
    attachments.push(attachment);
  }
  return { html, attachments };
};

export const renderAppDownloadHtmlCard = () => `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:18px;">
    <tr>
      <td style="padding:14px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px;">
        <p style="margin:0; font-size:12px; line-height:1.4; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#475569;">
          Download the app
        </p>
        ${renderAppDownloadBadges()}
      </td>
    </tr>
  </table>
`;

export const buildAppDownloadText = () =>
  [
    "Download the app:",
    `App Store: ${APP_STORE_URL}`,
    `Google Play: ${GOOGLE_PLAY_URL}`,
  ].join("\n");

export const appendAppDownloadText = (text: string) =>
  `${text.trimEnd()}\n\n${buildAppDownloadText()}`;
