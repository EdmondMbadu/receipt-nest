export const APP_STORE_URL = "https://apps.apple.com/us/app/receiptnest-ai/id6762539388";
export const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.receiptnest.mobile";

export const renderAppDownloadHtmlCard = () => `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:18px;">
    <tr>
      <td style="padding:14px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px;">
        <p style="margin:0 0 12px; font-size:12px; line-height:1.4; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#475569;">
          Download the app
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:0 0 10px;">
              <a
                href="${APP_STORE_URL}"
                style="display:block; padding:12px 14px; border-radius:12px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px; line-height:1.4; font-weight:700; text-align:center;"
              >
                Download on the App Store
              </a>
            </td>
          </tr>
          <tr>
            <td>
              <a
                href="${GOOGLE_PLAY_URL}"
                style="display:block; padding:12px 14px; border-radius:12px; background:#065f46; color:#ffffff; text-decoration:none; font-size:14px; line-height:1.4; font-weight:700; text-align:center;"
              >
                Get it on Google Play
              </a>
            </td>
          </tr>
        </table>
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
