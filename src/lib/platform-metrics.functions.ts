import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";

function admin() {
  return getAdminClient();
}

async function assertSaasOwner(userId: string) {
  const sb = admin();
  const { data, error } = await (sb as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "saas_owner")
    .maybeSingle();
  if (error || data?.role !== "saas_owner") {
    throw new Response("forbidden", { status: 403 });
  }
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getLast6Months(now: Date): { key: string; label: string }[] {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const label = d.toLocaleDateString("pt-PT", { month: "short", year: "2-digit" });
    months.push({ key, label });
  }
  return months;
}

function humanizeEvent(kind: string, studioName: string): string {
  const map: Record<string, string> = {
    payment_confirmed: `Novo pagamento recebido · ${studioName}`,
    payment_failed: `Falha de pagamento · ${studioName}`,
    refund_request: `Pedido de reembolso · ${studioName}`,
    withdrawal_requested: `Registo financeiro · ${studioName}`,
    subscription_created: `Nova assinatura Premium · ${studioName}`,
    subscription_cancelled: `Assinatura cancelada · ${studioName}`,
    trial_started: `Início de teste gratuito · ${studioName}`,
  };
  return map[kind] ?? `Evento em ${studioName}`;
}

export type PlatformMetrics = {
  studios: {
    total: number;
    trial: number;
    monthly: number;
    yearly: number;
    scheduledCancel: number;
    cancelled: number;
    new7d: number;
    new30d: number;
    conversionRate: number;
    growthByMonth: { label: string; count: number }[];
  };
  revenue: {
    mrrCents: number;
    arrCents: number;
  };
  payments: {
    totalCents: number;
    monthCents: number;
    weekCents: number;
    completedCount: number;
    cancelledCount: number;
    refundsCount: number;
    failedCount: number;
    volumeByMonth: { label: string; cents: number }[];
  };
  alerts: {
    expiringSoon: { studioId: string; name: string; expiresAt: string; daysLeft: number }[];
    pastDue: { studioId: string; name: string }[];
    recentFailures: { studioId: string; name: string; createdAt: string }[];
  };
  activity: { id: string; text: string; time: string; kind: string }[];
};

export const getPlatformMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformMetrics> => {
    await assertSaasOwner((context as any).userId);
    const sb = admin();

    const now = new Date();
    const d7ago = new Date(now.getTime() - 7 * 86400000);
    const d30ago = new Date(now.getTime() - 30 * 86400000);
    const d7ahead = new Date(now.getTime() + 7 * 86400000);
    const d6mago = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now.getTime() - 6 * 86400000);

    const [studiosRes, subsRes, paymentsRes, appointmentsRes, refundsRes, notifsRes] =
      await Promise.all([
        (sb as any)
          .from("studios")
          .select("id,name,is_active,plan,subscription_status,trial_ends_at,created_at")
          .limit(2000),
        (sb as any)
          .from("subscriptions")
          .select(
            "id,studio_id,plan,status,current_period_end,cancel_at_period_end,updated_at,studios:studio_id(name)",
          )
          .limit(2000),
        (sb as any)
          .from("payment_intents")
          .select("id,studio_id,amount_cents,status,created_at,studios:studio_id(name)")
          .gte("created_at", d6mago.toISOString())
          .order("created_at", { ascending: false })
          .limit(3000),
        (sb as any)
          .from("appointments")
          .select("id,status,created_at")
          .gte("created_at", d6mago.toISOString())
          .limit(5000),
        (sb as any)
          .from("refund_requests")
          .select("id,status,created_at")
          .order("created_at", { ascending: false })
          .limit(200),
        (sb as any)
          .from("studio_notifications")
          .select("id,studio_id,kind,title,body,created_at,studios:studio_id(name)")
          .order("created_at", { ascending: false })
          .limit(25),
      ]);

    const studios: any[] = studiosRes.data ?? [];
    const subs: any[] = subsRes.data ?? [];
    const payments: any[] = paymentsRes.data ?? [];
    const appointments: any[] = appointmentsRes.data ?? [];
    const refunds: any[] = refundsRes.data ?? [];
    const notifs: any[] = notifsRes.data ?? [];

    // ── Studios ──────────────────────────────────────────────────────────────
    const activeStudios = studios.filter((s) => s.is_active !== false);
    const trialStudios = activeStudios.filter(
      (s) => s.subscription_status === "trialing" || s.plan === "trial",
    );
    const activeSubs = subs.filter(
      (s) =>
        s.status === "active" &&
        (!s.current_period_end || new Date(s.current_period_end) >= now),
    );
    const monthlySubs = activeSubs.filter((s) => s.plan === "monthly");
    const yearlySubs = activeSubs.filter((s) => s.plan === "yearly");
    const scheduledCancelSubs = activeSubs.filter((s) => s.cancel_at_period_end === true);
    const cancelledSubs = subs.filter((s) =>
      ["canceled", "cancelled"].includes(String(s.status)),
    );

    const new7d = studios.filter((s) => new Date(s.created_at) >= d7ago).length;
    const new30d = studios.filter((s) => new Date(s.created_at) >= d30ago).length;

    const premiumCount = monthlySubs.length + yearlySubs.length;
    const baseForConversion = premiumCount + trialStudios.length;
    const conversionRate =
      baseForConversion > 0 ? Math.round((premiumCount / baseForConversion) * 100) : 0;

    // ── Revenue ───────────────────────────────────────────────────────────────
    // Monthly plan: 8.99 € → 899 cents/month
    // Yearly plan:  71.99 € / 12 → ~600 cents/month contribution to MRR
    const mrrCents = monthlySubs.length * 899 + yearlySubs.length * Math.round(7199 / 12);
    const arrCents = mrrCents * 12;

    // ── Growth chart ──────────────────────────────────────────────────────────
    const last6 = getLast6Months(now);
    const growthByMonth = last6.map(({ key, label }) => ({
      label,
      count: studios.filter((s) => monthKey(new Date(s.created_at)) === key).length,
    }));

    // ── Payments ──────────────────────────────────────────────────────────────
    const succeeded = payments.filter((p) => p.status === "succeeded");
    const failed = payments.filter((p) =>
      ["failed", "expired", "canceled"].includes(String(p.status)),
    );

    const totalCents = succeeded.reduce(
      (acc: number, p: any) => acc + Number(p.amount_cents || 0),
      0,
    );
    const monthCents = succeeded
      .filter((p) => new Date(p.created_at) >= startOfMonth)
      .reduce((acc: number, p: any) => acc + Number(p.amount_cents || 0), 0);
    const weekCents = succeeded
      .filter((p) => new Date(p.created_at) >= startOfWeek)
      .reduce((acc: number, p: any) => acc + Number(p.amount_cents || 0), 0);

    const volumeByMonth = last6.map(({ key, label }) => ({
      label,
      cents: succeeded
        .filter((p) => monthKey(new Date(p.created_at)) === key)
        .reduce((acc: number, p: any) => acc + Number(p.amount_cents || 0), 0),
    }));

    const completedCount = appointments.filter((a) =>
      ["completed", "confirmed"].includes(String(a.status)),
    ).length;
    const cancelledCount = appointments.filter((a) =>
      ["cancelled", "no_show"].includes(String(a.status)),
    ).length;
    const refundsCount = refunds.filter((r) =>
      ["pending", "approved", "refunded"].includes(String(r.status)),
    ).length;

    // ── Alerts ────────────────────────────────────────────────────────────────
    const expiringSoon = subs
      .filter(
        (s) =>
          s.status === "active" &&
          s.cancel_at_period_end === true &&
          s.current_period_end &&
          new Date(s.current_period_end) <= d7ahead &&
          new Date(s.current_period_end) >= now,
      )
      .slice(0, 5)
      .map((s) => ({
        studioId: s.studio_id as string,
        name: (s.studios as any)?.name ?? "Estúdio",
        expiresAt: s.current_period_end as string,
        daysLeft: Math.ceil(
          (new Date(s.current_period_end).getTime() - now.getTime()) / 86400000,
        ),
      }));

    const pastDue = subs
      .filter((s) => ["past_due", "unpaid", "incomplete"].includes(String(s.status)))
      .slice(0, 5)
      .map((s) => ({
        studioId: s.studio_id as string,
        name: (s.studios as any)?.name ?? "Estúdio",
      }));

    const recentFailures = failed.slice(0, 5).map((p) => ({
      studioId: p.studio_id as string,
      name: (p.studios as any)?.name ?? "Estúdio",
      createdAt: p.created_at as string,
    }));

    // ── Activity ──────────────────────────────────────────────────────────────
    const activity = notifs.slice(0, 20).map((n) => ({
      id: n.id as string,
      text: humanizeEvent(n.kind as string, (n.studios as any)?.name ?? "Estúdio"),
      time: n.created_at as string,
      kind: n.kind as string,
    }));

    return {
      studios: {
        total: studios.length,
        trial: trialStudios.length,
        monthly: monthlySubs.length,
        yearly: yearlySubs.length,
        scheduledCancel: scheduledCancelSubs.length,
        cancelled: cancelledSubs.length,
        new7d,
        new30d,
        conversionRate,
        growthByMonth,
      },
      revenue: { mrrCents, arrCents },
      payments: {
        totalCents,
        monthCents,
        weekCents,
        completedCount,
        cancelledCount,
        refundsCount,
        failedCount: failed.length,
        volumeByMonth,
      },
      alerts: { expiringSoon, pastDue, recentFailures },
      activity,
    };
  });
