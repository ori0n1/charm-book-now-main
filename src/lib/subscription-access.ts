import {
  resolveEffectivePlanTier,
  type PlanAccessSnapshot,
  type PlanTier,
} from "@/lib/plan-entitlements";

export type StudioAccessSnapshot = {
  plan_tier?: string | null;
  subscription_plan_tier?: string | null;
  subscription_status?: string | null;
  subscription_current_period_end?: string | null;
  premium_access_until?: string | null;
  referral_premium_until?: string | null;
  trial_ends_at?: string | null;
  is_active?: boolean | null;
};

export type SubscriptionAccessStatus =
  | "active"
  | "trialing"
  | "expired_trial"
  | "payment_required";

export type SubscriptionAccessResult = {
  effectivePlan: PlanTier;
  subscriptionActive: boolean;
  trialActive: boolean;
  premiumActive: boolean;
  locked: boolean;
  status: SubscriptionAccessStatus;
  message: string;
  redirectTo: "/admin/premium";
};

const PERIOD_ACCESS_STATUSES = new Set(["active", "trialing", "canceled"]);

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
      effectivePlan: "free",
      subscriptionActive: false,
      trialActive: false,
      premiumActive: false,
      locked: true,
      status: "payment_required",
      message: "Este estúdio não está ativo.",
      redirectTo,
    };
  }

  const status = String(studio.subscription_status ?? "");
  const trialActive = isFutureDate(studio.trial_ends_at, now);
  const periodActive =
    isFutureDate(studio.premium_access_until, now) ||
    isFutureDate(studio.subscription_current_period_end, now);
  const activeSubscription = periodActive && PERIOD_ACCESS_STATUSES.has(status);
  const effectivePlan = resolveEffectivePlanTier(studio as PlanAccessSnapshot, now);

  if (isFutureDate(studio.referral_premium_until, now) && !activeSubscription) {
    return {
      effectivePlan: "premium",
      subscriptionActive: false,
      trialActive: false,
      premiumActive: true,
      locked: false,
      status: "active",
      message: "Premium por indicação ativo.",
      redirectTo,
    };
  }

  if (activeSubscription && status !== "trialing") {
    return {
      effectivePlan,
      subscriptionActive: true,
      trialActive: false,
      premiumActive: effectivePlan === "premium",
      locked: false,
      status: "active",
      message: `Plano ${effectivePlan === "premium" ? "Premium" : "Pro"} ativo.`,
      redirectTo,
    };
  }

  if (trialActive || (activeSubscription && status === "trialing")) {
    return {
      effectivePlan,
      // A Bellza trial grants Premium entitlements, but it is not a paid
      // Stripe subscription. Keeping these concepts separate prevents the UI
      // from trying to update a canceled/absent subscription instead of
      // creating a new Checkout Session.
      subscriptionActive: activeSubscription,
      trialActive: true,
      premiumActive: true,
      locked: false,
      status: "trialing",
      message: "Teste gratuito ativo.",
      redirectTo,
    };
  }

  const trialExpired = Boolean(studio.trial_ends_at && !isFutureDate(studio.trial_ends_at, now));
  return {
    effectivePlan: "free",
    subscriptionActive: false,
    trialActive: false,
    premiumActive: false,
    locked: false,
    status: trialExpired ? "expired_trial" : "payment_required",
    message: trialExpired
      ? "O teste gratuito terminou. O seu estúdio continua disponível no plano Free."
      : "O seu estúdio está no plano Free.",
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
