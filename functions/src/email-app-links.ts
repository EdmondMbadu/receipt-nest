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
            <td style="padding:0 0 10px;" align="left">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px; background:#000000; border:1px solid #1f2937;">
                    <a
                      href="${APP_STORE_URL}"
                      style="display:inline-block; padding:10px 14px; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif;"
                    >
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding-right:10px; vertical-align:middle;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true" style="display:block;">
                              <path d="M16.365 1.43c0 1.14-.468 2.231-1.213 3.02-.796.832-2.095 1.475-3.23 1.38-.144-1.097.364-2.267 1.11-3.055.82-.88 2.197-1.506 3.333-1.345Zm4.24 16.235c-.57 1.29-.836 1.867-1.57 2.997-1.025 1.57-2.474 3.527-4.272 3.542-1.603.016-2.017-1.045-4.193-1.032-2.178.012-2.632 1.051-4.234 1.035-1.8-.015-3.172-1.777-4.198-3.347C-.732 16.474-.873 11.11 1.52 7.42c1.697-2.62 4.381-4.153 6.902-4.153 1.653 0 3.03 1.14 4.574 1.14 1.497 0 2.408-1.142 4.557-1.142.9 0 3.71.247 5.468 2.815-4.807 2.635-4.024 9.497-2.416 11.585Z" />
                            </svg>
                          </td>
                          <td style="vertical-align:middle;">
                            <p style="margin:0; font-size:9px; line-height:1.2; letter-spacing:0.08em; text-transform:uppercase; color:#cbd5e1;">
                              Download on the
                            </p>
                            <p style="margin:1px 0 0; font-size:15px; line-height:1.1; font-weight:700; color:#ffffff;">
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
          </tr>
          <tr>
            <td align="left">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px; background:#000000; border:1px solid #1f2937;">
                    <a
                      href="${GOOGLE_PLAY_URL}"
                      style="display:inline-block; padding:10px 14px; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif;"
                    >
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding-right:10px; vertical-align:middle;">
                            <svg width="20" height="20" viewBox="0 0 512 512" aria-hidden="true" style="display:block;">
                              <path fill="#00A0FF" d="M64 32 L320 256 L64 480 C56 472 52 462 52 450 V62 C52 50 56 40 64 32 Z"/>
                              <path fill="#FFBD00" d="M400 208 L320 256 L400 304 L450 274 C470 262 470 250 450 238 Z"/>
                              <path fill="#FF3A44" d="M64 480 L320 256 L400 304 L96 478 C84 484 74 484 64 480 Z"/>
                              <path fill="#00A070" d="M64 32 C74 28 84 28 96 34 L400 208 L320 256 Z"/>
                            </svg>
                          </td>
                          <td style="vertical-align:middle;">
                            <p style="margin:0; font-size:9px; line-height:1.2; letter-spacing:0.08em; text-transform:uppercase; color:#cbd5e1;">
                              Get it on
                            </p>
                            <p style="margin:1px 0 0; font-size:15px; line-height:1.1; font-weight:700; color:#ffffff;">
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
