export const SITE_URL = 'https://receipt-nest.com';
export const SITE_NAME = 'ReceiptNest AI';
export const CONTENT_REVIEW_DATE = '2026-09-13';

export interface PublicPage {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly kind: 'home' | 'workflow' | 'information' | 'blog' | 'support' | 'terms';
  readonly updated: string;
}

/** Shared by the router, pre-render routes, page metadata, and sitemap tooling. */
export const publicPages: readonly PublicPage[] = [
  {
    path: '/', kind: 'home', label: 'ReceiptNest AI', updated: CONTENT_REVIEW_DATE,
    title: 'ReceiptNest AI — Receipt Tracking for Freelancers',
    description: 'Keep photos, PDFs, and forwarded receipts organized. Track purchases, find original receipts, and export your records with ReceiptNest AI.'
  },
  {
    path: '/receipt-tracker', kind: 'workflow', label: 'Receipt tracker', updated: CONTENT_REVIEW_DATE,
    title: 'Receipt Tracker for Freelancers & Everyday Expenses | ReceiptNest AI',
    description: 'Track receipts by merchant, month, and category. Capture photos, PDFs, and email receipts, then review and export your records. Start free.'
  },
  {
    path: '/receipt-organizer', kind: 'workflow', label: 'Receipt organizer', updated: CONTENT_REVIEW_DATE,
    title: 'Digital Receipt Organizer for Photos, PDFs & Email | ReceiptNest AI',
    description: 'Bring scattered receipts into one searchable place. Find a purchase, keep its original file, and organize your receipt backlog with ReceiptNest AI.'
  },
  {
    path: '/receipt-scanner', kind: 'workflow', label: 'Receipt scanner', updated: CONTENT_REVIEW_DATE,
    title: 'AI Receipt Scanner for Photos & PDFs | ReceiptNest AI',
    description: 'Turn receipt photos and PDFs into merchant, date, amount, and category records. Review the details, keep the original, and export to CSV.'
  },
  {
    path: '/receipt-management-software', kind: 'workflow', label: 'Receipt management', updated: CONTENT_REVIEW_DATE,
    title: 'Receipt Management Software for Small Businesses | ReceiptNest AI',
    description: 'Collect, review, and export small-business receipt records. A focused receipt workflow without payroll, bookkeeping, or expense-approval software.'
  },
  {
    path: '/expense-tracker', kind: 'workflow', label: 'Receipt-based expenses', updated: CONTENT_REVIEW_DATE,
    title: 'Receipt-Based Expense Tracker & Monthly Spending | ReceiptNest AI',
    description: 'See the spending behind your receipts. Review merchants, categories, and monthly totals, with original documents available when you need them.'
  },
  {
    path: '/tax-receipt-organizer', kind: 'workflow', label: 'Tax receipt organizer', updated: CONTENT_REVIEW_DATE,
    title: 'Tax Receipt Organizer for Freelancers | ReceiptNest AI',
    description: 'Keep freelance receipts organized throughout the year. Review categories, preserve original records, and export receipts for tax-preparation review.'
  },
  {
    path: '/receipt-to-csv', kind: 'workflow', label: 'Receipt to CSV', updated: CONTENT_REVIEW_DATE,
    title: 'Receipt to CSV: Export Receipts for Excel | ReceiptNest AI',
    description: 'See a sample receipt CSV, understand its columns, and export receipt records for Excel or Google Sheets. CSV export is included in the free plan.'
  },
  {
    path: '/email-receipt-organizer', kind: 'workflow', label: 'Email receipts', updated: CONTENT_REVIEW_DATE,
    title: 'Email Receipt Organizer & Receipt Forwarding | ReceiptNest AI',
    description: 'Forward email receipts to your ReceiptNest address. Keep email purchases, PDF attachments, and photo receipts together in one searchable record.'
  },
  {
    path: '/pricing', kind: 'information', label: 'Pricing', updated: CONTENT_REVIEW_DATE,
    title: 'ReceiptNest AI Pricing — Free & Pro Receipt Plans',
    description: 'Compare ReceiptNest AI plans: start with up to 50 receipts and CSV export, or choose Pro for unlimited receipts and additional export and insight features.'
  },
  {
    path: '/security', kind: 'information', label: 'Data handling', updated: CONTENT_REVIEW_DATE,
    title: 'How ReceiptNest AI Handles Your Receipt Data',
    description: 'Understand receipt storage, cloud AI processing, account access, exports, and deletion requests before choosing ReceiptNest AI.'
  },
  {
    path: '/about', kind: 'information', label: 'About', updated: CONTENT_REVIEW_DATE,
    title: 'About ReceiptNest AI — The Receipt-First Workspace',
    description: 'Meet ReceiptNest AI at receipt-nest.com. Learn what the product does, where it stops, and how to find its official web, iOS, and Android apps.'
  },
  {
    path: '/blog', kind: 'blog', label: 'Guides', updated: CONTENT_REVIEW_DATE,
    title: 'Receipt Tracking & Organization Guides | ReceiptNest AI',
    description: 'Practical receipt workflows for freelancers: scanning, CSV exports, tax record organization, and clear comparisons of receipt-management approaches.'
  },
  {
    path: '/support', kind: 'support', label: 'Support', updated: CONTENT_REVIEW_DATE,
    title: 'ReceiptNest AI Support — Receipt Uploads, Exports & Accounts',
    description: 'Find help with receipt uploads, email forwarding, CSV exports, and your ReceiptNest AI account. Contact the support team when you need assistance.'
  },
  {
    path: '/terms', kind: 'terms', label: 'Terms', updated: '2026-05-23',
    title: 'Terms and Conditions | ReceiptNest AI',
    description: 'Read the Terms and Conditions for using ReceiptNest AI to capture, organize, review, and export receipt records.'
  }
];

export function getPublicPage(path: string): PublicPage {
  const page = publicPages.find(item => item.path === path);
  if (!page) throw new Error('Unknown public page: ' + path);
  return page;
}

export const workflowPages = publicPages.filter(page => page.kind === 'workflow');
export const informationPages = publicPages.filter(page => page.kind === 'information');
