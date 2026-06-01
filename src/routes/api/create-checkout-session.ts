import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { getSubscriptionPlans, isSubscriptionPlanId } from "@/lib/subscription-plans.server";

let _admin: SupabaseClient | null = null;

function admin() {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

function stripeEnv(): StripeEnv {
  return process.env.STRIPE_ENV === "live" ? "live" : "sandbox";
}

function appBaseUrl() {
  return (
    process.env.APP_URL ??
    process.env.VITE_APP_URL ??
    process.env.PUBLIC_APP_URL ??
    "http://127.0.0.1:5173"
  ).replace(/\/$/, "");
}

async function getUserFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("unauthorized");

  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new Error("unauthorized");
  return data.user;
}

async function loadPrimaryStudio(userId: string) {
  const db = admin() as any;
  const { data } = await db
    .from("user_roles")
    .select("studio_id,studios(id,name,email,stripe_customer_id,subscription_status,trial_ends_at)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  return (data?.studios ?? null) as
    | {
        id: string;
        name: string | null;
        email: string | null;
        stripe_customer_id: string | null;
        subscription_status: string | null;
        trial_ends_at: string | null;
      }
    | null;
}

async function assertNoDuplicateActiveSubscription(studioId: string) {
  const db = admin() as any;
  const { data, error } = await db
    .from("subscriptions")
    .select("id,status")
    .eq("studio_id", studioId)
    .in("status", ["active", "trialing", "incomplete"])
    .maybeSingle();
  if (!error && data?.id) throw new Error("subscription_already_exists");
}

async function ensureCustomer(input: {
  userId: string;
  email: string | null;
  studio: NonNullable<Awaited<ReturnType<typeof loadPrimaryStudio>>>;
}) {
  if (input.studio?.stripe_customer_id) return input.studio.stripe_customer_id;

  const stripe = createStripeClient(stripeEnv());
  const customer = await stripe.customers.create({
    email: input.email ?? input.studio?.email ?? undefined,
    name: input.studio?.name ?? undefined,
    metadata: {
      user_id: input.userId,
      studio_id: input.studio?.id ?? "",
    },
  });

  if (input.studio?.id) {
    await admin()
      .from("studios")
      .update({ stripe_customer_id: customer.id })
      .eq("id", input.studio.id);
  }

  return customer.id;
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
          const studio = await loadPrimaryStudio(user.id);
          if (!studio?.id) {
            return Response.json({ error: "studio_required" }, { status: 409 });
          }
          await assertNoDuplicateActiveSubscription(studio.id);

          const customerId = await ensureCustomer({
            userId: user.id,
            email: user.email ?? null,
            studio,
          });

          const stripe = createStripeClient(stripeEnv());
          const session = await stripe.checkout.sessions.create({
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
              ...(trialEndUnix(studio.trial_ends_at, studio.subscription_status)
                ? { trial_end: trialEndUnix(studio.trial_ends_at, studio.subscription_status) }
                : {}),
            },
            success_url: `${appBaseUrl()}/admin/pagamentos?billing=success`,
            cancel_url: `${appBaseUrl()}/?billing=cancelled`,
          });

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

function trialEndUnix(trialEndsAt?: string | null, status?: string | null) {
  if (status && status !== "trialing") return null;
  if (!trialEndsAt) return null;
  const timestamp = Math.floor(new Date(trialEndsAt).getTime() / 1000);
  return timestamp > Math.floor(Date.now() / 1000) ? timestamp : null;
}
