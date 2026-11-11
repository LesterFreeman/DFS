import type { Category } from './types';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'housing', name: 'Housing', icon: '🏠', group: 'essential' },
  { id: 'utilities', name: 'Bills & utilities', icon: '💡', group: 'essential' },
  { id: 'groceries', name: 'Groceries', icon: '🛒', group: 'essential' },
  { id: 'transport', name: 'Transportation', icon: '🚗', group: 'essential' },
  { id: 'health', name: 'Health', icon: '🩺', group: 'essential' },
  { id: 'insurance', name: 'Insurance', icon: '🛡️', group: 'essential' },
  { id: 'dining', name: 'Restaurants & bars', icon: '🍽️', group: 'lifestyle' },
  { id: 'shopping', name: 'Shopping', icon: '🛍️', group: 'lifestyle' },
  { id: 'entertainment', name: 'Entertainment', icon: '🎟️', group: 'lifestyle' },
  { id: 'subscriptions', name: 'Subscriptions', icon: '📺', group: 'lifestyle' },
  { id: 'travel', name: 'Travel', icon: '✈️', group: 'lifestyle' },
  { id: 'personal', name: 'Personal care', icon: '💇', group: 'lifestyle' },
  { id: 'gifts', name: 'Gifts & donations', icon: '🎁', group: 'lifestyle' },
  { id: 'fees', name: 'Fees & interest', icon: '🏦', group: 'lifestyle' },
  { id: 'other', name: 'Everything else', icon: '📦', group: 'lifestyle' },
  { id: 'paycheck', name: 'Paycheck', icon: '💼', group: 'income' },
  { id: 'other_income', name: 'Other income', icon: '💵', group: 'income' },
  { id: 'transfer', name: 'Transfers & payments', icon: '🔁', group: 'transfer' },
];

/** Keyword guesses for imported transactions. First match wins. */
const KEYWORDS: [RegExp, string][] = [
  [/payroll|direct dep|salary|paycheck/, 'paycheck'],
  [/interest paid|dividend|refund|cashback|cash back|venmo cashout/, 'other_income'],
  [/payment thank|autopay|card payment|transfer|zelle|online pmt|epayment|withdrawal to|deposit from/, 'transfer'],
  [/\brent\b|mortgage|\bhoa\b|property tax|apartments?/, 'housing'],
  [/electric|water|gas co|energy|utility|comcast|xfinity|verizon|at&t|t-mobile|internet|spectrum|pg&e|con ?ed/, 'utilities'],
  [/whole foods|trader joe|safeway|kroger|aldi|costco|grocery|market|publix|wegmans|h-e-b|sprouts|instacart/, 'groceries'],
  [/uber(?! eats)|lyft|shell|chevron|exxon|bp |gas station|parking|transit|metro|toll|auto|car wash|dmv/, 'transport'],
  [/pharmacy|cvs|walgreens|doctor|dental|medical|hospital|clinic|optical|therapy/, 'health'],
  [/insurance|geico|state farm|progressive|allstate/, 'insurance'],
  [/netflix|spotify|hulu|disney\+|apple\.com\/bill|icloud|youtube premium|hbo|max\.com|patreon|subscription|nyt|adobe|dropbox|gym|fitness|peloton/, 'subscriptions'],
  [/restaurant|cafe|coffee|starbucks|doordash|uber eats|grubhub|pizza|taco|burger|sushi|bar |brew|bakery|chipotle|mcdonald|dunkin|kitchen|grill|diner/, 'dining'],
  [/airline|airbnb|hotel|delta|united|southwest|expedia|booking\.com|marriott|hilton|rental car|hertz/, 'travel'],
  [/cinema|movie|theater|theatre|ticketmaster|concert|steam|playstation|nintendo|xbox|museum/, 'entertainment'],
  [/salon|barber|spa|sephora|ulta/, 'personal'],
  [/donation|charity|gofundme|gift/, 'gifts'],
  [/fee|interest charge|finance charge|overdraft|atm/, 'fees'],
  [/amazon|target|walmart|best buy|ikea|etsy|ebay|nike|apple store|home depot|lowe'?s|shop/, 'shopping'],
];

export function guessCategory(merchant: string, amount: number, rules: Record<string, string> = {}): string {
  const key = merchant.trim().toLowerCase();
  if (rules[key]) return rules[key];
  for (const [re, id] of KEYWORDS) {
    if (re.test(key)) {
      // Keywords for income only apply to money coming in, and the other way round.
      if ((id === 'paycheck' || id === 'other_income') && amount < 0) continue;
      return id;
    }
  }
  return amount > 0 ? 'other_income' : 'other';
}
