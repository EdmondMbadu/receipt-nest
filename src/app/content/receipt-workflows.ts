export interface WorkflowLink { readonly path: string; readonly label: string; }
export interface WorkflowSource { readonly href: string; readonly label: string; }
export interface WorkflowSection { readonly title: string; readonly body: string; }
export interface ReceiptWorkflow {
  readonly h1: string;
  readonly intro: string;
  readonly benefit: string;
  readonly image?: string;
  readonly imageAlt?: string;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
  readonly imageCaption?: string;
  readonly steps: readonly WorkflowSection[];
  readonly example: {
    readonly title: string;
    readonly description: string;
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
    readonly caption: string;
  };
  readonly sections: readonly WorkflowSection[];
  readonly faq: readonly { readonly question: string; readonly answer: string; }[];
  readonly related: readonly WorkflowLink[];
  readonly sources?: readonly WorkflowSource[];
}

export const receiptWorkflows: Readonly<Record<string, ReceiptWorkflow>> = {
  "receipt-tracker": {
    "h1": "A receipt tracker for the purchases you need to find again.",
    "intro": "A paper receipt in your wallet. A PDF in Downloads. An email you cannot find. ReceiptNest brings those records together so a simple question—what did I buy, and where is the receipt?—does not turn into an evening of searching.",
    "benefit": "Capture now. Review by month. Export when you need to.",
    "image": "/assets/monthly-light.png",
    "imageWidth": 744,
    "imageHeight": 1507,
    "imageAlt": "ReceiptNest monthly spending screen",
    "imageCaption": "ReceiptNest product screen. Your totals depend on the records you add.",
    "steps": [
      {
        "title": "Capture purchases as they happen",
        "body": "Upload a receipt photo or PDF, or forward an email receipt to your ReceiptNest address. The app reads the merchant, date, total, and category so you have a starting point without retyping every field."
      },
      {
        "title": "Review one month at a time",
        "body": "Check the extracted details against the original and correct anything that needs attention. Review the month's merchants and categories while the purchases are still familiar, instead of reconstructing a year at once."
      },
      {
        "title": "Find the original or export the records",
        "body": "Use the receipt history when a purchase needs checking, a return needs proof, or an accountant asks for records. Download a monthly CSV when you want to continue the review in a spreadsheet."
      }
    ],
    "example": {
      "title": "Give each receipt a next step",
      "description": "An illustrative weekly review—not a live customer account.",
      "columns": [
        "Record",
        "What to check",
        "Next step"
      ],
      "rows": [
        [
          "Office supplies",
          "Merchant, purchase date, total",
          "Confirm the category"
        ],
        [
          "Emailed subscription receipt",
          "Correct month and amount",
          "Keep the email receipt with other records"
        ],
        [
          "Receipt needed for a return",
          "Original proof of purchase",
          "Find the merchant and open the record"
        ]
      ],
      "caption": "Keeping a receipt does not determine whether a purchase is deductible or returnable."
    },
    "sections": [
      {
        "title": "A manageable habit for freelancers",
        "body": "Start with the current month, even if older receipts are still scattered. Add a small backlog in each review session. Capturing a few receipts consistently is more useful than creating an elaborate filing system you never revisit."
      },
      {
        "title": "Know what the totals include",
        "body": "ReceiptNest totals reflect the records you have added, not every transaction in your bank account. Missing receipts, refunds, or duplicate uploads can change the picture. Review your records before relying on an export."
      }
    ],
    "faq": [
      {
        "question": "Can I track personal and freelance receipts?",
        "answer": "Yes. You can organize records for either purpose. Review categories and keep a clear distinction between personal and business purchases; the app does not make tax decisions for you."
      },
      {
        "question": "Is this a bank-connected budgeting app?",
        "answer": "No. This workflow starts with receipts you upload or forward. Use your bank records or accounting software alongside ReceiptNest when you need a complete financial picture."
      },
      {
        "question": "What can I try for free?",
        "answer": "The Starter plan includes an allowance of up to 50 receipts, categorization, monthly summaries, and CSV export. Pro adds unlimited receipts and additional features. See pricing for the plan details."
      },
      {
        "question": "What if the scanner gets a detail wrong?",
        "answer": "Check the extracted record against the original and edit incorrect details before using it. AI extraction can make mistakes, particularly with unclear images or unusual receipt layouts."
      }
    ],
    "related": [
      {
        "path": "/receipt-to-csv",
        "label": "See the CSV format before you export"
      },
      {
        "path": "/blog/scan-receipts-automatically",
        "label": "Build a receipt-scanning habit"
      },
      {
        "path": "/receipt-organizer",
        "label": "Organize an older receipt backlog"
      }
    ]
  },
  "receipt-organizer": {
    "h1": "One receipt organizer for your inbox, camera roll, and paper pile.",
    "intro": "The hard part is often not saving a receipt. It is finding the right one later. ReceiptNest gives photos, PDFs, and forwarded receipts a shared place, with merchant, date, amount, and category details you can review.",
    "benefit": "Keep the document and the useful details together.",
    "image": "/assets/auto-light.png",
    "imageWidth": 772,
    "imageHeight": 1559,
    "imageAlt": "ReceiptNest screen showing receipts organized in categories",
    "imageCaption": "An existing ReceiptNest product screen; interface details can vary by platform.",
    "steps": [
      {
        "title": "Choose a small starting point",
        "body": "Begin with one month, a handful of paper receipts, or a folder of downloaded PDFs. Upload receipt files and forward the emails you want to retain. You do not need to clear your entire backlog before the organizer becomes useful."
      },
      {
        "title": "Check the details that make records findable",
        "body": "Review the merchant, receipt date, amount, and category after processing. An incorrect date can place a receipt in the wrong month; a vague merchant name can make it harder to recognize later."
      },
      {
        "title": "Use the record when the question comes",
        "body": "Find the original for a purchase query or review a category at month-end. Export records when another person needs a spreadsheet. Keep any additional documents that establish payment, business purpose, or other context."
      }
    ],
    "example": {
      "title": "From scattered file to useful record",
      "description": "Examples of where receipt organization helps.",
      "columns": [
        "Where it starts",
        "Why it is hard to find",
        "A useful habit"
      ],
      "rows": [
        [
          "Camera roll",
          "Photos mixed with everything else",
          "Upload the receipt soon after purchase"
        ],
        [
          "Email inbox",
          "Merchant messages use different subjects",
          "Forward the receipt to your account"
        ],
        [
          "Downloads folder",
          "PDF names are not descriptive",
          "Review merchant and date after upload"
        ]
      ],
      "caption": "Email forwarding is a deliberate action. ReceiptNest does not need access to your entire inbox for this workflow."
    },
    "sections": [
      {
        "title": "How this differs from a cloud folder",
        "body": "A cloud folder is a good place to store documents. A receipt organizer adds structured purchase details and receipt-focused views. If you already have a reliable folder system and only a few receipts, you may not need another app."
      },
      {
        "title": "Keep originals, not just totals",
        "body": "A row in a spreadsheet does not contain everything on an itemized receipt. Preserve the original document and relevant supporting records. For a return or warranty, check the retailer's requirements; keeping a receipt is not a guarantee of acceptance."
      }
    ],
    "faq": [
      {
        "question": "Can I organize PDF and photo receipts together?",
        "answer": "Yes. Receipt photos, uploaded PDFs, and forwarded receipts appear within the same receipt workflow rather than separate filing systems."
      },
      {
        "question": "Can this replace Google Drive or another backup?",
        "answer": "ReceiptNest adds receipt-specific organization. Keep any backups your business or recordkeeping policy requires, and check what each export includes before relying on it as a complete archive."
      },
      {
        "question": "Do I have to rename every file?",
        "answer": "No. Organization uses the receipt details rather than depending on a filename. Review those details after extraction so the record is filed usefully."
      },
      {
        "question": "Does organizing receipts automatically identify deductions?",
        "answer": "No. Categories help review your records, but they are not a determination of business purpose or deductibility."
      }
    ],
    "related": [
      {
        "path": "/email-receipt-organizer",
        "label": "Bring email receipts into the same system"
      },
      {
        "path": "/blog/can-bank-statements-replace-receipts",
        "label": "Understand what a bank statement can establish"
      },
      {
        "path": "/receipt-tracker",
        "label": "Keep new receipts organized each month"
      }
    ]
  },
  "receipt-scanner": {
    "h1": "Scan a receipt. Review the details. Keep a usable record.",
    "intro": "A receipt photo is a useful start. ReceiptNest turns it into a record with a merchant, date, total, currency, and suggested category, while keeping the original available for review. Upload a photo or PDF and check the result before you use it.",
    "benefit": "Less retyping, with room to check and correct.",
    "image": "/assets/capture-light.png",
    "imageWidth": 770,
    "imageHeight": 1554,
    "imageAlt": "ReceiptNest receipt-upload screen with camera, gallery, and file options",
    "imageCaption": "ReceiptNest mobile capture screen. Available controls can vary by platform.",
    "steps": [
      {
        "title": "Capture a readable receipt",
        "body": "Place the receipt flat, include the merchant and final total, and avoid glare or cut-off edges. Upload the photo or a receipt PDF. A clear original gives extraction a better starting point than a blurred screenshot."
      },
      {
        "title": "Review the extracted record",
        "body": "Compare the merchant, date, and final amount with the source document. Check whether the amount includes tax and whether a discount or refund changes it. Correct mistakes rather than assuming every extraction is accurate."
      },
      {
        "title": "Organize and export",
        "body": "Confirm the category, find the record in its month, and export to CSV when you need spreadsheet data. Scanning is the capture step; reviewing and retaining the source document make the record useful."
      }
    ],
    "example": {
      "title": "What a receipt record contains",
      "description": "Illustrative fields—not a measured OCR result or an accuracy benchmark.",
      "columns": [
        "Field",
        "Example",
        "What to verify"
      ],
      "rows": [
        [
          "Merchant",
          "Example Office Supply",
          "Use a recognizable seller name"
        ],
        [
          "Date",
          "2026-09-04",
          "Check the purchase date"
        ],
        [
          "Total / currency",
          "27.48 USD",
          "Use the final amount paid"
        ],
        [
          "Category",
          "Office expense",
          "Review the suggested category"
        ]
      ],
      "caption": "This example does not promise line-item or separate sales-tax extraction. Verify the fields in your own receipt record."
    },
    "sections": [
      {
        "title": "When a scan needs attention",
        "body": "Faded paper, unusual date formats, long receipts, handwriting, or an image containing several documents can produce incomplete results. Try a clearer capture and review the record. If a file keeps failing, contact support without posting financial documents publicly."
      },
      {
        "title": "CSV is a receipt summary, not the whole document",
        "body": "The monthly export contains merchant, date, and amount. It is useful for spreadsheet review, but it is not a line-item transcript or a native Excel workbook. The CSV guide shows the format and its limitations before you sign up."
      }
    ],
    "faq": [
      {
        "question": "Is a receipt scanner the same as a document scanner?",
        "answer": "A document scanner usually preserves an image or PDF. ReceiptNest also extracts purchase fields so receipts can be organized and reviewed as records."
      },
      {
        "question": "Does it scan receipts without any manual work?",
        "answer": "It reduces data entry, but you should still review the output and correct mistakes. No automatic scanner should be treated as infallible."
      },
      {
        "question": "Can I scan a receipt from email?",
        "answer": "Forward a receipt email to the address provided in your account. Supported attachments and email-body receipts follow the receipt-ingestion workflow."
      },
      {
        "question": "Can I export scanned receipts to Excel?",
        "answer": "You can download a CSV of receipt records and open it in Excel or Google Sheets. This is not a promise of native XLSX export or line-item extraction."
      }
    ],
    "related": [
      {
        "path": "/receipt-to-csv",
        "label": "Inspect the sample CSV and column definitions"
      },
      {
        "path": "/blog/scan-receipts-automatically",
        "label": "Read the capture-and-review guide"
      },
      {
        "path": "/security",
        "label": "Understand cloud receipt processing"
      }
    ]
  },
  "receipt-management-software": {
    "h1": "Receipt management for a small business—not a whole finance department.",
    "intro": "If your immediate problem is collecting receipts and preparing them for review, a full accounting rollout may be more than you need. ReceiptNest focuses on capture, organization, original-document access, and exports.",
    "benefit": "A repeatable handoff from scattered receipts to reviewed records.",
    "image": "/assets/auto-light.png",
    "imageWidth": 772,
    "imageHeight": 1559,
    "imageAlt": "ReceiptNest categorized receipt view",
    "imageCaption": "Receipt organization in the app. This is not an employee approval or bookkeeping ledger screen.",
    "steps": [
      {
        "title": "Define what belongs in the collection",
        "body": "Choose the receipts you need for your own business records and make capture part of the purchase routine. Upload files or forward receipts; keep supporting invoices, payment records, and business-purpose notes where required."
      },
      {
        "title": "Review before the monthly handoff",
        "body": "Check dates, merchants, amounts, and categories. Look for missing purchases and repeated uploads using your other records. ReceiptNest organization supports this review; it does not perform a complete bank reconciliation."
      },
      {
        "title": "Agree on an export with your accountant",
        "body": "Ask which columns and original documents the recipient needs. Download a sample CSV first and confirm that its summary format fits. Sending an export is different from granting access to a multi-client accounting portal."
      }
    ],
    "example": {
      "title": "Decide whether the workflow fits",
      "description": "Start with the task you need to complete, not the longest feature list.",
      "columns": [
        "Your requirement",
        "ReceiptNest's role"
      ],
      "rows": [
        [
          "Store and find receipt records",
          "Receipt-focused capture and organization"
        ],
        [
          "Share a spreadsheet summary",
          "CSV export for review"
        ],
        [
          "Run employee approvals or reimbursements",
          "Use an expense-management platform"
        ],
        [
          "Maintain a ledger, payroll, or tax filing",
          "Use appropriate accounting or tax software"
        ]
      ],
      "caption": "No native accounting integration, employee approval chain, or bookkeeping service is implied."
    },
    "sections": [
      {
        "title": "For the person doing the receipt cleanup",
        "body": "This workflow suits a freelancer, owner, or individual responsible for their own receipts. If your business needs several employees to submit and approve expenses, evaluate those permissions and controls separately before choosing a tool."
      },
      {
        "title": "Keep the handoff predictable",
        "body": "Use a consistent review period and tell the recipient whether an export covers a month, a folder, or a category. Do not mix currency totals or confuse a summary row with a purchase. Include the original documents when the recipient needs more than a summary."
      }
    ],
    "faq": [
      {
        "question": "Does ReceiptNest replace bookkeeping software?",
        "answer": "No. It organizes receipts and supports record review. It is not a double-entry ledger, payroll system, tax-filing service, or bank-reconciliation tool."
      },
      {
        "question": "Can my accountant use the export?",
        "answer": "They can review the CSV if its columns meet their needs. Confirm the format and supporting documents with them; an export is not a guaranteed direct import into accounting software."
      },
      {
        "question": "Is this employee expense-report software?",
        "answer": "The receipt workflow described here is not an approval or reimbursement system. Choose a platform with those controls if they are essential."
      },
      {
        "question": "What should I test before subscribing?",
        "answer": "Try representative receipts, review extraction, find an original, and open an export in the tool your business uses. Check pricing and data handling before committing."
      }
    ],
    "related": [
      {
        "path": "/receipt-to-csv",
        "label": "Check whether the CSV fits your handoff"
      },
      {
        "path": "/blog/receiptnest-vs-expensify",
        "label": "Compare receipt tracking with Expensify"
      },
      {
        "path": "/tax-receipt-organizer",
        "label": "Prepare receipt records for tax review"
      }
    ]
  },
  "expense-tracker": {
    "h1": "See your receipt-backed expenses, one month at a time.",
    "intro": "What did those small purchases add up to? ReceiptNest connects the amounts in your receipt history to merchants and categories, so you can review spending with the original records close at hand.",
    "benefit": "Understand the purchases you captured—not an assumed picture of every transaction.",
    "image": "/assets/monthly-light.png",
    "imageWidth": 744,
    "imageHeight": 1507,
    "imageAlt": "ReceiptNest monthly spending view with a chart and total",
    "imageCaption": "Product screen illustrating a monthly view. Your receipts determine your totals.",
    "steps": [
      {
        "title": "Add the purchases you want to track",
        "body": "Capture paper receipts, upload PDFs, and forward email receipts. Review dates and amounts so purchases fall in the right month. A useful spending view starts with consistent input."
      },
      {
        "title": "Look at merchants and categories",
        "body": "Review the places and purchase types that make up your recorded spending. A category is a starting point for a question, not a judgment about whether a purchase was necessary or deductible."
      },
      {
        "title": "Compare with the rest of your records",
        "body": "Check bank statements and other records for purchases that have no saved receipt. Account for refunds or duplicates before drawing conclusions. Export a CSV if you want to continue the analysis in a spreadsheet."
      }
    ],
    "example": {
      "title": "Why the receipt total and bank total may differ",
      "description": "A practical reconciliation checklist, not automated bank matching.",
      "columns": [
        "Difference",
        "What to investigate"
      ],
      "rows": [
        [
          "Payment without an uploaded receipt",
          "Find the invoice or other supporting record"
        ],
        [
          "Refund or returned purchase",
          "Check how the adjustment is recorded"
        ],
        [
          "Two copies of one receipt",
          "Review for repeated uploads"
        ],
        [
          "Different currencies",
          "Review currencies separately before totaling"
        ]
      ],
      "caption": "A receipt-only view is not a complete budget, cash-flow statement, or accounting ledger."
    },
    "sections": [
      {
        "title": "A clearer starting point than memory",
        "body": "Instead of trying to remember every purchase at the end of the month, keep receipts as you go. The value is being able to return to the source when a number surprises you—not being told what you should spend."
      },
      {
        "title": "Use the right tool for the bigger picture",
        "body": "If you need bank feeds, debt planning, household budgeting, or business profitability, use a tool designed for those jobs. ReceiptNest can organize the supporting receipts alongside that system."
      }
    ],
    "faq": [
      {
        "question": "Will the dashboard include all my spending?",
        "answer": "No. It reflects the receipt records you add. Transactions without a record, refunds, and duplicates need to be reviewed separately."
      },
      {
        "question": "Can I use it without a strict budget?",
        "answer": "Yes. You can use it to collect receipts and review recorded spending without creating budget targets."
      },
      {
        "question": "Can I track freelance expenses?",
        "answer": "You can organize your receipt-backed purchases and export them for review. Determining business use, deductibility, or profitability requires additional judgment and records."
      },
      {
        "question": "Can I work with the data in a spreadsheet?",
        "answer": "Yes. CSV export is included in Starter. Review the export columns and currency limitations before combining it with other data."
      }
    ],
    "related": [
      {
        "path": "/blog/where-does-my-money-go",
        "label": "Build a monthly spending-review habit"
      },
      {
        "path": "/receipt-to-csv",
        "label": "Review your receipts in a spreadsheet"
      },
      {
        "path": "/receipt-tracker",
        "label": "Make receipt capture consistent"
      }
    ]
  },
  "tax-receipt-organizer": {
    "h1": "Organize tax receipts before the year-end scramble.",
    "intro": "Give your future self a better starting point. ReceiptNest helps freelancers collect receipt photos, PDFs, and forwarded emails, review the purchase details, and export records for tax-preparation review.",
    "benefit": "Record organization—not tax advice or a guarantee of deductibility.",
    "image": "/assets/auto-light.png",
    "imageWidth": 772,
    "imageHeight": 1559,
    "imageAlt": "ReceiptNest receipt categories for reviewing purchase records",
    "imageCaption": "Categories help organize records. They do not determine tax treatment.",
    "steps": [
      {
        "title": "Collect the original supporting records",
        "body": "Save the receipt while you have it and retain other documents that establish payment or business purpose. A receipt summary alone may not explain what you bought or how it relates to your work."
      },
      {
        "title": "Review details throughout the year",
        "body": "Check merchants, dates, totals, and categories regularly. Keep explanations for mixed-use or unusual purchases with your supporting records, and ask a qualified tax professional about treatment rather than relying on a category label."
      },
      {
        "title": "Prepare the handoff your tax professional needs",
        "body": "Confirm the period, export columns, and original documents they need. Review the CSV and keep other required business records. ReceiptNest helps organize receipts; it does not prepare or file your tax return."
      }
    ],
    "example": {
      "title": "Before you hand over a receipt",
      "description": "A US-focused record-organization checklist; requirements vary by situation.",
      "columns": [
        "Question",
        "Supporting detail to check"
      ],
      "rows": [
        [
          "Who was paid?",
          "Recognizable merchant or payee"
        ],
        [
          "What was purchased, and when?",
          "Original receipt or invoice and date"
        ],
        [
          "How much was paid?",
          "Amount and evidence of payment"
        ],
        [
          "How does it relate to work?",
          "Business-purpose explanation and other records"
        ]
      ],
      "caption": "A combination of documents may be needed. See the IRS recordkeeping guidance linked below."
    },
    "sections": [
      {
        "title": "Digital does not mean disposable",
        "body": "Electronic records need to remain readable, complete, and accessible for the applicable period. Keep suitable backups and originals where required. Check the IRS guidance and your professional's advice before discarding documents."
      },
      {
        "title": "Retention is not one universal number",
        "body": "How long to retain a record depends on the return, transaction, and circumstances. Some records need to be kept longer than the general period. The linked freelancer guide explains a practical organization routine and points to the official retention rules."
      }
    ],
    "faq": [
      {
        "question": "Does ReceiptNest decide which purchases I can deduct?",
        "answer": "No. It helps collect and organize receipts. A category or export does not establish deductibility, and the app is not tax-filing software."
      },
      {
        "question": "Can I keep digital receipts for US tax records?",
        "answer": "Electronic records must meet applicable recordkeeping requirements. Keep them complete, readable, and accessible, and consult IRS guidance or your tax professional for your situation."
      },
      {
        "question": "Are bank statements enough?",
        "answer": "A statement can show a payment but may not establish the item purchased or business purpose. Additional supporting documents may be needed."
      },
      {
        "question": "Will the CSV be enough for my accountant?",
        "answer": "Ask them which fields and documents they need. The monthly CSV is a purchase summary, not a substitute for every supporting record."
      }
    ],
    "related": [
      {
        "path": "/blog/organize-receipts-taxes-freelancer-guide",
        "label": "Read the freelancer receipt-organization guide"
      },
      {
        "path": "/blog/can-bank-statements-replace-receipts",
        "label": "Understand statements versus itemized receipts"
      },
      {
        "path": "/receipt-to-csv",
        "label": "See the export before your handoff"
      }
    ],
    "sources": [
      {
        "href": "https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep",
        "label": "IRS: What kind of records should I keep?"
      },
      {
        "href": "https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records",
        "label": "IRS: How long should I keep records?"
      }
    ]
  },
  "receipt-to-csv": {
    "h1": "Turn receipt records into a CSV you can actually inspect.",
    "intro": "Need your receipts in Excel or Google Sheets? ReceiptNest exports a simple CSV of recorded purchases. See the columns and download an example before creating an account, so you know whether the format fits your workflow.",
    "benefit": "Sample download: no account. Exporting your own receipts: account required.",
    "steps": [
      {
        "title": "Capture and review your receipts",
        "body": "Upload photos or PDFs, or forward email receipts into your account. Compare extracted dates, merchants, and amounts with the original documents and correct any errors before export."
      },
      {
        "title": "Choose the records to export",
        "body": "Use the monthly or folder CSV download for a receipt summary. Category exports also include a Category column. Choose the relevant view instead of assuming every export contains the same fields."
      },
      {
        "title": "Open the file in your spreadsheet",
        "body": "Import the CSV into Excel or Google Sheets and verify date and decimal interpretation. The export includes a final Total row; exclude that row when importing transactions or calculating your own sum."
      }
    ],
    "example": {
      "title": "Monthly export example",
      "description": "Fictional single-currency purchases in the current monthly-export format.",
      "columns": [
        "Merchant",
        "Date",
        "Amount"
      ],
      "rows": [
        [
          "Example Office Supply",
          "2026-09-04",
          "27.48"
        ],
        [
          "Example Software",
          "2026-09-08",
          "12.00"
        ],
        [
          "Example Print Shop",
          "2026-09-10",
          "9.74"
        ],
        [
          "Total",
          "",
          "49.22"
        ]
      ],
      "caption": "Amounts in this example are USD. The monthly CSV does not include a currency column; do not total mixed currencies without checking the original records."
    },
    "sections": [
      {
        "title": "Exactly what this CSV includes",
        "body": "Monthly and folder exports contain Merchant, Date, and Amount, followed by a total row. Category exports add Category. This is a summary of receipts, not a line-item table, separate sales-tax breakdown, or collection of original receipt files."
      },
      {
        "title": "CSV, Excel, and accounting imports are different",
        "body": "A CSV is a plain-text table that spreadsheet applications can open. ReceiptNest's CSV export is not a native XLSX workbook or a guaranteed direct import into QuickBooks, Xero, or another accounting system. Check the destination's required fields first."
      },
      {
        "title": "Keep supporting documents alongside the spreadsheet",
        "body": "A spreadsheet can make review easier, but it does not replace the receipt image or other proof of a purchase. Keep the relevant originals and confirm the handoff requirements with the person receiving your records."
      }
    ],
    "faq": [
      {
        "question": "Can I download the sample without signing up?",
        "answer": "Yes. The sample is a fictional CSV so you can inspect the format. To upload and export your own receipts, create a ReceiptNest account."
      },
      {
        "question": "Is CSV export free?",
        "answer": "Starter includes CSV export within its up-to-50-receipt allowance. Pro adds unlimited receipts and PDF export. This page does not provide an anonymous receipt-upload converter."
      },
      {
        "question": "Does the export include receipt images or line items?",
        "answer": "The monthly CSV contains merchant, date, and amount, not images or line-item detail. Keep the original documents separately for the review you need."
      },
      {
        "question": "Why is there a Total row?",
        "answer": "The export includes a summary at the end. Exclude that row from a transaction import and from any formula that sums the individual purchases, or you may count the total twice."
      },
      {
        "question": "How should I handle multiple currencies?",
        "answer": "Check currency on the original records before combining amounts. The current monthly CSV has no currency column and does not convert amounts into a common currency."
      }
    ],
    "related": [
      {
        "path": "/receipt-scanner",
        "label": "See how receipt capture and review work"
      },
      {
        "path": "/tax-receipt-organizer",
        "label": "Prepare records for tax review"
      },
      {
        "path": "/pricing",
        "label": "Compare Starter and Pro"
      }
    ]
  },
  "email-receipt-organizer": {
    "h1": "Keep email receipts out of the inbox search spiral.",
    "intro": "A subscription receipt arrives by email. A supplier sends a PDF. Another purchase is on paper. Forward the email receipts you want to keep to your ReceiptNest address and review them alongside your other receipt records.",
    "benefit": "Forward selected receipts. No full-inbox connection needed for this workflow.",
    "steps": [
      {
        "title": "Find your forwarding address",
        "body": "Sign in to ReceiptNest and copy the receipt-forwarding address shown in your account. Use that address rather than a generic support inbox. Treat it as personal account information and do not post it publicly."
      },
      {
        "title": "Forward the receipt email",
        "body": "Include the receipt content and any PDF or image attachment. A message that only links to a retailer portal may not contain the receipt itself; download the document from the retailer and upload it if necessary."
      },
      {
        "title": "Check the record after processing",
        "body": "Look for the merchant, date, and amount in your receipt history. Compare the result with the original email or attachment and correct errors before exporting. Keep other supporting documents when a summary does not tell the whole story."
      }
    ],
    "example": {
      "title": "What are you forwarding?",
      "description": "Use the path that includes the purchase information.",
      "columns": [
        "Email content",
        "Practical next step"
      ],
      "rows": [
        [
          "PDF or receipt-image attachment",
          "Forward the message with its attachment"
        ],
        [
          "Receipt details in the email body",
          "Forward the complete message and review the result"
        ],
        [
          "A link to a retailer account only",
          "Download the actual receipt, then upload it"
        ],
        [
          "Several different purchases",
          "Review the resulting records individually"
        ]
      ],
      "caption": "Forwarding is not automatic inbox synchronization, and a retailer link is not the same as an attached receipt."
    },
    "sections": [
      {
        "title": "If a receipt does not appear",
        "body": "Confirm that you used the exact address shown in your account, included a supported attachment or the receipt body, and have room in your plan allowance. If the issue persists, contact support with the approximate send time and file type. Do not include sensitive financial documents in a public support post."
      },
      {
        "title": "Make email and paper one routine",
        "body": "Forward a purchase receipt when it arrives, and photograph paper receipts while they are still readable. Review the month's records together. Check before forwarding the same message again so you do not create duplicate records."
      },
      {
        "title": "Understand where the data goes",
        "body": "Forwarding sends the selected email content into ReceiptNest's cloud-processing workflow. It is not on-device-only processing. Read the data-handling overview before sending financial information, and forward only records you are authorized to use."
      }
    ],
    "faq": [
      {
        "question": "Do I have to connect Gmail or Outlook?",
        "answer": "Not for forwarding. You send selected receipt messages to the address in your account. This page does not promise automatic access to or synchronization of your whole inbox."
      },
      {
        "question": "Can I forward a receipt with no attachment?",
        "answer": "The email-ingestion workflow can process receipt information in the message body. Review the result; a message containing only a link or incomplete order information may not contain enough detail."
      },
      {
        "question": "Can I send receipts to the support email?",
        "answer": "Use the dedicated forwarding address shown in your account for receipt ingestion. The support email is for questions, not a replacement for your receipt address."
      },
      {
        "question": "Are email receipts subject to my plan limit?",
        "answer": "Yes. Forwarding is part of your receipt allowance. Check your account's plan and remaining allowance if a receipt cannot be added."
      }
    ],
    "related": [
      {
        "path": "/receipt-organizer",
        "label": "Organize email, photo, and PDF records together"
      },
      {
        "path": "/receipt-to-csv",
        "label": "Export the records to a spreadsheet"
      },
      {
        "path": "/security",
        "label": "Read about receipt data handling"
      }
    ]
  }
};
