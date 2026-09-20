export interface EditorialLink {
  readonly href: string;
  readonly label: string;
}

export interface BlogEditorial {
  readonly note: string;
  readonly sources: readonly EditorialLink[];
  readonly workflows: readonly EditorialLink[];
}

const records: EditorialLink = {
  href: 'https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep',
  label: 'IRS: supporting documents and electronic recordkeeping'
};
const retention: EditorialLink = {
  href: 'https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records',
  label: 'IRS: record retention periods and exceptions'
};
const taxNote = 'Published by ReceiptNest AI, the product discussed here. This is general U.S. record-organization guidance, not individual tax advice or a professional tax review. Check the linked IRS guidance and your own requirements before discarding records or claiming an expense.';
const productNote = 'Published by ReceiptNest AI. Product examples describe our own software, not an independent review. AI-extracted details need checking against the original receipt.';
const csv = { href: '/receipt-to-csv', label: 'Inspect the CSV columns and download a sample' };
const tax = { href: '/tax-receipt-organizer', label: 'Prepare receipt records for tax review' };
const scanner = { href: '/receipt-scanner', label: 'See the receipt-scanning workflow and its limits' };
const email = { href: '/email-receipt-organizer', label: 'Set up email-receipt forwarding' };

const editorial: Readonly<Record<string, BlogEditorial>> = {
  'digitization-business-clarity-compounds': {
    note: productNote + ' This essay is about record visibility, not accounting or tax advice.',
    sources: [],
    workflows: [
      { href: '/receipt-organizer', label: 'Turn scattered receipts into searchable records' },
      { href: '/expense-tracker', label: 'See receipt-based spending by month and category' },
      csv
    ]
  },
  'can-bank-statements-replace-receipts': {
    note: taxNote, sources: [records, retention], workflows: [tax, csv]
  },
  'receipt-tracking-delivery-drivers': {
    note: taxNote,
    sources: [records, { href: 'https://www.irs.gov/taxtopics/tc510', label: 'IRS: business vehicle expenses, mileage methods, and records' }],
    workflows: [{ href: '/receipt-tracker', label: 'Build an end-of-shift receipt routine' }, csv]
  },
  'organize-receipts-taxes-freelancer-guide': {
    note: taxNote, sources: [records, retention], workflows: [tax, csv]
  },
  'receipt-tracking-etsy-sellers': {
    note: taxNote, sources: [records], workflows: [email, tax, csv]
  },
  'receiptnest-vs-expensify': {
    note: 'Disclosure: we build ReceiptNest AI, so this is a vendor comparison, not an independent ranking or a hands-on accuracy benchmark. Expensify also has free individual features. Compare the current plans and test the same receipts in both products.',
    sources: [{ href: 'https://help.expensify.com/articles/new-expensify/getting-started/Free-Features-in-Expensify', label: 'Expensify: free individual features and web CSV export' }],
    workflows: [{ href: '/pricing', label: 'See ReceiptNest Starter and Pro limits' }, csv]
  },
  'scan-receipts-automatically': {
    note: productNote, sources: [], workflows: [scanner, email, csv]
  },
  'where-does-my-money-go': {
    note: productNote + ' A receipt total is not a full bank balance or a complete budget.',
    sources: [], workflows: [{ href: '/expense-tracker', label: 'Understand receipt-based spending totals' }, { href: '/receipt-organizer', label: 'Organize the receipts you already have' }]
  }
};

export function getBlogEditorial(slug: string): BlogEditorial {
  const entry = editorial[slug];
  if (!entry) throw new Error('Missing editorial context for ' + slug);
  return entry;
}
