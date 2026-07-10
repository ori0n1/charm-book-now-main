import { createFileRoute } from "@tanstack/react-router";
import { createStripeClient, resolveStripeAppBaseUrl, type StripeEnv } from "@/lib/stripe.server";
import { getSubscriptionPlans, isSubscriptionPlanId } from "@/lib/subscription-plans.server";
import { getAdminClient } from "@/lib/supabase-admin.server";
import {
  loadPrimaryStudio,
  assertNoDuplicateActiveSubscription,
  ensureCustomer,
  trialEndUnix,
  reserveCheckoutSession,
} from "@/lib/subscription-helpers";

function stripeEnv(): StripeEnv {
  if (process.env.STRIPE_ENV !== "live") {
    throw new Error("stripe_live_required");
  }
  return "live";
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

export const Route = createFileRoute("/api/create-checkout-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await getUserFromRequest(request);
          const body = await request.json().catch(() => ({}));
          const planId = body?.plan;
          if (!isSubscriptionPlanId(planId)) {
            return Response.json({ error: "invalid_plan" }, { status: 400 });
          }

          const plan = getSubscriptionPlans(stripeEnv())[planId];
          const sb = getAdminClient();
          const studio = await loadPrimaryStudio(sb, user.id);
          if (!studio?.id) {
            return Response.json({ error: "studio_required" }, { status: 409 });
          }
          await assertNoDuplicateActiveSubscription(sb, studio.id);

          const stripe = createStripeClient(stripeEnv());
          const customerId = await ensureCustomer(sb, stripe, studio);
          const price = await stripe.prices.retrieve(plan.priceId);
          if (price.livemode !== (stripeEnv() === "live")) {
            return Response.json({ error: "stripe_price_environment_mismatch" }, { status: 500 });
          }

          // Reserve checkout session to prevent race condition
          // This record will be updated by webhook when Stripe confirms
          await reserveCheckoutSession(sb, {
            userId: user.id,
            studioId: studio.id,
            planId: planId,
            priceId: plan.priceId,
            customerId,
          });

          const trialEnd = trialEndUnix(
            studio.trial_ends_at,
            studio.subscription_status,
            studio.trial_used_at,
          );
          const session = await stripe.checkout.sessions.create(
            {
              mode: "subscription",
              customer: customerId,
              line_items: [{ price: plan.priceId, quantity: 1 }],
              customer_update: { address: "auto", name: "auto" },
              metadata: {
                user_id: user.id,
                studio_id: studio.id,
                plan: plan.id,
              },
              subscription_data: {
                metadata: {
                  user_id: user.id,
                  studio_id: studio.id,
                  plan: plan.id,
                },
                ...(trialEnd ? { trial_end: trialEnd } : {}),
              },
              success_url: `${appBaseUrl(request)}/admin/pagamentos?billing=success&session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${appBaseUrl(request)}/admin/pagamentos?billing=cancelled`,
            },
            { idempotencyKey: `platform-subscription:${studio.id}:${user.id}:${plan.id}` },
          );

          return Response.json({ url: session.url });
        } catch (error) {
          const message = error instanceof Error ? error.message : "checkout_failed";
          const status =
            message === "unauthorized" || message === "studio_required"
              ? message === "unauthorized"
                ? 401
                : 409
              : message === "subscription_already_exists"
                ? 409
                : 500;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
