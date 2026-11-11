// Browser-safe so the custom email preview can render the same badges as delivery.
export const APP_STORE_URL = "https://apps.apple.com/us/app/receiptnest-ai/id6762539388";
export const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.receiptnest.mobile";
export const EMAIL_APP_BADGES_ID = "receiptnest-app-downloads";

export const EMAIL_APP_BADGES = [
  {
    href: APP_STORE_URL,
    label: "Download on the App Store",
    filename: "app-store-badge.png",
    contentId: "receiptnest-app-store-badge",
    width: 120,
  },
  {
    href: GOOGLE_PLAY_URL,
    label: "Get it on Google Play",
    filename: "google-play-badge.png",
    contentId: "receiptnest-google-play-badge",
    width: 134,
  },
] as const;

export const emailAppBadgeUrl = (filename: string) => `https://receipt-nest.com/email/stores/${filename}`;

export const renderAppDownloadBadges = () => `
  <p id="${EMAIL_APP_BADGES_ID}" style="margin:12px 0 4px; font-size:0; line-height:0;">
    ${EMAIL_APP_BADGES.map(({ href, label, filename, width }, index) => `
      <a href="${href}" style="display:inline-block; vertical-align:top; margin:0 ${index === 0 ? 12 : 0}px 8px 0; text-decoration:none;">
        <img src="${emailAppBadgeUrl(filename)}" alt="${label}" width="${width}" height="40" border="0"
          style="display:block; width:${width}px; height:40px; border:0; border-radius:6px; background-color:#000000; color:#ffffff; font:600 12px/40px Arial,sans-serif;" />
      </a>`).join("\n")}
  </p>
`;
