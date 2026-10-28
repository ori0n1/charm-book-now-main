export type CheckoutPaymentMethod = "card" | "mb_way";

const STRIPE_EUR_MINIMUM_CENTS = 50;

export function calculateDepositCents(totalCents: number, depositPercent: number) {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error("invalid_total_cents");
  }
  if (!Number.isFinite(depositPercent) || depositPercent < 0 || depositPercent > 100) {
    throw new Error("invalid_deposit_percent");
  }
  if (depositPercent >= 100) return totalCents;
  return Math.round((totalCents * depositPercent) / 100);
}

export function minimumStripeCheckoutAmountCents(
  currency: string,
  _method: CheckoutPaymentMethod,
) {
  // Bellza checkout is denominated in EUR. Keep the previous 50-minor-unit
  // guard as a fail-closed fallback if an unexpected currency reaches here.
  return currency.toLowerCase() === "eur" ? STRIPE_EUR_MINIMUM_CENTS : 50;
}
