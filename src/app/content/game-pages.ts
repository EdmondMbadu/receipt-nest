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
    path: '/games', kind: 'game', label: 'Games', updated: '2026-10-08',
    title: 'Receipt Games: Free Browser Games About Receipts | ReceiptNest',
    description: 'Quick, free browser games about receipts from ReceiptNest. Decode cryptic bank charges, file a shoebox of receipts by month, or read a total before it fades.'
  },
  {
    path: '/games/charge', kind: 'game', label: 'Guess the Charge', updated: '2026-10-08',
    title: 'What Is This Charge on My Statement? Guess the Charge | ReceiptNest',
    description: 'SQ*, TST*, AMZN Mktp, APPLE.COM/BILL: decode cryptic bank statement charges in a fast, free game. Then learn how to identify any unknown charge.'
  },
  {
    path: '/games/shoebox', kind: 'game', label: 'Shoebox Sort', updated: '2026-10-08',
    title: 'Shoebox Sort: The Receipt Sorting Game | ReceiptNest',
    description: 'Receipts are raining. File each one in the right month before the shoebox fills up. Then learn a simple system for sorting receipts by month for taxes.'
  },
  {
    path: '/games/fade', kind: 'game', label: 'Before It Fades', updated: '2026-10-08',
    title: 'Why Do Receipts Fade? Play Before It Fades | ReceiptNest',
    description: 'Read the total before the receipt fades. Every round gets faster. Then learn why thermal receipts fade, how long they last, and how to keep them readable.'
  }
];
