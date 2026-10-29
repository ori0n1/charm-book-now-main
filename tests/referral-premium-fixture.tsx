import React from "react";
import { createRoot } from "react-dom/client";
import { HeroSection, StatsGrid, HowItWorks, HistorySection } from "@/routes/_authenticated/admin.indicacoes";
import type { ReferralInfo } from "@/lib/referrals.functions";
import "@/styles.css";

const now = new Date();
const later = new Date(now.getTime() + 14 * 86_400_000).toISOString();
const data: ReferralInfo = {
  referralCode: "TESTE123",
  referralUrl: "https://bellza.pt/signup?ref=TESTE123",
  totalInvited: 3,
  totalApproved: 2,
  totalPending: 1,
  creditsAvailable: 1,
  creditsAvailableCents: 899,
  creditsApplied: 0,
  creditsLimit: 6,
  premiumGrants: [{ referralId: "premium", startsAt: now.toISOString(), endsAt: later }],
  history: [
    { id: "premium", status: "approved", createdAt: now.toISOString(),
      validatedAt: now.toISOString(), creditedAt: now.toISOString(), rewardKind: "premium_days" },
    { id: "legacy", status: "approved", createdAt: now.toISOString(),
      validatedAt: now.toISOString(), creditedAt: now.toISOString(), rewardKind: "legacy_credit" },
    { id: "pending", status: "pending_validation", createdAt: now.toISOString(),
      validatedAt: null, creditedAt: null, rewardKind: "premium_days" },
  ],
};

createRoot(document.getElementById("root")!).render(
  <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-3 px-3 py-2 md:gap-4 md:px-6 md:py-5">
    <HeroSection data={data} />
    <StatsGrid data={data} />
    <div className="grid items-start gap-3 md:gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <HowItWorks />
      <HistorySection data={data} />
    </div>
  </div>,
);
