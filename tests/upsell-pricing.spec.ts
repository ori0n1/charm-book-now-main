import { expect, test } from "@playwright/test";
import {
  calculateUpsellLine,
  calculateUpsellPricing,
  formatUpsellMoney,
} from "../src/lib/upsell-pricing";

test.describe("upsell pricing", () => {
  test("calculates one service with a percent discount", () => {
    const summary = calculateUpsellPricing([
      { originalPrice: 50, price: 45, discountType: "percent", discountValue: 10 },
    ]);

    expect(summary.originalTotal).toBe(50);
    expect(summary.savingsTotal).toBe(5);
    expect(summary.savingsPercent).toBe(10);
    expect(summary.finalTotal).toBe(45);
  });

  test("calculates multiple services with different discounts", () => {
    const summary = calculateUpsellPricing([
      { originalPrice: 100, price: 90, discountType: "percent", discountValue: 10 },
      { originalPrice: 40, price: 34, discountType: "percent", discountValue: 15 },
      { originalPrice: 25, price: 20, discountType: "fixed", discountValue: 5 },
    ]);

    expect(summary.originalTotal).toBe(165);
    expect(summary.savingsTotal).toBe(21);
    expect(summary.savingsPercent).toBeCloseTo(12.7272727, 6);
    expect(summary.finalTotal).toBe(144);
  });

  test("keeps services without discount unchanged", () => {
    const line = calculateUpsellLine({
      originalPrice: 35,
      price: 35,
      discountType: "price",
      discountValue: null,
    });

    expect(line.originalPrice).toBe(35);
    expect(line.savings).toBe(0);
    expect(line.savingsPercent).toBe(0);
    expect(line.finalPrice).toBe(35);
  });

  test("recalculates immediately when services are added and removed", () => {
    const services = [
      { id: "a", originalPrice: 40, price: 36, discountType: "percent", discountValue: 10 },
      { id: "b", originalPrice: 60, price: 48, discountType: "percent", discountValue: 20 },
      { id: "c", originalPrice: 30, price: 30, discountType: "price", discountValue: null },
    ];

    expect(calculateUpsellPricing([services[0]]).finalTotal).toBe(36);
    expect(calculateUpsellPricing([services[0], services[1]]).savingsTotal).toBe(16);
    expect(calculateUpsellPricing([services[1], services[2]]).originalTotal).toBe(90);
    expect(calculateUpsellPricing([services[1], services[2]]).finalTotal).toBe(78);
  });

  test("supports 10, 15 and 20 percent discounts without rounding during calculation", () => {
    const summary = calculateUpsellPricing([
      { originalPrice: 33.33, price: 29.997, discountType: "percent", discountValue: 10 },
      { originalPrice: 19.99, price: 16.9915, discountType: "percent", discountValue: 15 },
      { originalPrice: 12.5, price: 10, discountType: "percent", discountValue: 20 },
    ]);

    expect(summary.originalTotal).toBeCloseTo(65.82, 8);
    expect(summary.savingsTotal).toBeCloseTo(8.8315, 8);
    expect(summary.finalTotal).toBeCloseTo(56.9885, 8);
    expect(summary.savingsPercent).toBeCloseTo(13.417654, 6);
  });

  test("uses discounted price for direct price offers and clamps accumulated discounts", () => {
    const summary = calculateUpsellPricing([
      { originalPrice: 27.5, price: 21.25, discountType: "price", discountValue: null },
      { originalPrice: 10, price: 10, discountType: "fixed", discountValue: 15 },
    ]);

    expect(summary.originalTotal).toBe(37.5);
    expect(summary.savingsTotal).toBe(16.25);
    expect(summary.finalTotal).toBe(21.25);
    expect(summary.savingsPercent).toBeCloseTo(43.333333, 6);
  });

  test("calculates and formats decimal percent discounts exactly", () => {
    const examples = [
      { originalPrice: 18, discountValue: 20, savings: 3.6, finalPrice: 14.4 },
      { originalPrice: 25, discountValue: 15, savings: 3.75, finalPrice: 21.25 },
      { originalPrice: 19.9, discountValue: 10, savings: 1.99, finalPrice: 17.91 },
    ];

    for (const example of examples) {
      const line = calculateUpsellLine({
        originalPrice: example.originalPrice,
        price: 0,
        discountType: "percent",
        discountValue: example.discountValue,
      });

      expect(line.savings).toBeCloseTo(example.savings, 8);
      expect(line.finalPrice).toBeCloseTo(example.finalPrice, 8);
      expect(formatUpsellMoney(line.originalPrice)).toMatch(/^\d+,\d{2}€$/);
      expect(formatUpsellMoney(line.savings)).toBe(formatUpsellMoney(example.savings));
      expect(formatUpsellMoney(line.finalPrice)).toBe(formatUpsellMoney(example.finalPrice));
    }
  });

  test("formats the requested decimal examples with two cents", () => {
    expect(formatUpsellMoney(3.6)).toBe("3,60€");
    expect(formatUpsellMoney(14.4)).toBe("14,40€");
    expect(formatUpsellMoney(18)).toBe("18,00€");
    expect(formatUpsellMoney(3.75)).toBe("3,75€");
    expect(formatUpsellMoney(1.99)).toBe("1,99€");
  });

  test("recomputes decimal totals for multiple extras after removing one", () => {
    const extras = [
      { id: "a", originalPrice: 18, price: 0, discountType: "percent", discountValue: 20 },
      { id: "b", originalPrice: 25, price: 0, discountType: "percent", discountValue: 15 },
      { id: "c", originalPrice: 19.9, price: 0, discountType: "percent", discountValue: 10 },
    ];

    const allSelected = calculateUpsellPricing(extras);
    expect(allSelected.originalTotal).toBeCloseTo(62.9, 8);
    expect(allSelected.savingsTotal).toBeCloseTo(9.34, 8);
    expect(allSelected.finalTotal).toBeCloseTo(53.56, 8);
    expect(formatUpsellMoney(allSelected.savingsTotal)).toBe("9,34€");
    expect(formatUpsellMoney(allSelected.finalTotal)).toBe("53,56€");

    const afterRemoval = calculateUpsellPricing([extras[0], extras[2]]);
    expect(afterRemoval.originalTotal).toBeCloseTo(37.9, 8);
    expect(afterRemoval.savingsTotal).toBeCloseTo(5.59, 8);
    expect(afterRemoval.finalTotal).toBeCloseTo(32.31, 8);
    expect(formatUpsellMoney(afterRemoval.savingsTotal)).toBe("5,59€");
    expect(formatUpsellMoney(afterRemoval.finalTotal)).toBe("32,31€");
  });
});
