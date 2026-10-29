import assert from "node:assert/strict";
import { test } from "node:test";
import { referralRewardAction } from "../src/lib/referral-reward-policy.ts";

test("rollback pauses new Premium awards, including matured pending referrals", () => {
  assert.equal(referralRewardAction("premium_days", false), "premium_pending");
  assert.equal(referralRewardAction("premium_days", true), "premium_award");
});

test("historic credits keep their original processor in either Worker", () => {
  assert.equal(referralRewardAction("legacy_credit", false), "legacy_credit");
  assert.equal(referralRewardAction("legacy_credit", true), "legacy_credit");
});

test("missing or unfamiliar kind fails closed before Stripe", () => {
  for (const value of [null, undefined, "", "credit", "premium"]) {
    assert.throws(() => referralRewardAction(value, false), /unrecognized/);
    assert.throws(() => referralRewardAction(value, true), /unrecognized/);
  }
});
