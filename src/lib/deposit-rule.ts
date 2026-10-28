export type DepositRule =
  | { mode: "percent"; percent: number }
  | { mode: "fixed"; fixed_cents: number };

type StudioDepositSettings = {
  deposit_percent?: number | null;
  studio_policy_settings?: Record<string, unknown> | null;
};

export function readDepositRule(studio: StudioDepositSettings): DepositRule {
  const settings = studio.studio_policy_settings ?? {};
  if (settings.deposit_mode != null && settings.deposit_mode !== "percent" && settings.deposit_mode !== "fixed") {
    throw new Error("A modalidade do sinal configurada é inválida.");
  }
  if (settings.deposit_mode === "fixed") {
    const fixed = Number(settings.deposit_fixed_cents);
    if (!Number.isSafeInteger(fixed) || fixed < 50 || fixed > 999_999_999) {
      throw new Error("O sinal fixo configurado é inválido.");
    }
    return { mode: "fixed", fixed_cents: fixed };
  }
  const raw = Number(studio.deposit_percent ?? 25);
  if (!Number.isFinite(raw)) throw new Error("O sinal percentual configurado é inválido.");
  return { mode: "percent", percent: Math.max(10, Math.min(100, raw)) };
}

export function readDepositSnapshot(snapshot: unknown, studio: StudioDepositSettings): DepositRule {
  if (snapshot && typeof snapshot === "object") {
    const value = snapshot as Record<string, unknown>;
    if (value.mode === "fixed") {
      const fixed = Number(value.fixed_cents);
      if (!Number.isSafeInteger(fixed) || fixed < 50 || fixed > 999_999_999) throw new Error("O sinal da reserva é inválido.");
      return { mode: "fixed", fixed_cents: fixed };
    }
    if (value.mode === "percent") {
      const percent = Number(value.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error("O sinal da reserva é inválido.");
      }
      return { mode: "percent", percent };
    }
    throw new Error("O sinal da reserva é inválido.");
  }
  // Bookings created before the snapshot migration retain the historic percent.
  return readDepositRule({ deposit_percent: studio.deposit_percent });
}

export function calculateDepositCharge(totalCents: number, rule: DepositRule) {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new Error("O valor total da reserva é inválido.");
  }
  const requested = rule.mode === "fixed"
    ? rule.fixed_cents
    : rule.percent >= 100 ? totalCents : Math.round(totalCents * rule.percent / 100);
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    throw new Error("O sinal calculado é inválido.");
  }
  const amountCents = Math.min(totalCents, requested);
  return { amountCents, remainingCents: totalCents - amountCents, isFullPayment: amountCents === totalCents };
}
