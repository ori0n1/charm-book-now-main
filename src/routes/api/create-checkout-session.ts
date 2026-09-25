import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { z } from "zod";
import { createStripeClient, getConfiguredStripeEnv, resolveStripeAppBaseUrl, type StripeEnv } from "@/lib/stripe.server";
import {
  getSubscriptionPlan,
  isSubscriptionPlanId,
  validateStripeRecurringPrice,
} from "@/lib/subscription-plans.server";
import { getAdminClient } from "@/lib/supabase-admin.server";
import {
  loadPrimaryStudio,
  loadStudioForBilling,
  assertNoDuplicateActiveSubscription,
  ensureCustomer,
  trialEndUnix,
  reserveCheckoutSession,
  releaseCheckoutSession,
} from "@/lib/subscription-helpers";
import { assertStudioOwnerAccess, rateLimitOrThrow } from "@/lib/server-security";
import { assertCookieMutationCsrf } from "@/integrations/supabase/auth-csrf";

const CheckoutRequest = z.object({
  studioId: z.string().uuid().optional(),
  plan: z.enum(["pro_monthly", "pro_yearly", "premium_monthly", "premium_yearly"]),
  checkoutAttemptId: z.string().uuid().optional(),
});

function stripeEnv(): StripeEnv {
  return getConfiguredStripeEnv();
}

function appBaseUrl(request: Request) {
  return resolveStripeAppBaseUrl({ request });
}

async function getUserFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("unauthorized");

  const db = getAdminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("unauthorized");
  return data.user;
}

async function findReusableCheckoutSession(
  stripe: Stripe,
  input: {
    customerId: string;
    studioId: string;
    userId: string;
    planId: string;
    priceId: string;
  },
) {
  const sessions = await stripe.checkout.sessions.list({
    customer: input.customerId,
    limit: 10,
  });
  const now = Math.floor(Date.now() / 1000);
  return (
    sessions.data.find(
      (session) =>
        session.mode === "subscription" &&
        session.status === "open" &&
        Boolean(session.url) &&
        (session.expires_at ?? 0) > now &&
        session.metadata?.studio_id === input.studioId &&
        session.metadata?.user_id === input.userId &&
        session.metadata?.plan === input.planId &&
        (!session.metadata?.price_id || session.metadata.price_id === input.priceId),
    ) ?? null
  );
}

function checkoutResponse(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Authorization",
    },
  });
}

export const Route = createFileRoute("/api/create-checkout-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertCookieMutationCsrf(request);
          const user = await getUserFromRequest(request);
          const parsed = CheckoutRequest.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success || !isSubscriptionPlanId(parsed.data.plan)) {
            return checkoutResponse({ error: "invalid_checkout_request" }, 400);
          }
          const { plan: planId } = parsed.data;

          const plan = getSubscriptionPlan(stripeEnv(), planId);
          const sb = getAdminClient();
          const studio = parsed.data.studioId
            ? await loadStudioForBilling(sb, parsed.data.studioId)
            : await loadPrimaryStudio(sb, user.id);
          if (!studio?.id) {
            return checkoutResponse({ error: "studio_required" }, 409);
          }
          await assertStudioOwnerAccess(sb, user.id, studio.id, { allowExpiredTrial: true });
          await rateLimitOrThrow({
            key: `billing-checkout-api:${user.id}:${studio.id}`,
            limit: 8,
            windowMs: 10 * 60 * 1000,
          });
          await assertNoDuplicateActiveSubscription(sb, studio.id);

          const stripe = createStripeClient(stripeEnv());
          const customerId = await ensureCustomer(sb, stripe, studio);
          await validateStripeRecurringPrice(stripe, stripeEnv(), plan);
          const reusable = await findReusableCheckoutSession(stripe, {
            customerId,
            studioId: studio.id,
            userId: user.id,
            planId,
            priceId: plan.priceId,
          });
          if (reusable?.url) {
            return checkoutResponse({ url: reusable.url, sessionId: reusable.id, reused: true });
          }

          // Reserve checkout session to prevent race condition
          // This record will be updated by webhook when Stripe confirms
          await reserveCheckoutSession(sb, {
            userId: user.id,
            studioId: studio.id,
            planId: planId,
            planTier: plan.tier,
            billingInterval: plan.billingInterval,
            priceId: plan.priceId,
            customerId,
          });

          const trialEnd = trialEndUnix(
            studio.trial_ends_at,
            studio.subscription_status,
            studio.trial_used_at,
          );
          const checkoutAttemptId = parsed.data.checkoutAttemptId ?? crypto.randomUUID();
          let session: Stripe.Checkout.Session;
          try {
            session = await stripe.checkout.sessions.create({
              mode: "subscription",
              customer: customerId,
              client_reference_id: studio.id,
              line_items: [{ price: plan.priceId, quantity: 1 }],
              customer_update: { address: "auto", name: "auto" },
              metadata: {
                user_id: user.id,
                studio_id: studio.id,
                plan: plan.id,
                plan_tier: plan.tier,
                billing_interval: plan.billingInterval,
                price_id: plan.priceId,
                checkout_attempt_id: checkoutAttemptId,
              },
              subscription_data: {
                metadata: {
                  user_id: user.id,
                  studio_id: studio.id,
                  plan: plan.id,
                  plan_tier: plan.tier,
                  billing_interval: plan.billingInterval,
                  price_id: plan.priceId,
                },
                ...(trialEnd ? { trial_end: trialEnd } : {}),
              },
              success_url: `${appBaseUrl(request)}/admin/premium?billing=success&session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${appBaseUrl(request)}/admin/premium?billing=cancelled`,
              expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
            }, {
              idempotencyKey: [
                "platform-subscription",
                studio.id,
                user.id,
                plan.id,
                checkoutAttemptId,
              ].join(":"),
            });
          } catch (error) {
            await releaseCheckoutSession(sb, { userId: user.id, studioId: studio.id });
            throw error;
          }

          if (!session.url) {
            await releaseCheckoutSession(sb, { userId: user.id, studioId: studio.id });
            throw new Error("checkout_url_missing");
          }

          return checkoutResponse({ url: session.url, sessionId: session.id, reused: false });
        } catch (error) {
          if (error instanceof Response) {
            const message = await error.clone().text().catch(() => "forbidden");
            return checkoutResponse({ error: message || "forbidden" }, error.status);
          }
          const message = error instanceof Error ? error.message : "checkout_failed";
          const status =
            message === "unauthorized" || message === "studio_required"
              ? message === "unauthorized"
                ? 401
                : 409
              : message === "subscription_already_exists"
                ? 409
                : 500;
          if (status === 500) {
            console.error("[checkout] session_create_failed", {
              reason: message,
              request_id: request.headers.get("cf-ray") ?? null,
            });
          }
          return checkoutResponse({ error: status === 500 ? "checkout_failed" : message }, status);
        }
      },
    },
  },
});
