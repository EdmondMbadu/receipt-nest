import { readFileSync } from "fs";
import path from "path";

export const APP_STORE_URL = "https://apps.apple.com/us/app/receiptnest-ai/id6762539388";
export const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.receiptnest.mobile";
const APPLE_ICON_CID = "receiptnest-app-store-icon";
const GOOGLE_PLAY_ICON_CID = "receiptnest-google-play-icon";

const readAssetBase64 = (filename: string) =>
  readFileSync(path.join(__dirname, "..", "assets", "email", filename)).toString("base64");

const appleIconBase64 = readAssetBase64("apple-store-icon.png");
const googlePlayIconBase64 = readAssetBase64("google-play-icon.png");

const buildInlineImageAttachment = (
  content: string,
  filename: string,
  contentId: string,
) => ({
  content,
  filename,
  type: "image/png",
  disposition: "inline" as const,
  contentId,
  toJSON() {
    return {
      content,
      filename,
      type: "image/png",
      disposition: "inline",
      content_id: contentId,
    };
  },
});

export const getEmailAppIconAttachments = () => [
  buildInlineImageAttachment(appleIconBase64, "apple-store-icon.png", APPLE_ICON_CID),
  buildInlineImageAttachment(googlePlayIconBase64, "google-play-icon.png", GOOGLE_PLAY_ICON_CID),
];

export const renderAppDownloadHtmlCard = () => `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:18px;">
    <tr>
      <td style="padding:14px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px;">
        <p style="margin:0 0 12px; font-size:12px; line-height:1.4; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#475569;">
          Download the app
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="50%" style="padding:0 6px 0 0; vertical-align:top;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="border-radius:10px; background:#000000; border:1px solid #1f2937;">
                    <a
                      href="${APP_STORE_URL}"
                      style="display:block; padding:8px 12px; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif;"
                    >
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td style="width:22px; padding-right:8px; vertical-align:middle;">
                            <img src="cid:${APPLE_ICON_CID}" width="18" height="18" alt="" style="display:block; width:18px; height:18px; border:0;" />
                          </td>
                          <td style="vertical-align:middle;">
                            <p style="margin:0; font-size:8px; line-height:1.1; letter-spacing:0.08em; text-transform:uppercase; color:#cbd5e1;">
                              Download on the
                            </p>
                            <p style="margin:1px 0 0; font-size:12px; line-height:1.1; font-weight:700; color:#ffffff;">
                              App Store
                            </p>
                          </td>
                        </tr>
                      </table>
                    </a>
                  </td>
                </tr>
              </table>
            </td>
            <td width="50%" style="padding:0 0 0 6px; vertical-align:top;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="border-radius:10px; background:#000000; border:1px solid #1f2937;">
                    <a
                      href="${GOOGLE_PLAY_URL}"
                      style="display:block; padding:8px 12px; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif;"
                    >
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td style="width:22px; padding-right:8px; vertical-align:middle;">
                            <img src="cid:${GOOGLE_PLAY_ICON_CID}" width="18" height="18" alt="" style="display:block; width:18px; height:18px; border:0;" />
                          </td>
                          <td style="vertical-align:middle;">
                            <p style="margin:0; font-size:8px; line-height:1.1; letter-spacing:0.08em; text-transform:uppercase; color:#cbd5e1;">
                              Get it on
                            </p>
                            <p style="margin:1px 0 0; font-size:12px; line-height:1.1; font-weight:700; color:#ffffff;">
                              Google Play
                            </p>
                          </td>
                        </tr>
                      </table>
                    </a>
                  </td>
                </tr>
              </table>
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
