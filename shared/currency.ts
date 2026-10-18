/**
 * Currencies of hourly rates, earnings and invoices. Every project has one
 * (cloud_projects.currency, filled from the creator's default in
 * user_preferences.currency). Amounts in different currencies are never
 * added together: totals are kept per currency. AI agent costs are reported
 * in USD and stay USD.
 */

export const DEFAULT_CURRENCY = "USD";

/** Offered in the pickers; any ISO 4217 code is accepted. */
export const CURRENCIES: { code: string; name: string }[] = [
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "CHF", name: "Swiss franc" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "NZD", name: "New Zealand dollar" },
  { code: "JPY", name: "Japanese yen" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "HKD", name: "Hong Kong dollar" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "INR", name: "Indian rupee" },
  { code: "KRW", name: "South Korean won" },
  { code: "SEK", name: "Swedish krona" },
  { code: "NOK", name: "Norwegian krone" },
  { code: "DKK", name: "Danish krone" },
  { code: "PLN", name: "Polish złoty" },
  { code: "CZK", name: "Czech koruna" },
  { code: "HUF", name: "Hungarian forint" },
  { code: "RON", name: "Romanian leu" },
  { code: "BGN", name: "Bulgarian lev" },
  { code: "TRY", name: "Turkish lira" },
  { code: "ILS", name: "Israeli shekel" },
  { code: "AED", name: "UAE dirham" },
  { code: "ZAR", name: "South African rand" },
  { code: "BRL", name: "Brazilian real" },
  { code: "MXN", name: "Mexican peso" },
];

const CODE = /^[A-Z]{3}$/;

/** True for a three-letter code Intl knows. */
export function isCurrencyCode(value: unknown): value is string {
  if (typeof value !== "string" || !CODE.test(value)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: value });
    return true;
  } catch {
    return false;
  }
}

/** A valid code (upper-cased), else USD. */
export function normalizeCurrency(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return isCurrencyCode(code) ? code : DEFAULT_CURRENCY;
}

/** Rounds to the currency's minor unit (cents; whole yen). */
export function roundMoney(amount: number, currency: string): number {
  const digits = fractionDigits(currency);
  const f = 10 ** digits;
  return Math.round(amount * f) / f;
}

function fractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: normalizeCurrency(currency),
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Characters jsPDF's built-in fonts can draw (Latin-1 plus € and a few). */
const PDF_SAFE = /^[\u0020-\u007e\u00a0-\u00ff\u20ac\u2009\u202f]*$/;

/**
 * "$1,234.50", "€1,234.50", "CHF 1,234.50", "¥1,235". With `pdf`, symbols
 * the PDF fonts can't draw (₹, ₩, ₪, …) become the code: "INR 1,234.50".
 */
export function formatMoney(
  amount: number,
  currency: string,
  { pdf = false }: { pdf?: boolean } = {},
): string {
  const code = normalizeCurrency(currency);
  const value = Number.isFinite(amount) ? amount : 0;
  const text = new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(value);
  if (!pdf || PDF_SAFE.test(text)) return text;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    currencyDisplay: "code",
  })
    .format(value)
    .replace(/\u00a0/g, " ");
}

/** "$75.00/h" */
export function formatRate(rate: number, currency: string): string {
  return `${formatMoney(rate, currency)}/h`;
}

export interface MoneyAmount {
  currency: string;
  amount: number;
}

/** Sums per currency (rounded), largest first; zero totals are dropped. */
export function totalsByCurrency(items: MoneyAmount[]): MoneyAmount[] {
  const by = new Map<string, number>();
  for (const { currency, amount } of items) {
    const code = normalizeCurrency(currency);
    by.set(code, (by.get(code) ?? 0) + (Number.isFinite(amount) ? amount : 0));
  }
  return [...by]
    .map(([currency, amount]) => ({ currency, amount: roundMoney(amount, currency) }))
    .filter((t) => t.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

/** "€1,200.00 + $300.00", or "$0.00" in `fallback` when there is nothing. */
export function formatTotals(totals: MoneyAmount[], fallback = DEFAULT_CURRENCY): string {
  if (totals.length === 0) return formatMoney(0, fallback);
  return totals.map((t) => formatMoney(t.amount, t.currency)).join(" + ");
}
