import { describe, expect, it, vi } from "vitest";

import {
  getOptimalTextColor,
  getTextColorSimple,
} from "../../renderer/utils/colorUtils";
import {
  validatePassword,
  getPasswordStrengthColor,
  getPasswordStrengthText,
} from "../../renderer/utils/passwordValidator";
import {
  addCustomChart,
  getAxisLabel,
  getDatasetLabel,
  renderCustomChartsSection,
  type CustomChart,
} from "../../renderer/utils/chartHelpers";

describe("renderer core utilities", () => {
  describe("colorUtils", () => {
    it("picks readable text colors for light and dark backgrounds", () => {
      expect(getOptimalTextColor("#ffffff")).toBe("#000000");
      expect(getOptimalTextColor("#000000")).toBe("#ffffff");
      expect(getTextColorSimple("#f0db4f")).toBe("#000000");
      expect(getTextColorSimple("#1b1b1b")).toBe("#ffffff");
    });
  });

  describe("passwordValidator", () => {
    it("reports missing requirements and strength for weak passwords", () => {
      const result = validatePassword("abc");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Password must be at least 8 characters long",
      );
      expect(result.errors).toContain(
        "Password must contain at least one uppercase letter",
      );
      expect(result.errors).toContain(
        "Password must contain at least one number",
      );
      expect(result.strength).toBe("weak");
    });

    it("marks a stronger password as valid and strong", () => {
      const result = validatePassword("StrongPass123");

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.strength).toBe("strong");
      expect(getPasswordStrengthColor(result.strength)).toBe("#51cf66");
      expect(getPasswordStrengthText(result.strength)).toBe("Strong");
    });
  });

  describe("chartHelpers", () => {
    it("returns labels for known chart groupings and aggregations", () => {
      expect(getAxisLabel("date")).toBe("Date");
      expect(getAxisLabel("language")).toBe("Programming Language");
      expect(getAxisLabel("hour-of-day")).toBe("Hour of Day");
      expect(getAxisLabel("unknown")).toBe("Category");

      expect(
        getDatasetLabel({
          title: "Demo",
          chartType: "bar",
          dataSource: "sessions",
          groupBy: "date",
          aggregation: "total-time",
        }),
      ).toBe("Total Time");
    });

    it("adds charts and renders the empty and populated states", () => {
      const charts: CustomChart[] = [];
      addCustomChart(
        charts,
        {
          title: "My Chart",
          chartType: "bar",
          dataSource: "daily-summary",
          groupBy: "date",
          aggregation: "session-count",
          dateRange: { start: "2025-01-01", end: "2025-01-31" },
        },
        [],
      );

      expect(charts).toHaveLength(1);
      expect(charts[0].config.title).toBe("My Chart");
      expect(charts[0].id).toMatch(/^chart-/);

      vi.stubGlobal("document", {
        createElement: () => ({
          textContent: "",
          get innerHTML() {
            return String(this.textContent)
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('"', "&quot;")
              .replaceAll("'", "&#39;");
          },
          set innerHTML(value: string) {
            this.textContent = value;
          },
        }),
      } as any);

      const emptyHtml = renderCustomChartsSection([]);
      expect(emptyHtml).toContain("No custom charts created yet");

      const populatedHtml = renderCustomChartsSection(charts);
      expect(populatedHtml).toContain("My Chart");
      expect(populatedHtml).toContain("Date vs Number of Sessions");
      expect(populatedHtml).toContain("Add Chart");
      expect(populatedHtml).toContain("Clear All Charts");
    });
  });
});
