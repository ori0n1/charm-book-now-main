export type ReferralRewardAction = "legacy_credit" | "premium_award" | "premium_pending";

// The compatible rollback pauses new Premium awards without changing the
// promise attached to a referral or touching historic Stripe credits.
export function referralRewardAction(
  rewardKind: unknown,
  premiumAwardsEnabled: boolean,
): ReferralRewardAction {
  if (rewardKind === "premium_days") {
    return premiumAwardsEnabled ? "premium_award" : "premium_pending";
  }
  if (rewardKind === "legacy_credit") return "legacy_credit";
  throw new Error("referral_reward_kind_unrecognized");
}
