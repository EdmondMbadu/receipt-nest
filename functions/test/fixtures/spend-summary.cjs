const receiptRows = [
  ['2026-10-16', 'Google Voice', 'Other', 10],
  ['2026-10-16', 'Zoom Communications, Inc.', 'Subscriptions', 16.99],
  ['2026-10-15', 'Spectrum', 'Utilities & Bills', 140.26],
  ['2026-10-15', 'Bill Charge Payment', 'Other', 66],
  ['2026-10-15', 'City of North', 'Utilities & Bills', 108.53],
  ['2026-10-15', 'SOUTHWEST GAS', 'Utilities & Bills', 28.27],
  ['2026-10-15', 'NVEnergy', 'Utilities & Bills', 197.39],
  ['2026-10-15', 'Water service', 'Utilities & Bills', 59.19],
  ['2026-10-14', 'Subscription', 'Subscriptions', 20],
  ['2026-10-13', 'OpenAI · ChatGPT', 'Utilities', 100],
  ['2026-10-12', 'Education', 'Education', 31],
];

const normalizedReceipts = receiptRows.map(([dateKey, merchantName, categoryName, amount], i) => ({
  amount, currency: 'USD', merchantName, categoryName, dateKey,
  dateLabel: `Oct ${Number(dateKey.slice(-2))}, 2026`,
  createdAt: new Date(`${dateKey}T${String(20 - i % 6).padStart(2, '0')}:00:00Z`),
}));
const rawReceipts = normalizedReceipts.map(receipt => ({
  totalAmount: receipt.amount, date: `${receipt.dateKey}T12:00:00Z`, currency: receipt.currency,
  merchant: {canonicalName: receipt.merchantName}, category: {name: receipt.categoryName},
  createdAt: receipt.createdAt,
}));

function fixture(periodType = 'week') {
  const categories = [
    ['Utilities & Bills', 533.64, 5], ['Utilities', 100, 1], ['Other', 76, 2],
    ['Subscriptions', 36.99, 2], ['Education', 31, 1],
  ].map(([name, total, count]) => ({name, total, count, share: total / 777.63}));
  const merchants = [
    ['NVEnergy', 197.39], ['Spectrum', 140.26], ['City of North', 108.53],
    ['OpenAI · ChatGPT', 100], ['Bill Charge Payment', 66],
  ].map(([name, total]) => ({name, total, count: 1, share: total / 777.63}));
  const weekly = periodType === 'week';
  return {
    period: {
      type: periodType, label: weekly ? 'Week of October 12, 2026' : 'October 2026',
      compactLabel: weekly ? 'October 12–18, 2026' : 'October 2026',
      heroEyebrow: weekly ? 'Weekly spend summary' : 'Monthly spend summary',
      rangeLabel: weekly ? 'Oct 12, 2026 - October 18, 2026' : 'Oct 1, 2026 - October 31, 2026',
      startKey: weekly ? '2026-10-12' : '2026-10-01', endKey: weekly ? '2026-10-18' : '2026-10-31',
    },
    userName: 'Edmond Mbadu', userEmail: 'preview@example.com', currency: 'USD', mixedCurrencies: false,
    generatedAtLabel: 'Oct 19, 2026, 8:00 AM',
    metrics: {totalSpend: 777.63, receiptCount: 11, averageSpend: 777.63 / 11, activeDays: 5,
      topCategory: categories[0], topMerchant: merchants[0], largestReceipt: normalizedReceipts[6]},
    categories, merchants, recentReceipts: normalizedReceipts.slice(0, 6),
    activity: weekly ? [
      ['Mon', 'Oct 12', 31, 1], ['Tue', 'Oct 13', 100, 1], ['Wed', 'Oct 14', 20, 1],
      ['Thu', 'Oct 15', 599.64, 6], ['Fri', 'Oct 16', 26.99, 2], ['Sat', 'Oct 17', 0, 0], ['Sun', 'Oct 18', 0, 0],
    ].map(([label, sublabel, amount, receiptCount]) => ({label, sublabel, amount, receiptCount})) : [
      ['Week 1', 'Oct 1–7', 0, 0], ['Week 2', 'Oct 8–14', 151, 3],
      ['Week 3', 'Oct 15–21', 626.63, 8], ['Week 4', 'Oct 22–28', 0, 0], ['Week 5', 'Oct 29–31', 0, 0],
    ].map(([label, sublabel, amount, receiptCount]) => ({label, sublabel, amount, receiptCount})),
  };
}
function emptyFixture(periodType = 'week') {
  const data = fixture(periodType);
  data.categories = []; data.merchants = []; data.recentReceipts = [];
  data.metrics = {totalSpend: 0, receiptCount: 0, averageSpend: 0, activeDays: 0, topCategory: null, topMerchant: null, largestReceipt: null};
  data.activity = data.activity.map(item => ({...item, amount: 0, receiptCount: 0}));
  return data;
}
module.exports = {fixture, emptyFixture, rawReceipts};
