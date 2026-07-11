export type StudioAccessSnapshot = {
  subscription_status?: string | null;
  subscription_current_period_end?: string | null;
  premium_access_until?: string | null;
  trial_ends_at?: string | null;
  is_active?: boolean | null;
};

export type SubscriptionAccessStatus =
  | "active"
  | "trialing"
  | "expired_trial"
  | "payment_required";

export type SubscriptionAccessResult = {
  premiumActive: boolean;
  locked: boolean;
  status: SubscriptionAccessStatus;
  message: string;
  redirectTo: "/admin/premium";
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active"]);
const TRIAL_STATUSES = new Set(["trialing", "trial", ""]);

function timeOf(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function isFutureDate(value?: string | null, now: Date = new Date()) {
  const time = timeOf(value);
  return time !== null && time > now.getTime();
}

export function getStudioSubscriptionAccess(
  studio: StudioAccessSnapshot | null | undefined,
  now: Date = new Date(),
): SubscriptionAccessResult {
  const redirectTo = "/admin/premium" as const;
  if (!studio || studio.is_active === false) {
    return {
      premiumActive: false,
      locked: true,
      status: "payment_required",
      message: "Escolha um plano para continuar a usar o painel.",
      redirectTo,
    };
  }

  const status = String(studio.subscription_status ?? "");
  const hasPremiumExtension = isFutureDate(studio.premium_access_until, now);
  const hasPaidPeriod = isFutureDate(studio.subscription_current_period_end, now);
  const activeSubscription =
    hasPremiumExtension ||
    (ACTIVE_SUBSCRIPTION_STATUSES.has(status) &&
      (hasPaidPeriod || (!studio.subscription_current_period_end && !studio.premium_access_until)));

  if (activeSubscription) {
    return {
      premiumActive: true,
      locked: false,
      status: "active",
      message: "Assinatura ativa.",
      redirectTo,
    };
  }

  const trialActive = isFutureDate(studio.trial_ends_at, now) && !activeSubscription;
  if (trialActive) {
    return {
      premiumActive: true,
      locked: false,
      status: "trialing",
      message: "Teste gratuito ativo.",
      redirectTo,
    };
  }

  const trialExpired = Boolean(studio.trial_ends_at && !isFutureDate(studio.trial_ends_at, now));
  return {
    premiumActive: false,
    locked: true,
    status: trialExpired ? "expired_trial" : "payment_required",
    message: trialExpired
      ? "O teste gratuito terminou. Escolha um plano para continuar a usar o painel."
      : "Escolha um plano para continuar a usar o painel.",
    redirectTo,
  };
}

export function normalizeTrialFingerprintValue(value?: string | null) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized || null;
}

export function normalizeTrialPhone(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}
