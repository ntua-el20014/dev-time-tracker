import { describe, it, expect } from "vitest";
import {
  formatMoney,
  formatRate,
  formatTotals,
  isCurrencyCode,
  normalizeCurrency,
  roundMoney,
  totalsByCurrency,
} from "../shared/currency";

describe("currency codes", () => {
  it("accepts three-letter codes only", () => {
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("eur")).toBe(false);
    expect(isCurrencyCode("EURO")).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
  });

  it("normalizes to an upper-case code, else USD", () => {
    expect(normalizeCurrency(" gbp ")).toBe("GBP");
    expect(normalizeCurrency("")).toBe("USD");
    expect(normalizeCurrency(undefined)).toBe("USD");
    expect(normalizeCurrency("<script>")).toBe("USD");
  });
});

describe("formatMoney", () => {
  it("uses the currency's symbol and minor unit", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "EUR")).toBe("€1,234.50");
    expect(formatMoney(1234.5, "JPY")).toBe("¥1,235");
    expect(formatRate(75, "GBP")).toBe("£75.00/h");
  });

  it("falls back to the code in PDFs when the symbol can't be drawn", () => {
    expect(formatMoney(10, "INR", { pdf: true })).toBe("INR 10.00");
    expect(formatMoney(10, "EUR", { pdf: true })).toBe("€10.00");
  });

  it("rounds to the minor unit", () => {
    expect(roundMoney(10.005, "EUR")).toBe(10.01);
    expect(roundMoney(10.6, "JPY")).toBe(11);
  });
});

describe("totals per currency", () => {
  it("sums per currency, largest first, and never mixes them", () => {
    const totals = totalsByCurrency([
      { currency: "EUR", amount: 100 },
      { currency: "USD", amount: 300 },
      { currency: "EUR", amount: 50.5 },
      { currency: "GBP", amount: 0 },
    ]);
    expect(totals).toEqual([
      { currency: "USD", amount: 300 },
      { currency: "EUR", amount: 150.5 },
    ]);
    expect(formatTotals(totals)).toBe("$300.00 + €150.50");
  });

  it("shows zero in the fallback currency when there is nothing", () => {
    expect(formatTotals([])).toBe("$0.00");
    expect(formatTotals([], "EUR")).toBe("€0.00");
  });
});
