/**
 * Standalone game pages served as static files from public/games.
 * They are NOT part of the Angular bundle. This list is read only by the
 * sitemap generator and the SEO check (scripts/), never imported by the app.
 */
export interface GamePage {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly kind: 'game';
  readonly updated: string;
}

export const gamePages: readonly GamePage[] = [
  {
    path: '/games', kind: 'game', label: 'Games', updated: '2026-10-07',
    title: 'Receipt Games: Free Browser Games About Receipts | ReceiptNest',
    description: 'Quick, free browser games about receipts and record-keeping from ReceiptNest. Start with Before It Fades: read the total before the receipt disappears.'
  },
  {
    path: '/games/fade', kind: 'game', label: 'Before It Fades', updated: '2026-10-07',
    title: 'Why Do Receipts Fade? Play Before It Fades | ReceiptNest',
    description: 'Read the total before the receipt fades. Every round gets faster. Then learn why thermal receipts fade, how long they last, and how to keep them readable.'
  }
];
