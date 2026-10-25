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
const taxNote = 'Published by ReceiptNest, the product discussed here. This is general U.S. record-organization guidance, not individual tax advice or a professional tax review. Check the linked IRS guidance and your own requirements before discarding records or claiming an expense.';
const productNote = 'Published by ReceiptNest. Product examples describe our own software, not an independent review. AI-extracted details need checking against the original receipt.';
const csv = { href: '/receipt-to-csv', label: 'Inspect the CSV columns and download a sample' };
const tax = { href: '/tax-receipt-organizer', label: 'Prepare receipt records for tax review' };
const scanner = { href: '/receipt-scanner', label: 'See the receipt-scanning workflow and its limits' };
const email = { href: '/email-receipt-organizer', label: 'Set up email-receipt forwarding' };

const editorial: Readonly<Record<string, BlogEditorial>> = {
  'do-you-need-receipts-for-taxes': {
    note: taxNote,
    sources: [
      records,
      { href: 'https://www.irs.gov/publications/p583', label: 'IRS Publication 583: proof of payment and electronic records' },
      { href: 'https://www.irs.gov/publications/p463', label: 'IRS Publication 463, chapter 5: documentary evidence and the $75 exception' },
      retention,
      { href: 'https://www.irs.gov/newsroom/reconstructing-records-after-a-natural-disaster-or-casualty-loss', label: 'IRS: reconstructing records' }
    ],
    workflows: [scanner, email, tax]
  },
  'how-long-to-keep-receipts': {
    note: taxNote,
    sources: [
      retention,
      { href: 'https://www.irs.gov/taxtopics/tc305', label: 'IRS Topic 305: recordkeeping and periods of limitations' },
      { href: 'https://www.irs.gov/publications/p583', label: 'IRS Publication 583: how long to keep records and electronic records' },
      records
    ],
    workflows: [tax, csv, scanner]
  },
  'how-to-sort-a-shoebox-of-receipts': {
    note: taxNote,
    sources: [records, retention, { href: 'https://www.irs.gov/newsroom/reconstructing-records-after-a-natural-disaster-or-casualty-loss', label: 'IRS: reconstructing records' }],
    workflows: [scanner, csv, tax]
  },
  'how-to-keep-track-of-receipts': {
    note: taxNote, sources: [records, retention], workflows: [email, csv, tax]
  },
  'itemized-receipt-vs-credit-card-slip': {
    note: taxNote,
    sources: [
      records,
      { href: 'https://www.irs.gov/publications/p583', label: 'IRS Publication 583: supporting documents and proof of payment' },
      { href: 'https://www.irs.gov/publications/p463', label: 'IRS Publication 463, chapter 5: documentary evidence for travel, meals and gifts' }
    ],
    workflows: [tax, email, csv]
  },
  'why-do-receipts-fade': {
    note: 'Published by ReceiptNest, the product discussed here. This is general guidance on keeping receipts readable, not tax advice. Image-life figures are manufacturer estimates under controlled storage; real receipts in wallets and cars can fade much sooner.',
    sources: [
      { href: 'https://19january2021snapshot.epa.gov/sites/static/files/2015-09/documents/bpa_ch3.pdf', label: 'EPA: how thermal paper works (Bisphenol A Alternatives in Thermal Paper, ch. 3)' },
      { href: 'https://prodc-www.zebra.com/content/dam/zebra_dam/en/spec-sheets/z-perform-1000d-2-1-receipt-paper-spec-sheet-en-us.pdf', label: 'Zebra: receipt paper image life and what to keep it away from' },
      { href: 'https://www.naa.gov.au/information-management/store-and-preserve-information/preserving-information/managing-records-thermal-papers', label: 'National Archives of Australia: managing records on thermal paper' },
      records,
      { href: 'https://www.irs.gov/newsroom/reconstructing-records-after-a-natural-disaster-or-casualty-loss', label: 'IRS: reconstructing records' }
    ],
    workflows: [scanner, email, tax]
  },
  'organize-receipts-for-accountant': {
    note: taxNote, sources: [records], workflows: [csv, tax, email]
  },
  'the-last-mile': {
    note: productNote + ' This is an opinion essay about mastery and attention. Its 80% and 99% figures are metaphors, not measured performance or financial-awareness scores.',
    sources: [
      {
        href: 'https://www.federalreserve.gov/releases/z1/dataviz/dfa/distribute/chart/index.html',
        label: 'Federal Reserve: Distributional Financial Accounts wealth shares'
      },
      {
        href: 'https://cosmicopia.gsfc.nasa.gov/qa_gp_sl.html',
        label: 'NASA: special relativity and time dilation'
      }
    ],
    workflows: [
      { href: '/expense-tracker', label: 'See receipt-based spending by month and category' },
      { href: '/receipt-organizer', label: 'Turn scattered receipts into searchable records' },
      csv
    ]
  },
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
    note: taxNote + ' The $86.40 purchase is a fictional illustration from our Paper Trail video, not a customer record. Sources checked October 17, 2026.',
    sources: [records, { href: 'https://www.irs.gov/publications/p583', label: 'IRS Publication 583: payment evidence and electronic records' }, retention],
    workflows: [scanner, tax, csv]
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
    note: 'Disclosure: we build ReceiptNest, so this is a vendor comparison, not an independent ranking or a hands-on accuracy benchmark. Expensify also has free individual features. Compare the current plans and test the same receipts in both products.',
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
