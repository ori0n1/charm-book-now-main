import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { createStripeClient, getConfiguredStripeEnv, resolveStripeAppBaseUrl } from "@/lib/stripe.server";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Credit value per approved referral in cents (8.99 €) */
const REFERRAL_CREDIT_CENTS = 899;
/** Max credits a studio can accumulate in the initial phase */
const MAX_CREDITS = 6;
/** Days the referred studio must maintain an active subscription */
const HOLD_DAYS = 30;
/** Base URL for referral links */
function appBaseUrl(): string {
  return resolveStripeAppBaseUrl();
}

function sb() {
  return getAdminClient();
}

function stripeEnv(): "live" | "sandbox" {
  return getConfiguredStripeEnv();
}

// ── Code generation ───────────────────────────────────────────────────────────

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getOrCreateReferralCode(studioId: string): Promise<string> {
  // Use RPC to bypass PostgREST schema-cache issues with newly-added columns
  const { data: code, error } = await sb().rpc("get_or_create_referral_code", {
    p_studio_id: studioId,
  });
  if (error) {
    console.error("[referrals] getOrCreateReferralCode: rpc failed", error);
    throw new Error(`referral_code_db_error: ${error.message}`);
  }
  if (!code) throw new Error("referral_code_generation_failed");
  return code as string;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReferralStatus = "pending_validation" | "approved" | "rejected";

export type ReferralInfo = {
  referralCode: string;
  referralUrl: string;
  totalInvited: number;
  totalApproved: number;
  totalPending: number;
  creditsAvailable: number;      // count of available credits
  creditsAvailableCents: number; // total value in cents
  creditsApplied: number;
  creditsLimit: number;
  history: {
    id: string;
    status: ReferralStatus;
    createdAt: string;
    validatedAt: string | null;
    creditedAt: string | null;
  }[];
};

// ── Server functions ──────────────────────────────────────────────────────────

/**
 * Called from the onboarding page after studio creation.
 * Reads referral_code from the authenticated user's metadata (email signup)
 * or from the client-passed refCode fallback (Google auth — code only in localStorage).
 * Safe to call multiple times (idempotent).
 */
export const claimReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ studioId: z.string().uuid(), refCode: z.string().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ claimed: boolean }> => {
    await assertStudioAccess(sb(), (context as any).userId, data.studioId, {
      entitlement: "loyalty",
    });

    // Prefer user_metadata (set on email signup), fall back to client-passed refCode (Google auth)
    const { data: userData } = await sb().auth.admin.getUserById((context as any).userId);
    const metaRef = (userData?.user?.user_metadata?.referral_code as string | undefined)?.trim().toUpperCase();
    const refCode = metaRef || data.refCode?.trim().toUpperCase();

    if (!refCode) return { claimed: false };

    await claimReferralInternal(data.studioId, refCode);
    return { claimed: true };
  });

/**
 * Returns the studio's referral code, referral URL and stats.
 * Creates the code if it doesn't exist yet.
 */
export const getMyReferralInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studioId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ReferralInfo> => {
    await assertStudioAccess(sb(), (context as any).userId, data.studioId, {
      entitlement: "loyalty",
    });

    const code = await getOrCreateReferralCode(data.studioId);
    const referralUrl = `${appBaseUrl()}/signup?ref=${code}`;

    // Load referral stats
    const { data: referrals } = await sb()
      .from("referrals")
      .select("id, status, created_at, validated_at, credited_at")
      .eq("referrer_studio_id", data.studioId)
      .order("created_at", { ascending: false });

    const list = referrals ?? [];
    const totalInvited = list.length;
    const totalApproved = list.filter((r) => r.status === "approved").length;
    const totalPending = list.filter((r) => r.status === "pending_validation").length;

    // Load credits
    const { data: credits } = await sb()
      .from("referral_credits")
      .select("id, status, amount_cents")
      .eq("studio_id", data.studioId);

    const creditList = credits ?? [];
    const availableCredits = creditList.filter((c) => c.status === "available");
    const appliedCredits = creditList.filter((c) => c.status === "applied");

    return {
      referralCode: code,
      referralUrl,
      totalInvited,
      totalApproved,
      totalPending,
      creditsAvailable: availableCredits.length,
      creditsAvailableCents: availableCredits.reduce((s, c) => s + c.amount_cents, 0),
      creditsApplied: appliedCredits.length,
      creditsLimit: MAX_CREDITS,
      history: list.map((r) => ({
        id: r.id,
        status: r.status as ReferralStatus,
        createdAt: r.created_at,
        validatedAt: r.validated_at ?? null,
        creditedAt: r.credited_at ?? null,
      })),
    };
  });

// ── Internal functions (used by webhook / signup callback) ───────────────────

/**
 * Called after a new studio is created, if a ref code was provided at signup.
 * Creates a pending_validation referral if valid.
 * Anti-fraud: blocks self-referral, duplicate referrals, non-existent codes.
 */
export async function claimReferralInternal(referredStudioId: string, refCode: string) {
  const code = refCode.trim().toUpperCase();
  if (!code) return;

  // Use RPC to bypass PostgREST schema-cache issue with referral_code column
  const { data: referrerStudioId, error: rpcError } = await sb().rpc(
    "get_studio_id_by_referral_code",
    { p_code: code },
  );

  if (rpcError) {
    console.error("[referrals] claimReferral: rpc lookup failed", rpcError);
    return;
  }

  if (!referrerStudioId) {
    console.warn("[referrals] claimReferral: unknown ref code", { refCode: code, referredStudioId });
    return;
  }

  // Wrap in an object so the rest of the function works the same
  const referrer = { id: referrerStudioId as string };

  // Anti-fraud: self-referral (should be caught by DB constraint too)
  if (referrer.id === referredStudioId) {
    console.warn("[referrals] claimReferral: self-referral blocked", { referredStudioId });
    return;
  }

  // Anti-fraud: already has a referral (UNIQUE constraint on referred_studio_id)
  const { error } = await sb().from("referrals").insert({
    referrer_studio_id: referrer.id,
    referred_studio_id: referredStudioId,
    ref_code: code,
    status: "pending_validation",
    created_at: new Date().toISOString(),
  });

  if (error) {
    // Duplicate or constraint violation — silently ignore
    if (error.code === "23505") {
      console.info("[referrals] claimReferral: duplicate referral ignored", { referredStudioId });
    } else {
      console.error("[referrals] claimReferral: insert error", error);
    }
    return;
  }

  console.info("[referrals] claimReferral: pending referral created", {
    referrerStudioId: referrer.id,
    referredStudioId,
    code,
  });
}

/**
 * Called from the Stripe invoice.paid webhook.
 * For each pending referral where the referred studio has had an active subscription
 * for >= HOLD_DAYS, marks it as approved and issues a Stripe balance credit to the referrer.
 *
 * Safe to call multiple times (idempotent via status check).
 */
export async function processReferralsOnPayment(referredStudioId: string) {
  // Find pending referrals for this referred studio
  const { data: pendingReferrals } = await sb()
    .from("referrals")
    .select("id, referrer_studio_id, subscription_started_at")
    .eq("referred_studio_id", referredStudioId)
    .eq("status", "pending_validation");

  if (!pendingReferrals?.length) return;

  for (const referral of pendingReferrals) {
    const startedAt = referral.subscription_started_at
      ? new Date(referral.subscription_started_at)
      : null;

    if (!startedAt) {
      // Record subscription start time (first payment)
      await sb()
        .from("referrals")
        .update({ subscription_started_at: new Date().toISOString() })
        .eq("id", referral.id);
      console.info("[referrals] processReferrals: subscription start recorded", { referralId: referral.id });
      continue;
    }

    const daysSinceStart = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceStart < HOLD_DAYS) {
      console.info("[referrals] processReferrals: hold period not yet met", {
        referralId: referral.id,
        daysSinceStart: Math.floor(daysSinceStart),
      });
      continue;
    }

    // Check max credit cap for referrer
    const { count } = await sb()
      .from("referral_credits")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", referral.referrer_studio_id)
      .in("status", ["available", "applied"]);

    if ((count ?? 0) >= MAX_CREDITS) {
      console.info("[referrals] processReferrals: max credits reached for referrer", {
        referrerStudioId: referral.referrer_studio_id,
      });
      // Still approve referral (just no credit issued)
      await sb()
        .from("referrals")
        .update({ status: "approved", validated_at: new Date().toISOString() })
        .eq("id", referral.id);
      continue;
    }

    // Load referrer's Stripe customer
    const { data: referrerStudio } = await sb()
      .from("studios")
      .select("stripe_customer_id")
      .eq("id", referral.referrer_studio_id)
      .maybeSingle();

    const customerId = referrerStudio?.stripe_customer_id;

    // Apply Stripe balance credit (negative = credit)
    if (customerId) {
      try {
        const stripe = createStripeClient(stripeEnv());
        await stripe.customers.createBalanceTransaction(customerId, {
          amount: -REFERRAL_CREDIT_CENTS, // negative = credit
          currency: "eur",
          description: `Crédito Bellza — Programa Indique e Ganhe`,
          metadata: { referral_id: referral.id, source: "bellza_referral" },
        });
        console.info("[referrals] processReferrals: Stripe credit applied", {
          referralId: referral.id,
          customerId,
          amountCents: REFERRAL_CREDIT_CENTS,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[referrals] processReferrals: Stripe credit failed", { referralId: referral.id, error: msg });
        // Don't throw — still record DB credit for manual processing
      }
    }

    // Record credit in DB + approve referral
    const now = new Date().toISOString();
    await sb().from("referral_credits").insert({
      studio_id: referral.referrer_studio_id,
      referral_id: referral.id,
      amount_cents: REFERRAL_CREDIT_CENTS,
      status: "available",
      created_at: now,
    });

    await sb()
      .from("referrals")
      .update({ status: "approved", validated_at: now, credited_at: now })
      .eq("id", referral.id);

    console.info("[referrals] processReferrals: referral approved + credit issued", {
      referralId: referral.id,
      referrerStudioId: referral.referrer_studio_id,
    });
  }
}

/**
 * Reject referrals when the referred studio cancels/refunds within the hold period.
 * Called from webhook on subscription.deleted or invoice.payment_failed.
 */
export async function rejectReferralOnCancellation(referredStudioId: string) {
  const { data: pending } = await sb()
    .from("referrals")
    .select("id, subscription_started_at")
    .eq("referred_studio_id", referredStudioId)
    .eq("status", "pending_validation");

  if (!pending?.length) return;

  for (const referral of pending) {
    const startedAt = referral.subscription_started_at
      ? new Date(referral.subscription_started_at)
      : null;
    const daysSinceStart = startedAt
      ? (Date.now() - startedAt.getTime()) / (1000 * 60 * 60 * 24)
      : 0;

    if (daysSinceStart < HOLD_DAYS) {
      await sb()
        .from("referrals")
        .update({ status: "rejected", rejected_reason: "subscription_cancelled_within_hold_period" })
        .eq("id", referral.id);
      console.info("[referrals] rejectReferral: cancelled within hold period", { referralId: referral.id });
    }
  }
}
