export type AccountType =
  | 'cash'
  | 'investment'
  | 'retirement'
  | 'property'
  | 'other_asset'
  | 'credit'
  | 'loan'
  | 'mortgage';

export type AssetClass = 'us_stocks' | 'intl_stocks' | 'bonds' | 'cash' | 'real_estate' | 'other';

/** Percentages by asset class; they add up to 100. */
export type AssetMix = Partial<Record<AssetClass, number>>;

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution?: string;
  /** Always positive. For liabilities it is the amount owed. */
  balance: number;
  /** Interest rate in percent: what a debt costs, or what a cash account pays. */
  rate?: number;
  /** For investment and retirement accounts. */
  mix?: AssetMix;
  /** ISO date of the last balance update. */
  updatedAt: string;
}

/** Balances on one day. Net worth history is the list of these. */
export interface Snapshot {
  date: string;
  assets: number;
  liabilities: number;
  balances: Record<string, number>;
}

export type CategoryGroup = 'essential' | 'lifestyle' | 'income' | 'transfer';

export interface Category {
  id: string;
  name: string;
  icon: string;
  group: CategoryGroup;
  /** Monthly budget, if one is set. */
  budget?: number;
}

export interface Transaction {
  id: string;
  date: string;
  /** Negative is money out, positive is money in. */
  amount: number;
  merchant: string;
  categoryId: string;
  accountId?: string;
  note?: string;
}

export interface Goal {
  id: string;
  name: string;
  icon: string;
  kind: 'save' | 'payoff';
  /** Amount to reach for a savings goal. A payoff goal aims for zero owed. */
  target: number;
  targetDate?: string;
  /** Accounts whose balances count toward the goal. */
  accountIds: string[];
  /** Total of the linked balances when the goal was created (payoff goals measure from here). */
  startAmount: number;
  createdAt: string;
}

export interface Plan {
  /** Amount invested each month, in today's money. */
  monthlyInvest: number;
  /** Expected yearly return before inflation, percent. */
  returnPct: number;
  /** Yearly swing of returns (standard deviation), percent. */
  volatilityPct: number;
  inflationPct: number;
  /** How much the monthly amount grows each year above inflation, percent. */
  raisePct: number;
  retireAge: number;
  /** Monthly spending in retirement, in today's money. */
  retireSpend: number;
  /** Other monthly income in retirement (pension, Social Security), today's money. */
  retireIncome: number;
  includeHome: boolean;
}

export interface Profile {
  name: string;
  age: number;
  currency: string;
  /** Minutes in the background before the app locks itself. */
  autoLockMin: number;
}

export interface AppData {
  version: 1;
  profile: Profile;
  accounts: Account[];
  snapshots: Snapshot[];
  categories: Category[];
  transactions: Transaction[];
  goals: Goal[];
  plan: Plan;
  /** Merchant name (lower case) to category, learned when you recategorize. */
  merchantRules: Record<string, string>;
  /** Recommendation ids you dismissed, with the month you dismissed them in. */
  dismissed: Record<string, string>;
}

export const LIABILITY_TYPES: AccountType[] = ['credit', 'loan', 'mortgage'];
export const isLiability = (t: AccountType) => LIABILITY_TYPES.includes(t);

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: 'Cash',
  investment: 'Investments',
  retirement: 'Retirement',
  property: 'Property',
  other_asset: 'Other assets',
  credit: 'Credit cards',
  loan: 'Loans',
  mortgage: 'Mortgage',
};

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  us_stocks: 'US stocks',
  intl_stocks: 'International stocks',
  bonds: 'Bonds',
  cash: 'Cash',
  real_estate: 'Real estate',
  other: 'Other',
};
export const ASSET_CLASSES = Object.keys(ASSET_CLASS_LABEL) as AssetClass[];
