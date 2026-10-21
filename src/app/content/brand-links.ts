/** Official ReceiptNest channels and app-store listings, shared by public page footers. */
export type SocialPlatform = 'youtube' | 'x' | 'tiktok' | 'instagram' | 'facebook';

export interface SocialLink {
  readonly platform: SocialPlatform;
  readonly label: string;
  readonly href: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { platform: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@ReceiptNest' },
  { platform: 'x', label: 'X', href: 'https://x.com/ReceiptNestAI' },
  { platform: 'tiktok', label: 'TikTok', href: 'https://www.tiktok.com/@receiptnest' },
  { platform: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/receiptnest' },
  { platform: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/ReceiptNestAI' }
];

export const APP_STORE_URL = 'https://apps.apple.com/us/app/receiptnest-ai/id6762539388';
export const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.receiptnest.mobile';
