import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { SeoService } from '../../services/seo.service';
import { ThemeService } from '../../services/theme.service';

type SeoPageKey =
  | 'receipt-tracker'
  | 'receipt-organizer'
  | 'receipt-scanner'
  | 'receipt-management-software'
  | 'expense-tracker'
  | 'tax-receipt-organizer';

interface SeoPage {
  key: SeoPageKey;
  path: string;
  eyebrow: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  primaryCta: string;
  secondaryCta: string;
  proofPoints: string[];
  sections: {
    title: string;
    body: string;
  }[];
  useCases: string[];
  faq: {
    question: string;
    answer: string;
  }[];
  keywords: string;
}

const pages: Record<SeoPageKey, SeoPage> = {
  'receipt-tracker': {
    key: 'receipt-tracker',
    path: '/receipt-tracker',
    eyebrow: 'Receipt tracking app',
    title: 'Receipt Tracker App for Organized Expenses | ReceiptNest AI',
    description:
      'Track receipts by month, merchant, category, and total with ReceiptNest AI, a private receipt tracker app for everyday spending, taxes, and clean expense records.',
    h1: 'Receipt tracker app for people who want spending clarity',
    intro:
      'ReceiptNest AI keeps every receipt searchable and grouped by month, merchant, category, and amount so you can stop rebuilding expense history from inbox searches and spreadsheets.',
    primaryCta: 'Start tracking receipts',
    secondaryCta: 'See how receipt tracking works',
    proofPoints: ['Search by merchant, category, and month', 'Track email, photo, and PDF receipts', 'Export clean records for taxes or review'],
    sections: [
      {
        title: 'Track receipts without manual filing',
        body:
          'Forward email receipts, upload PDFs, or capture paper receipts from your phone. ReceiptNest AI extracts the useful details and places each receipt into a searchable history.'
      },
      {
        title: 'Know what happened this month',
        body:
          'Monthly totals, categories, merchants, and recent receipts stay together, which makes it easier to review spending before tax season or budget check-ins.'
      },
      {
        title: 'Keep your records portable',
        body:
          'Your receipts stay in your account, and export options help you share organized records with an accountant or keep a backup for your own files.'
      }
    ],
    useCases: ['Freelance receipt tracking', 'Small business expense records', 'Personal receipt history', 'Tax-time receipt exports'],
    faq: [
      {
        question: 'What does a receipt tracker app do?',
        answer:
          'A receipt tracker stores receipt records and makes them searchable by details like merchant, amount, date, category, and month. ReceiptNest AI focuses on receipt capture, organization, tracking, and export.'
      },
      {
        question: 'Can I track receipts from email and photos?',
        answer:
          'Yes. ReceiptNest AI supports receipts from forwarded emails, photo uploads, and PDF uploads so your records are not split across different places.'
      }
    ],
    keywords:
      'receipt tracker, receipt tracking app, track receipts, receipt tracker app, expense receipt tracker, receipt organizer'
  },
  'receipt-organizer': {
    key: 'receipt-organizer',
    path: '/receipt-organizer',
    eyebrow: 'Receipt organizer app',
    title: 'Receipt Organizer App for Email, Photos, and PDFs | ReceiptNest AI',
    description:
      'Organize receipts from email, photos, and PDFs with ReceiptNest AI. Search merchants, categories, monthly totals, taxes, and receipt exports in one private receipt organizer.',
    h1: 'A receipt organizer app for messy real-life receipts',
    intro:
      'ReceiptNest AI turns scattered receipts into one organized receipt inbox, with automatic merchant, category, amount, tax, and month details for fast review.',
    primaryCta: 'Organize receipts free',
    secondaryCta: 'Compare organizer features',
    proofPoints: ['One receipt inbox for email, photos, and PDFs', 'Automatic merchant and category organization', 'Monthly folders and export-ready records'],
    sections: [
      {
        title: 'One place for every receipt',
        body:
          'Instead of leaving receipts in email, camera roll, downloads, and paper piles, ReceiptNest AI gives you a central receipt organizer that works across common receipt formats.'
      },
      {
        title: 'Automatic structure after capture',
        body:
          'The app reads receipt details and keeps records grouped by date, merchant, and category, which makes cleanup faster than naming files manually.'
      },
      {
        title: 'Built for review, not accounting complexity',
        body:
          'ReceiptNest AI is for people who need organized receipts and spending clarity without adopting a full accounting platform.'
      }
    ],
    useCases: ['Email receipt organizer', 'Photo receipt organizer', 'PDF receipt organizer', 'Monthly receipt filing'],
    faq: [
      {
        question: 'How is ReceiptNest AI different from cloud storage?',
        answer:
          'Cloud storage keeps files, but ReceiptNest AI reads and organizes receipt details so you can search by merchant, total, category, month, and other useful fields.'
      },
      {
        question: 'Can I use it for business and personal receipts?',
        answer:
          'Yes. ReceiptNest AI works for personal expense organization, freelancer records, self-employed tax prep, and lightweight small business receipt management.'
      }
    ],
    keywords:
      'receipt organizer, receipt organizer app, organize receipts, AI receipt organizer, receipt filing app, receipt management'
  },
  'receipt-scanner': {
    key: 'receipt-scanner',
    path: '/receipt-scanner',
    eyebrow: 'Receipt scanner app',
    title: 'Receipt Scanner App with AI Organization | ReceiptNest AI',
    description:
      'Scan receipts from photos, PDFs, and emails. ReceiptNest AI extracts merchant, date, total, tax, and category details into a searchable receipt scanner and tracker.',
    h1: 'Receipt scanning that becomes organized expense history',
    intro:
      'ReceiptNest AI does more than capture an image. It reads receipts, extracts the details you need, and adds them to a searchable monthly spending record.',
    primaryCta: 'Scan receipts free',
    secondaryCta: 'View scanner workflow',
    proofPoints: ['Photo and PDF receipt capture', 'AI merchant, total, tax, and category extraction', 'Searchable receipt records after scanning'],
    sections: [
      {
        title: 'Scan the receipt once',
        body:
          'Capture a paper receipt with your phone or upload a receipt file. ReceiptNest AI keeps the original record and extracts structured details for faster review.'
      },
      {
        title: 'Turn scans into usable data',
        body:
          'Merchant names, dates, totals, taxes, and categories are easier to search and export when they are stored as data instead of image-only files.'
      },
      {
        title: 'Review and export when needed',
        body:
          'Use monthly views and exports when you need to understand spending, prepare tax records, or send organized receipts to someone else.'
      }
    ],
    useCases: ['Scan paper receipts', 'Read PDF receipts', 'Capture mobile receipt photos', 'Extract receipt totals and taxes'],
    faq: [
      {
        question: 'Does ReceiptNest AI only scan images?',
        answer:
          'No. It supports receipt capture from photos, PDFs, and forwarded email receipts, then organizes the extracted receipt data.'
      },
      {
        question: 'Can I search scanned receipts later?',
        answer:
          'Yes. Once receipts are processed, you can search and review them by useful details such as merchant, category, month, and amount.'
      }
    ],
    keywords:
      'receipt scanner, receipt scanner app, scan receipts, AI receipt scanner, receipt scanning app, PDF receipt scanner'
  },
  'receipt-management-software': {
    key: 'receipt-management-software',
    path: '/receipt-management-software',
    eyebrow: 'Receipt management software',
    title: 'Receipt Management Software for Simple Expense Records | ReceiptNest AI',
    description:
      'ReceiptNest AI is receipt management software for storing, organizing, searching, and exporting receipts without heavy accounting software.',
    h1: 'Receipt management software without accounting bloat',
    intro:
      'ReceiptNest AI helps you manage receipt records from capture to review, keeping the workflow focused on receipt storage, tracking, organization, and export.',
    primaryCta: 'Manage receipts free',
    secondaryCta: 'Explore receipt workflows',
    proofPoints: ['Private cloud receipt storage', 'Automatic categorization and monthly summaries', 'CSV and PDF export-ready records'],
    sections: [
      {
        title: 'Manage receipts as records',
        body:
          'Receipt files are useful, but structured records are easier to search. ReceiptNest AI keeps both the original receipt and the details needed for later review.'
      },
      {
        title: 'A lighter alternative to accounting tools',
        body:
          'If you need receipt management but not invoicing, payroll, or double-entry accounting, ReceiptNest AI keeps the product focused and easier to use.'
      },
      {
        title: 'Useful for repeat monthly work',
        body:
          'Monthly dashboards, folders, categories, and exports help turn receipt cleanup into a repeatable habit instead of an end-of-year scramble.'
      }
    ],
    useCases: ['Self-employed receipt management', 'Small team receipt records', 'Monthly expense review', 'Accountant-ready exports'],
    faq: [
      {
        question: 'Is ReceiptNest AI accounting software?',
        answer:
          'ReceiptNest AI is receipt management software, not full accounting software. It is focused on capturing, organizing, searching, tracking, and exporting receipts.'
      },
      {
        question: 'Can I export managed receipts?',
        answer:
          'Yes. ReceiptNest AI is designed around organized receipt records that can be exported for taxes, accounting review, or personal backup.'
      }
    ],
    keywords:
      'receipt management software, receipt management app, manage receipts, receipt storage, receipt organization software'
  },
  'expense-tracker': {
    key: 'expense-tracker',
    path: '/expense-tracker',
    eyebrow: 'Expense tracker',
    title: 'Expense Tracker Built Around Receipts | ReceiptNest AI',
    description:
      'ReceiptNest AI is an expense tracker built around receipts, helping you capture spending records, categorize purchases, review monthly totals, and export clean reports.',
    h1: 'An expense tracker that starts with the receipt',
    intro:
      'Most spending questions start with proof. ReceiptNest AI keeps the receipt attached to the expense record so monthly totals stay connected to real purchases.',
    primaryCta: 'Track expenses free',
    secondaryCta: 'See monthly tracking',
    proofPoints: ['Receipt-backed expense records', 'Monthly category and merchant views', 'Exports for taxes and accounting review'],
    sections: [
      {
        title: 'Connect totals to actual receipts',
        body:
          'Track spending by month and category while keeping the receipt source available for review, reimbursement, tax prep, or personal reference.'
      },
      {
        title: 'Spend less time cleaning spreadsheets',
        body:
          'ReceiptNest AI extracts the details that usually require manual entry, giving you a cleaner starting point for expense review.'
      },
      {
        title: 'Simple enough for everyday use',
        body:
          'The app is intentionally focused on receipts and spending clarity, which makes it useful for freelancers, households, and small teams.'
      }
    ],
    useCases: ['Freelance expense tracking', 'Monthly spending review', 'Receipt-backed budgets', 'Tax deduction records'],
    faq: [
      {
        question: 'Can a receipt app work as an expense tracker?',
        answer:
          'Yes. ReceiptNest AI tracks expense details from receipts and keeps them searchable by month, merchant, category, and amount.'
      },
      {
        question: 'Do I need accounting knowledge to use it?',
        answer:
          'No. ReceiptNest AI focuses on receipt capture, organization, and monthly spending clarity rather than complex accounting workflows.'
      }
    ],
    keywords:
      'expense tracker, receipt expense tracker, expense tracking app, track expenses, receipt tracker for expenses'
  },
  'tax-receipt-organizer': {
    key: 'tax-receipt-organizer',
    path: '/tax-receipt-organizer',
    eyebrow: 'Tax receipt organizer',
    title: 'Tax Receipt Organizer for Export-Ready Records | ReceiptNest AI',
    description:
      'Organize tax receipts throughout the year with ReceiptNest AI. Capture receipts, search categories and merchants, and export receipt records for tax review.',
    h1: 'A tax receipt organizer for the receipts you need later',
    intro:
      'ReceiptNest AI helps you collect and organize receipts before tax season, with searchable records and exports that are easier to review than scattered files.',
    primaryCta: 'Organize tax receipts',
    secondaryCta: 'View tax-ready features',
    proofPoints: ['Monthly and category-based receipt organization', 'Original receipt files kept with extracted details', 'Exportable records for tax review'],
    sections: [
      {
        title: 'Collect receipts all year',
        body:
          'Forward emails, scan paper receipts, or upload files as they happen so tax-time receipt cleanup does not depend on memory.'
      },
      {
        title: 'Review categories and merchants',
        body:
          'Search and filter by the details that matter when checking deductions, reimbursements, or yearly spending patterns.'
      },
      {
        title: 'Export records when it is time',
        body:
          'Create cleaner receipt exports for your own records or for an accountant. ReceiptNest AI helps prepare the records, while tax decisions stay with you or your tax professional.'
      }
    ],
    useCases: ['Freelancer tax receipts', 'Self-employed deductions', 'Year-end receipt exports', 'Accountant-ready receipt files'],
    faq: [
      {
        question: 'Does ReceiptNest AI give tax advice?',
        answer:
          'No. ReceiptNest AI organizes and exports receipt records. You should work with a qualified tax professional for tax advice.'
      },
      {
        question: 'Can I export receipts for my accountant?',
        answer:
          'Yes. ReceiptNest AI is designed to keep receipt records organized and export-ready for review.'
      }
    ],
    keywords:
      'tax receipt organizer, organize receipts for taxes, receipt organizer for taxes, tax receipts app, receipt exports'
  }
};

@Component({
  selector: 'app-seo-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './seo-page.component.html',
  styleUrl: './seo-page.component.css'
})
export class SeoPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  private readonly theme = inject(ThemeService);

  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly page = pages[this.route.snapshot.data['page'] as SeoPageKey] ?? pages['receipt-tracker'];
  readonly relatedPages = Object.values(pages).filter(page => page.key !== this.page.key);

  constructor() {
    this.seo.apply({
      title: this.page.title,
      description: this.page.description,
      canonicalPath: this.page.path,
      keywords: this.page.keywords
    });

    this.seo.setJsonLd(this.page.key, {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': this.seo.absoluteUrl(`${this.page.path}#webpage`),
          url: this.seo.absoluteUrl(this.page.path),
          name: this.page.title,
          description: this.page.description,
          isPartOf: {
            '@id': 'https://receipt-nest.com/#website'
          },
          about: {
            '@id': 'https://receipt-nest.com/#app'
          }
        },
        {
          '@type': 'FAQPage',
          '@id': this.seo.absoluteUrl(`${this.page.path}#faq`),
          mainEntity: this.page.faq.map(item => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: item.answer
            }
          }))
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'ReceiptNest AI',
              item: 'https://receipt-nest.com/'
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: this.page.eyebrow,
              item: this.seo.absoluteUrl(this.page.path)
            }
          ]
        }
      ]
    });
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }
}
