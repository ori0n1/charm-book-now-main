export type UpsellPricingInput = {
  originalPrice: number;
  price: number;
  discountType?: "price" | "percent" | "fixed" | string | null;
  discountValue?: number | null;
};

export type UpsellPricingLine<T extends UpsellPricingInput = UpsellPricingInput> = {
  item: T;
  originalPrice: number;
  finalPrice: number;
  savings: number;
  savingsPercent: number;
};

export type UpsellPricingSummary<T extends UpsellPricingInput = UpsellPricingInput> = {
  lines: UpsellPricingLine<T>[];
  originalTotal: number;
  finalTotal: number;
  savingsTotal: number;
  savingsPercent: number;
};

export function calculateUpsellLine<T extends UpsellPricingInput>(
  item: T,
): UpsellPricingLine<T> {
  const originalPrice = positiveNumber(item.originalPrice);
  const fallbackFinalPrice = positiveNumber(item.price);
  const discountValue = positiveNumber(item.discountValue ?? 0);
  const discountType = item.discountType ?? "price";

  let finalPrice = fallbackFinalPrice;

  if (discountType === "percent") {
    const percent = clamp(discountValue, 0, 100);
    finalPrice = originalPrice - originalPrice * (percent / 100);
  } else if (discountType === "fixed") {
    finalPrice = originalPrice - discountValue;
  }

  finalPrice = clamp(finalPrice, 0, originalPrice);
  const savings = Math.max(0, originalPrice - finalPrice);
  const savingsPercent = originalPrice > 0 ? (savings / originalPrice) * 100 : 0;

  return {
    item,
    originalPrice,
    finalPrice,
    savings,
    savingsPercent,
  };
}

export function calculateUpsellPricing<T extends UpsellPricingInput>(
  items: T[],
): UpsellPricingSummary<T> {
  const lines = items.map(calculateUpsellLine);
  const originalTotal = lines.reduce((sum, line) => sum + line.originalPrice, 0);
  const finalTotal = lines.reduce((sum, line) => sum + line.finalPrice, 0);
  const savingsTotal = lines.reduce((sum, line) => sum + line.savings, 0);
  const savingsPercent = originalTotal > 0 ? (savingsTotal / originalTotal) * 100 : 0;

  return {
    lines,
    originalTotal,
    finalTotal,
    savingsTotal,
    savingsPercent,
  };
}

export function formatUpsellMoney(value: number) {
  return `${Number(value).toLocaleString("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}\u20ac`;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
