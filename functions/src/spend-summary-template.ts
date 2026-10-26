import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_STORE_URL, GOOGLE_PLAY_URL } from "./email-app-links";
import { EMAIL_SOCIAL_LINKS } from "./email-social-links";

export type SummaryPeriodType = "week" | "month";

export type NormalizedReceipt = {
  amount: number;
  currency: string;
  categoryName: string;
  merchantName: string;
  dateKey: string;
  dateLabel: string;
  createdAt: Date | null;
};

export type BreakdownItem = {
  name: string;
  total: number;
  count: number;
  share: number;
};

export type SummaryActivityItem = {
  label: string;
  sublabel: string;
  amount: number;
  receiptCount: number;
};

export type SummaryMetrics = {
  totalSpend: number;
  receiptCount: number;
  activeDays: number;
  averageSpend: number;
  topCategory: BreakdownItem | null;
  topMerchant: BreakdownItem | null;
  largestReceipt: NormalizedReceipt | null;
};

export type SummaryPeriod = {
  type: SummaryPeriodType;
  label: string;
  compactLabel: string;
  heroEyebrow: string;
  rangeLabel: string;
  startKey: string;
  endKey: string;
};

export type SpendSummaryData = {
  tip?: { id: string; body: string; url: string };
  period: SummaryPeriod;
  userName: string;
  userEmail: string;
  metrics: SummaryMetrics;
  categories: BreakdownItem[];
  merchants: BreakdownItem[];
  recentReceipts: NormalizedReceipt[];
  activity: SummaryActivityItem[];
  currency: string;
  mixedCurrencies: boolean;
  generatedAtLabel: string;
};

export type SummaryLinks = {
  dashboardUrl?: string;
  supportUrl?: string;
  termsUrl?: string;
  unsubscribeUrl?: string;
};

// Summary emails own their restrained palette so shared transactional email themes
// and the transport's default social card cannot change the approved design.
const SITE_URL = "https://receipt-nest.com";
const LOGO_CID = "receiptnest-summary-logo";
const LOCK_CID = "receiptnest-summary-lock";
const logoBase64 = readFileSync(path.join(__dirname, "..", "assets", "email", "receipt-nest.png")).toString("base64");
const lockBase64 = readFileSync(path.join(__dirname, "..", "assets", "email", "summary-lock.png")).toString("base64");
const ink = "#17231f";
const muted = "#626e67";
const green = "#32594a";
const rule = "#e0e5e1";
const font = "Arial, Helvetica, sans-serif";

export const getSpendSummaryAttachments = () => [{
  content: logoBase64,
  filename: "receipt-nest.png",
  type: "image/png",
  disposition: "inline",
  contentId: LOGO_CID,
}, {
  content: lockBase64,
  filename: "summary-lock.png",
  type: "image/png",
  disposition: "inline",
  contentId: LOCK_CID,
}];

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
  }
};

const heading = (text: string) => `<h2 style="margin:0 0 18px; font-size:20px; line-height:1.35; letter-spacing:-0.4px; font-weight:700; color:${ink};">${escapeHtml(text)}</h2>`;
const paragraph = (text: string, style = "") => `<p style="margin:0; font-size:14px; line-height:1.6; ${style.includes("color:") ? "" : `color:${muted};`} ${style}">${escapeHtml(text)}</p>`;
const textLink = (label: string, url: string, color = muted) => `<a href="${escapeHtml(url)}" style="color:${color}; text-decoration:underline; text-underline-offset:2px;">${escapeHtml(label)}</a>`;
const section = (content: string, extraClass = "") => `<tr><td class="rn-section ${extraClass}" style="padding:26px 0; border-top:1px solid ${rule};">${content}</td></tr>`;

export const renderEmailBrand = (small = false) => {
  const width = small ? 36 : 52;
  const height = small ? 25 : 36;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle; padding-right:${small ? 9 : 12}px;">
      <a href="${SITE_URL}" aria-label="ReceiptNest home" style="text-decoration:none;"><img src="cid:${LOGO_CID}" width="${width}" height="${height}" alt="" style="display:block; width:${width}px; height:${height}px; border:0; background-color:#ffffff; border-radius:4px;" /></a>
    </td>
    <td style="vertical-align:middle;"><a href="${SITE_URL}" style="font-size:${small ? 18 : 24}px; line-height:1.3; font-weight:700; letter-spacing:-0.6px; color:${ink}; text-decoration:none;">ReceiptNest</a></td>
  </tr></table>`;
};

const renderMetric = (label: string, value: string, first: boolean) => `<td class="rn-metric" width="33.33%" style="width:33.33%; vertical-align:top; ${first ? "padding-right:12px;" : `padding:0 12px 0 24px; border-left:1px solid ${rule};`}">
  <p class="rn-metric-value" style="margin:0 0 6px; font-size:26px; line-height:1.2; font-weight:500; color:${ink}; overflow-wrap:anywhere;">${escapeHtml(value)}</p>
  ${paragraph(label, "font-size:13px;")}
</td>`;

const renderHighlight = (title: string, item: BreakdownItem | null, currency: string, category: boolean) => `
  ${paragraph(title, "font-size:13px; margin-bottom:4px;")}
  ${paragraph(item?.name ?? "No spending recorded", `font-size:17px; color:${ink}; overflow-wrap:anywhere;`)}
  ${item ? paragraph(`${money(item.total, currency)} · ${category && item.share >= 0 && item.share <= 1
    ? `${Math.round(item.share * 100)}% of total`
    : `${item.count} ${item.count === 1 ? "transaction" : "transactions"}`}`, "font-size:13px; margin-top:4px;") : ""}`;

const renderChart = (data: SpendSummaryData) => {
  const weekly = data.period.type === "week";
  const max = Math.max(0, ...data.activity.map(item => item.amount));
  const title = weekly ? "Daily spending" : "Spending by week";
  const rows = data.activity.map(item => {
    // No minimum-width floor: a small amount must not look larger than it is.
    const width = max > 0 ? Math.max(0, item.amount / max * 100) : 0;
    const weeklyLabel = `${item.label} ${item.sublabel.replace(/^\S+\s+/, "")}`;
    return `<tr>
      <th class="rn-chart-label" scope="row" width="${weekly ? 78 : 116}" style="padding:7px 12px 7px 0; width:${weekly ? 78 : 116}px; vertical-align:middle; text-align:left; font-weight:400; font-size:13px; line-height:1.5; color:${muted};">
        ${escapeHtml(weekly ? weeklyLabel : item.label)}${weekly ? "" : `<span class="rn-chart-range" style="display:block; font-size:11px; line-height:1.4;">${escapeHtml(item.sublabel)}</span>`}
      </th>
      <td aria-hidden="true" style="padding:7px 0; vertical-align:middle;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef1ee; border-radius:2px;"><tr>
          ${width > 0 ? `<td class="rn-bar" width="${width.toFixed(2)}%" height="12" style="height:12px; width:${width.toFixed(2)}%; background:${green}; border-radius:2px; font-size:0; line-height:0;">&nbsp;</td>` : ""}
          ${width < 100 ? `<td height="12" style="height:12px; font-size:0; line-height:0;">&nbsp;</td>` : ""}
        </tr></table>
      </td>
      <td class="rn-chart-amount" align="right" width="94" style="padding:7px 0 7px 12px; width:94px; vertical-align:middle; font-size:13px; line-height:1.5; color:${item.amount === 0 ? muted : ink}; overflow-wrap:anywhere;">${escapeHtml(money(item.amount, data.currency))}</td>
    </tr>`;
  }).join("");
  const peak = data.activity.find(item => item.amount === max);
  const share = data.metrics.totalSpend > 0 ? Math.round(max / data.metrics.totalSpend * 100) : 0;
  const hasRefunds = data.activity.some(item => item.amount < 0) || data.recentReceipts.some(item => item.amount < 0);
  // Avoid a misleading percentage when currencies have not been converted or
  // refunds can make a period's net spend smaller than its busiest day/week.
  const showInsight = peak && max > 0 && !data.mixedCurrencies && !hasRefunds && share > 0 && share <= 100;
  const weekdayNames: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
  const insight = showInsight
    ? `${weekly ? weekdayNames[peak.label] ?? peak.label : `${peak.label} (${peak.sublabel})`} accounted for ${share}% of this ${weekly ? "week’s" : "month’s"} spending.`
    : "";
  return `${heading(title)}
    <table aria-label="${title}" cellpadding="0" cellspacing="0" border="0" width="100%" style="table-layout:fixed;">${rows}</table>
    ${insight ? paragraph(insight, "font-size:12px; margin-top:14px;") : ""}
    ${hasRefunds ? paragraph("Refunds reduce the totals; bars show positive net spending.", "font-size:12px; margin-top:14px;") : ""}`;
};

const renderBreakdown = (title: string, items: BreakdownItem[], currency: string) => `${heading(title)}
  <table aria-label="${escapeHtml(title)}" cellpadding="0" cellspacing="0" border="0" width="100%">
    ${items.length ? items.map((item, index) => `<tr>
      <th scope="row" style="padding:9px 12px 9px 0; text-align:left; font-weight:400; font-size:13px; line-height:1.5; color:${ink}; overflow-wrap:anywhere; ${index ? `border-top:1px solid ${rule};` : ""}">${escapeHtml(item.name)}</th>
      <td align="right" style="padding:9px 0; font-size:13px; line-height:1.5; color:${ink}; white-space:nowrap; ${index ? `border-top:1px solid ${rule};` : ""}">${escapeHtml(money(item.total, currency))}</td>
    </tr>`).join("") : `<tr><td>${paragraph("No spending recorded in this period.")}</td></tr>`}
  </table>`;

const renderReceipts = (data: SpendSummaryData, dashboardUrl: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
    <td>${heading("Recent receipts")}</td>
    <td align="right" style="padding:0 0 18px 12px; font-size:13px; line-height:1.5;">${textLink("View receipts →", dashboardUrl, green)}</td>
  </tr></table>
  <table aria-label="Recent receipts" cellpadding="0" cellspacing="0" border="0" width="100%" style="table-layout:fixed;">
    ${data.recentReceipts.length ? data.recentReceipts.map((receipt, index) => `<tr>
      <th scope="row" style="padding:12px 16px 12px 0; vertical-align:top; text-align:left; font-weight:400; ${index ? `border-top:1px solid ${rule};` : ""}">
        ${paragraph(receipt.merchantName, `color:${ink}; font-size:14px; overflow-wrap:anywhere;`)}
        ${paragraph(`${receipt.dateLabel} · ${receipt.categoryName}`, "font-size:12px; margin-top:2px; overflow-wrap:anywhere;")}
      </th>
      <td align="right" width="104" style="padding:12px 0; width:104px; vertical-align:top; font-size:14px; line-height:1.6; color:${ink}; overflow-wrap:anywhere; ${index ? `border-top:1px solid ${rule};` : ""}">${escapeHtml(money(receipt.amount, data.currency))}</td>
    </tr>`).join("") : `<tr><td>${paragraph("No receipts were recorded for this period. Add a receipt to start your next summary.")}</td></tr>`}
  </table>`;

const renderFooter = (data: SpendSummaryData, links: Required<SummaryLinks>) => `
  ${renderEmailBrand(true)}
  ${paragraph("Your receipts. A clearer picture.", "font-size:12px; margin-top:8px;")}
  <p style="margin:4px 0 0; font-size:12px; line-height:1.8; color:${muted};">Get the app: ${textLink("App Store", APP_STORE_URL)} &nbsp;·&nbsp; ${textLink("Google Play", GOOGLE_PLAY_URL)}</p>
  <p id="receiptnest-social-footer" style="margin:4px 0 0; font-size:12px; line-height:1.8; color:${muted};">${EMAIL_SOCIAL_LINKS.map(link => `<a href="${escapeHtml(link.href)}" aria-label="ReceiptNest on ${escapeHtml(link.label)}" style="display:inline-block; color:${muted}; text-decoration:underline;">${escapeHtml(link.label)}</a>`).join(" &nbsp;·&nbsp; ")}</p>
  <p style="margin:4px 0 0; font-size:12px; line-height:1.8; color:${muted};">${textLink("Support", links.supportUrl)} &nbsp;·&nbsp; ${textLink("Terms", links.termsUrl)} &nbsp;·&nbsp; ${textLink("Unsubscribe", links.unsubscribeUrl)}</p>
  ${paragraph(`© ${new Date().getFullYear()} ReceiptNest`, "font-size:11px; margin-top:10px;")}
  ${paragraph(`Summary prepared ${data.generatedAtLabel}`, "font-size:11px;")}`;

export const buildSpendSummaryHtml = (data: SpendSummaryData, links: SummaryLinks = {}): string => {
  const weekly = data.period.type === "week";
  const resolvedLinks: Required<SummaryLinks> = {
    dashboardUrl: links.dashboardUrl || `${SITE_URL}/app`,
    supportUrl: links.supportUrl || `${SITE_URL}/support`,
    termsUrl: links.termsUrl || `${SITE_URL}/terms`,
    unsubscribeUrl: links.unsubscribeUrl || `${SITE_URL}/unsubscribe`,
  };
  const greetingName = data.userName.trim().split(/\s+/)[0] || "there";
  const total = money(data.metrics.totalSpend, data.currency);
  return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no" />
  <title>${escapeHtml(data.period.heroEyebrow)}</title>
  <style>
    body, table, td, th, p, h1, h2, a { font-family:${font}; }
    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    a { overflow-wrap:anywhere; }
    @media screen and (max-width:600px) {
      .rn-content { padding:24px 22px 32px !important; }
      .rn-title { font-size:30px !important; }
      .rn-total { font-size:52px !important; }
      .rn-metric { padding-left:14px !important; padding-right:8px !important; }
      .rn-metric:first-child { padding-left:0 !important; }
      .rn-metric-value { font-size:22px !important; }
      .rn-column { display:block !important; width:100% !important; padding-left:0 !important; padding-right:0 !important; border-left:0 !important; box-sizing:border-box !important; }
      .rn-column + .rn-column { padding-top:24px !important; }
      .rn-chart-label { width:64px !important; padding-right:8px !important; font-size:12px !important; }
      .rn-chart-amount { width:80px !important; padding-left:8px !important; font-size:12px !important; }
      .rn-chart-range { font-size:10px !important; }
      .rn-summary-label { font-size:11px !important; }
      .rn-section { padding-top:24px !important; padding-bottom:24px !important; }
    }
    @media screen and (max-width:360px) {
      .rn-content { padding-left:16px !important; padding-right:16px !important; }
      .rn-metric-value { font-size:19px !important; }
      .rn-summary-label { max-width:60px; }
    }
    @media (prefers-color-scheme:dark) {
      body, .rn-surface { background-color:#151e19 !important; color:#edf2ef !important; }
      p, h1, h2, th, td, a { color:#edf2ef !important; }
      p[style*="${muted}"], span, .rn-summary-label, .rn-chart-label { color:#b2beb6 !important; }
      td[style*="border"], th[style*="border"] { border-color:#354039 !important; }
      table[style*="background:#eef1ee"] { background:#2b3730 !important; }
      .rn-bar { background:#8aad99 !important; }
      .rn-button { background:#32594a !important; color:#ffffff !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; width:100%; background-color:#ffffff; color:${ink}; -webkit-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px;">${escapeHtml(`${data.period.heroEyebrow} · ${data.period.compactLabel} · ${data.metrics.receiptCount} receipts${data.mixedCurrencies ? " · Multiple currencies; totals are not converted" : ` · ${total}`}`)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="rn-surface" style="width:100%; background-color:#ffffff;"><tr><td align="center">
    <!--[if mso]><table role="presentation" width="740" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="rn-surface" style="width:100%; max-width:740px; background-color:#ffffff;"><tr><td class="rn-content" style="padding:28px 44px 40px; font-family:${font};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding-bottom:22px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
            <td>${renderEmailBrand()}</td>
            <td class="rn-summary-label" align="right" style="padding-left:12px; font-size:12px; line-height:1.5; color:${muted};">${weekly ? "Weekly" : "Monthly"} summary</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 0 30px; border-top:1px solid ${rule};">
          ${paragraph(data.period.compactLabel, "font-size:13px; margin-bottom:14px;")}
          <h1 class="rn-title" style="margin:0 0 8px; font-size:38px; line-height:1.18; letter-spacing:-1.2px; font-weight:700; color:${ink};">Your ${weekly ? "week" : "month"}, at a glance.</h1>
          ${paragraph(`Hi ${greetingName}, here’s your ${weekly ? "weekly" : "monthly"} spending summary.`, "font-size:16px;")}
          ${paragraph("Total spend", "font-size:13px; margin-top:28px;")}
          <p class="rn-total" style="margin:3px 0 28px; font-size:${total.length > 14 ? 44 : 64}px; line-height:1.1; letter-spacing:-2px; font-weight:400; color:${ink}; overflow-wrap:anywhere;">${escapeHtml(total)}</p>
          ${data.mixedCurrencies ? paragraph("Multiple currencies are included. Totals are combined without currency conversion.", "font-size:13px; margin:-12px 0 24px;") : ""}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="table-layout:fixed;"><tr>
            ${renderMetric("Receipts", String(data.metrics.receiptCount), true)}
            ${renderMetric("Average receipt", money(data.metrics.averageSpend, data.currency), false)}
            ${renderMetric("Active days", String(data.metrics.activeDays), false)}
          </tr></table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td class="rn-button" bgcolor="${green}" style="background:${green}; border-radius:6px; mso-padding-alt:14px 24px;">
            <a class="rn-button" href="${escapeHtml(resolvedLinks.dashboardUrl)}" style="display:inline-block; padding:14px 24px; border:1px solid ${green}; border-radius:6px; background:${green}; color:#ffffff; font-size:14px; line-height:20px; font-weight:600; text-decoration:none;">Open dashboard &nbsp;→</a>
          </td></tr></table>
        </td></tr>
        ${section(`${heading(`This ${weekly ? "week’s" : "month’s"} highlights`)}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="table-layout:fixed;"><tr>
            <td class="rn-column" width="50%" style="width:50%; padding-right:24px; vertical-align:top;">${renderHighlight("Top category", data.metrics.topCategory, data.currency, !data.mixedCurrencies)}</td>
            <td class="rn-column" width="50%" style="width:50%; padding-left:24px; border-left:1px solid ${rule}; vertical-align:top;">${renderHighlight("Top merchant", data.metrics.topMerchant, data.currency, false)}</td>
          </tr></table>`)}
        ${section(renderChart(data))}
        ${section(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="table-layout:fixed;"><tr>
          <td class="rn-column" width="50%" style="width:50%; padding-right:24px; vertical-align:top;">${renderBreakdown("By category", data.categories, data.currency)}</td>
          <td class="rn-column" width="50%" style="width:50%; padding-left:24px; border-left:1px solid ${rule}; vertical-align:top;">${renderBreakdown("Top merchants", data.merchants, data.currency)}</td>
        </tr></table>`)}
        ${section(renderReceipts(data, resolvedLinks.dashboardUrl))}
        ${data.tip ? section(`${heading("A small shortcut")}${paragraph(data.tip.body)}<p style="margin:10px 0 0; font-size:13px; line-height:1.6;">${textLink("See how →", data.tip.url, green)}</p>`) : ""}
        ${section(`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="24" style="width:24px; padding-right:12px; vertical-align:top;"><img src="cid:${LOCK_CID}" width="24" height="28" alt="" style="display:block; border:0; width:24px; height:28px;" /></td>
          <td>${paragraph("Your receipts, securely organized.", `color:${ink}; font-size:14px;`)}${paragraph("Protected with encryption in your ReceiptNest workspace.", "font-size:12px; margin-top:2px;")}</td>
        </tr></table>`)}
        ${section(renderFooter(data, resolvedLinks))}
      </table>
    </td></tr></table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`;
};
