/**
 * Standalone pages served as static files from public/ (the games, and the
 * Statement Decoder landing page).
 * They are NOT part of the Angular bundle. This list is read only by the
 * sitemap generator and the SEO check (scripts/), never imported by the app.
 */
export interface GamePage {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly kind: 'game' | 'standalone';
  readonly updated: string;
}

export const gamePages: readonly GamePage[] = [
  {
    path: '/games', kind: 'game', label: 'Games', updated: '2026-11-06',
    title: 'Receipt Games: Free Browser Games About Receipts | ReceiptNest',
    description: 'Quick, free browser games about receipts from ReceiptNest. Decode cryptic bank charges, file a shoebox of receipts by month, or read a total before it fades.'
  },
  {
    path: '/games/escape-3d', kind: 'game', label: 'Escape the Year in 3D', updated: '2026-11-06',
    title: 'Escape the Year in 3D: Can the Receipt Break 365 Spheres? | ReceiptNest',
    description: '365 glass spheres, one for every day of the year. Watch a receipt break through them before the tax-day clock runs out, or help it. Then plan the last 100 days before tax day.'
  },
  {
    path: '/games/sorted-by-luck', kind: 'game', label: 'Sorted by Luck', updated: '2026-11-05',
    title: 'Sorted by Luck: Which Month Wins the Receipt Plinko? | ReceiptNest',
    description: '365 receipts drop through a Plinko board into 12 month bins. Call the month with the most and the fewest. Then learn how to sort receipts by month for real.'
  },
  {
    path: '/games/fade-out', kind: 'game', label: 'Fade Out', updated: '2026-11-04',
    title: 'Fade Out: Save the Receipt Before the Ink Fades | ReceiptNest',
    description: 'Every receipt has 4 seconds before its print fades. Nudge it out of the ring in time, set to The Entertainer. Then learn why receipts fade and how to keep them.'
  },
  {
    path: '/games/snap-vs-pile', kind: 'game', label: 'Snap vs Pile', updated: '2026-11-04',
    title: 'Snap vs Pile: Can the Phone Clear the Box? | ReceiptNest',
    description: 'Yellow snaps receipts, red adds them, and whoever leads grows. Watch the duel or take control of yellow, set to the Turkish March. Then learn to beat a backlog.'
  },
  {
    path: '/games/pile', kind: 'game', label: 'The Pile', updated: '2026-11-02',
    title: 'The Pile: How Many Receipts Before the Box Bursts? | ReceiptNest',
    description: 'Every bounce adds a receipt to the pile. Tap to snap each one before the box gives out, all set to the Can-Can. Then learn how to stop receipts piling up.'
  },
  {
    path: '/games/escape', kind: 'game', label: 'Escape the Year', updated: '2026-11-02',
    title: 'Escape the Year: Can the Receipt Beat Tax Day? | ReceiptNest',
    description: '365 rings, one for every day of the year. Watch a receipt bounce through them before the tax-day clock runs out, or help it escape. Then learn how to keep a year of receipts.'
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
  },
  {
    path: '/statement-decoder', kind: 'standalone', label: 'Statement Decoder', updated: '2026-10-10',
    title: 'Bank Statement Decoder: Find Missing Receipts | ReceiptNest',
    description: 'Coming soon from ReceiptNest: upload a bank statement, see who charged you and the likely category, and which charges have no receipt saved yet.'
  }
];
