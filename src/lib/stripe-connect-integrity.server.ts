import type Stripe from "stripe";

export type ConnectedPaymentMethod = "card" | "mb_way";

export type ConnectedAccountResponsibility = {
  feesPayer: string | null;
  lossesCollector: string | null;
  dashboardType: string | null;
};

export function readConnectedAccountResponsibility(account: Stripe.Account) {
  const controller = (account as any).controller;
  return {
    feesPayer: controller?.fees?.payer ?? null,
    lossesCollector: controller?.losses?.payments ?? null,
    dashboardType: controller?.stripe_dashboard?.type ?? null,
  } satisfies ConnectedAccountResponsibility;
}

export async function assertConnectedAccountReadyForCharge(
  stripe: Stripe,
  input: {
    accountId: string;
    studioId: string;
    method: ConnectedPaymentMethod;
    requirePayouts?: boolean;
  },
) {
  const account = await stripe.accounts.retrieve(input.accountId);
  if (account.id !== input.accountId) throw new Error("connect_account_mismatch");

  const metadataStudioId = account.metadata?.studio_id;
  if (metadataStudioId && metadataStudioId !== input.studioId) {
    throw new Error("connect_account_studio_mismatch");
  }

  if (!account.details_submitted || !account.charges_enabled) {
    throw new Error("connect_account_not_ready");
  }
  if (account.requirements?.disabled_reason) {
    throw new Error("connect_account_restricted");
  }
  if (input.requirePayouts !== false && !account.payouts_enabled) {
    throw new Error("connect_payouts_not_ready");
  }

  const capabilities = account.capabilities as Record<string, string | undefined> | null;
  const capability = input.method === "mb_way" ? "mb_way_payments" : "card_payments";
  if (capabilities?.[capability] !== "active") {
    throw new Error(`${capability}_not_active`);
  }

  const responsibility = readConnectedAccountResponsibility(account);
  if (responsibility.feesPayer !== "account") {
    throw new Error("connect_fee_payer_incompatible");
  }
  if (responsibility.lossesCollector !== "stripe") {
    throw new Error("connect_negative_balance_liability_incompatible");
  }

  return account;
}
