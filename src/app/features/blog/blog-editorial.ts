export interface EditorialLink {
  readonly href: string;
  readonly label: string;
  readonly fragment?: string;
}

export interface BlogEditorial {
  readonly note: string;
  readonly sources: readonly EditorialLink[];
  readonly workflows: readonly EditorialLink[];
  readonly cta: { readonly label: string; readonly body: string };
  readonly quickLinks?: readonly EditorialLink[];
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
    workflows: [scanner, email, tax],
    cta: { label: 'Save a business receipt', body: 'Start with a receipt you already have. Keep the original and review the merchant, date, and total before tax season.' }
  },
  'how-long-to-keep-receipts': {
    note: taxNote,
    sources: [
      retention,
      { href: 'https://www.irs.gov/taxtopics/tc305', label: 'IRS Topic 305: recordkeeping and periods of limitations' },
      { href: 'https://www.irs.gov/publications/p583', label: 'IRS Publication 583: how long to keep records and electronic records' },
      records
    ],
    workflows: [tax, csv, scanner],
    cta: { label: 'Save a readable copy of your first receipt', body: 'Photograph one receipt while it is still readable and check that you can find it by merchant and month.' }
  },
  'how-to-sort-a-shoebox-of-receipts': {
    note: taxNote,
    sources: [records, retention, { href: 'https://www.irs.gov/newsroom/reconstructing-records-after-a-natural-disaster-or-casualty-loss', label: 'IRS: reconstructing records' }],
    workflows: [scanner, csv, tax],
    cta: { label: 'Digitize the first stack', body: 'Pick one month from your shoebox and upload the first receipt. Review the details before moving on to the next stack.' }
  },
  'how-to-keep-track-of-receipts': {
    note: taxNote, sources: [records, retention],
    workflows: [
      { href: '/receipt-tracker', label: 'Track receipts by month' },
      { href: '/blog/receipt-tracking-delivery-drivers', label: 'Build an end-of-shift receipt routine for delivery work' },
      email, csv, tax
    ],
    cta: { label: 'Track your first receipt', body: 'Save today’s receipt and check the merchant and total. That gives you one record to find at your first monthly review.' }
  },
  'itemized-receipt-vs-credit-card-slip': {
    note: taxNote,
    sources: [
      records,
      { href: 'https://www.irs.gov/publications/p583', label: 'IRS Publication 583: supporting documents and proof of payment' },
      { href: 'https://www.irs.gov/publications/p463', label: 'IRS Publication 463, chapter 5: documentary evidence for travel, meals and gifts' }
    ],
    workflows: [scanner, tax, email],
    quickLinks: [{ href: '/blog/itemized-receipt-vs-credit-card-slip', fragment: 'short-answer', label: 'See the two $62 receipts side by side' }],
    cta: { label: 'Scan your itemized receipt', body: 'Save the receipt that shows what you bought. Keep the full original and review the extracted merchant, date, and total.' }
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
    workflows: [scanner, email, tax],
    cta: { label: 'Photograph a receipt before it fades', body: 'Capture the whole receipt while you can still read it, then open the saved original and check the details.' }
  },
  'organize-receipts-for-accountant': {
    note: taxNote, sources: [records],
    workflows: [tax, { href: '/blog/organize-receipts-taxes-freelancer-guide', label: 'Organize a full year of freelance tax receipts' }, email],
    quickLinks: [
      { href: '/blog/organize-receipts-for-accountant', fragment: 'checklist', label: 'Jump to the handoff checklist' },
      { href: '/receipt-to-csv', label: 'See and download a sample CSV' }
    ],
    cta: { label: 'Prepare your first month of receipts', body: 'Start with one month. Save the originals, check the extracted fields, and export a summary in the format your accountant expects.' }
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
    cta: { label: 'Review a month of purchases', body: 'Start with a few receipts, then look back at the original documents behind the totals.' },
    workflows: [
      { href: '/expense-tracker', label: 'See receipt-based spending by month and category' },
      { href: '/receipt-organizer', label: 'Turn scattered receipts into searchable records' },
      csv
    ]
  },
  'digitization-business-clarity-compounds': {
    note: productNote + ' This essay is about record visibility, not accounting or tax advice.',
    sources: [],
    cta: { label: 'Organize the receipts you already have', body: 'Add the first receipt from a scattered pile or inbox and make it something you can find again.' },
    workflows: [
      { href: '/receipt-organizer', label: 'Turn scattered receipts into searchable records' },
      { href: '/expense-tracker', label: 'See receipt-based spending by month and category' },
      csv
    ]
  },
  'can-bank-statements-replace-receipts': {
    note: taxNote + ' The $86.40 purchase is a fictional illustration from our Paper Trail video, not a customer record.',
    sources: [records, { href: 'https://www.irs.gov/publications/p583', label: 'IRS Publication 583: payment evidence and electronic records' }, retention],
    workflows: [scanner, tax, { href: '/blog/organize-receipts-for-accountant', label: 'See how to flag an unresolved purchase for your accountant' }],
    quickLinks: [{ href: '/blog/can-bank-statements-replace-receipts', fragment: 'missing-receipt', label: 'Lost a business receipt? Jump to the recovery steps' }],
    cta: { label: 'Save the receipt you recovered', body: 'Upload the duplicate or forward the confirmation email. Check it against the payment and keep the original with the receipt record.' }
  },
  'receipt-tracking-delivery-drivers': {
    note: taxNote,
    sources: [
      records,
      { href: 'https://www.irs.gov/businesses/gig-economy-tax-center', label: 'IRS: gig economy income and records' },
      { href: 'https://www.irs.gov/taxtopics/tc510', label: 'IRS: business vehicle expenses, mileage methods, and records' },
      { href: 'https://www.irs.gov/tax-professionals/standard-mileage-rates', label: 'IRS: mileage rates by year and date' }
    ],
    workflows: [{ href: '/receipt-tracker', label: 'Build an end-of-shift receipt routine' }, csv],
    cta: { label: 'Save a receipt from your next shift', body: 'Start with one work purchase. Check its details and keep it available for your weekly review.' }
  },
  'organize-receipts-taxes-freelancer-guide': {
    note: taxNote, sources: [records, retention], workflows: [tax, csv],
    cta: { label: 'Organize a month of freelance receipts', body: 'Start with the current month. Bring together the receipts you already have and check the originals before you export.' }
  },
  'receipt-tracking-etsy-sellers': {
    note: taxNote, sources: [records], workflows: [email, tax, csv],
    cta: { label: 'Save a receipt for your Etsy shop', body: 'Start with a supply, packaging, or shipping receipt and keep the original with the reviewed purchase details.' }
  },
  'receiptnest-vs-expensify': {
    note: 'Disclosure: we build ReceiptNest, so this is a vendor comparison, not an independent ranking or a hands-on accuracy benchmark. Expensify also has free individual features. Compare the current plans and test the same receipts in both products.',
    sources: [{ href: 'https://help.expensify.com/articles/new-expensify/getting-started/Free-Features-in-Expensify', label: 'Expensify: free individual features and web CSV export' }],
    workflows: [{ href: '/pricing', label: 'See ReceiptNest Starter and Pro limits' }, csv],
    cta: { label: 'Try ReceiptNest with a real receipt', body: 'Use a representative receipt, check what it extracts, and open the export before deciding whether the workflow fits.' }
  },
  'scan-receipts-automatically': {
    note: productNote, sources: [], workflows: [scanner, email, csv],
    cta: { label: 'Scan and review your first receipt', body: 'Upload one readable photo or PDF and compare the extracted fields with the original.' }
  },
  'where-does-my-money-go': {
    note: productNote + ' A receipt total is not a full bank balance or a complete budget.',
    sources: [], workflows: [{ href: '/expense-tracker', label: 'Understand receipt-based spending totals' }, { href: '/receipt-organizer', label: 'Organize the receipts you already have' }],
    cta: { label: 'Review your first month of receipts', body: 'Add a few receipts and see which purchases and categories you actually captured that month.' }
  }
};

export function getBlogEditorial(slug: string): BlogEditorial {
  const entry = editorial[slug];
  if (!entry) throw new Error('Missing editorial context for ' + slug);
  return entry;
}
