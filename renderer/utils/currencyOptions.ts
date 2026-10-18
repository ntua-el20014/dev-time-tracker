import { CURRENCIES, normalizeCurrency } from "../../shared/currency";
import { escapeHtml } from "./domUtils";

/**
 * <option>s for a currency <select>, with `selected` chosen. A code that
 * isn't in the list (set elsewhere) is added so it isn't lost on save.
 */
export function currencyOptionsHtml(selected: string | null | undefined): string {
  const code = normalizeCurrency(selected);
  const list = CURRENCIES.some((c) => c.code === code)
    ? CURRENCIES
    : [{ code, name: code }, ...CURRENCIES];
  return list
    .map(
      (c) =>
        `<option value="${escapeHtml(c.code)}"${c.code === code ? " selected" : ""}>${escapeHtml(
          `${c.code} — ${c.name}`,
        )}</option>`,
    )
    .join("");
}
