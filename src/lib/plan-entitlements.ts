export const PLAN_TIERS = ["free", "pro", "premium"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const PLAN_FEATURES = [
  "agenda",
  "online_booking",
  "services",
  "manual_booking",
  "clients_basic",
  "public_page",
  "clients_full",
  "team_management",
  "online_payments",
  "notifications",
  "finance_basic",
  "attendance",
  "reviews",
  "reports_basic",
  "whatsapp",
  "loyalty",
  "promotions",
  "finance_advanced",
  "team_advanced",
  "future_integrations",
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];

export type PlanDefinition = {
  tier: PlanTier;
  name: string;
  monthlyCents: number;
  yearlyCents: number;
  maxActiveProfessionals: number | null;
  tagline: string;
  features: readonly PlanFeature[];
};

const FREE_FEATURES = [
  "agenda",
  "online_booking",
  "services",
  "manual_booking",
  "clients_basic",
  "public_page",
] as const satisfies readonly PlanFeature[];

const PRO_FEATURES = [
  ...FREE_FEATURES,
  "clients_full",
  "team_management",
  "online_payments",
  "notifications",
  "finance_basic",
  "attendance",
  "reviews",
  "reports_basic",
] as const satisfies readonly PlanFeature[];

export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  free: {
    tier: "free",
    name: "Free",
    monthlyCents: 0,
    yearlyCents: 0,
    maxActiveProfessionals: 1,
    tagline: "Comece a receber marcações online.",
    features: FREE_FEATURES,
  },
  pro: {
    tier: "pro",
    name: "Pro",
    monthlyCents: 1_299,
    yearlyCents: 12_900,
    maxActiveProfessionals: 3,
    tagline: "Tudo para gerir o seu negócio.",
    features: PRO_FEATURES,
  },
  premium: {
    tier: "premium",
    name: "Premium",
    monthlyCents: 2_499,
    yearlyCents: 24_900,
    maxActiveProfessionals: null,
    tagline: "Automatize, fidelize e cresça.",
    features: [
      ...PRO_FEATURES,
      "whatsapp",
      "loyalty",
      "promotions",
      "finance_advanced",
      "team_advanced",
      "future_integrations",
    ],
  },
};

export type PlanAccessSnapshot = {
  plan_tier?: string | null;
  subscription_plan_tier?: string | null;
  subscription_status?: string | null;
  subscription_current_period_end?: string | null;
  premium_access_until?: string | null;
  trial_ends_at?: string | null;
  is_active?: boolean | null;
};

const ACCESS_THROUGH_PERIOD_END = new Set(["active", "trialing", "canceled"]);

function dateIsFuture(value: string | null | undefined, now: Date) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export function normalizePlanTier(value: unknown, fallback: PlanTier = "free"): PlanTier {
  return typeof value === "string" && PLAN_TIERS.includes(value as PlanTier)
    ? (value as PlanTier)
    : fallback;
}

export function resolveEffectivePlanTier(
  snapshot: PlanAccessSnapshot | null | undefined,
  now: Date = new Date(),
): PlanTier {
  if (!snapshot || snapshot.is_active === false) return "free";

  const status = String(snapshot.subscription_status ?? "").toLowerCase();
  const periodIsActive =
    dateIsFuture(snapshot.subscription_current_period_end, now) ||
    dateIsFuture(snapshot.premium_access_until, now);

  if (periodIsActive && ACCESS_THROUGH_PERIOD_END.has(status)) {
    return normalizePlanTier(
      snapshot.subscription_plan_tier ?? snapshot.plan_tier,
      "premium",
    );
  }

  if (dateIsFuture(snapshot.trial_ends_at, now)) return "premium";

  return "free";
}

export function planHasFeature(tier: PlanTier, feature: PlanFeature) {
  return PLAN_DEFINITIONS[tier].features.includes(feature as never);
}

export function planProfessionalLimit(tier: PlanTier) {
  return PLAN_DEFINITIONS[tier].maxActiveProfessionals;
}

export function formatPlanPrice(cents: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

const ROUTE_FEATURES: ReadonlyArray<[prefix: string, feature: PlanFeature]> = [
  ["/admin/balcao", "attendance"],
  ["/admin/whatsapp", "whatsapp"],
  ["/admin/fidelidade", "loyalty"],
  ["/admin/indicacoes", "loyalty"],
  ["/admin/comissoes", "finance_basic"],
  ["/admin/recebimento", "finance_advanced"],
  ["/admin/levantamentos", "finance_advanced"],
  ["/admin/pagamentos", "finance_basic"],
  ["/admin/sinal", "online_payments"],
  ["/admin/equipa", "team_management"],
  ["/admin/politicas", "online_payments"],
];

export function requiredFeatureForAdminPath(pathname: string): PlanFeature | null {
  return ROUTE_FEATURES.find(([prefix]) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  )?.[1] ?? null;
}
