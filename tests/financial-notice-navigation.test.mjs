import assert from "node:assert/strict";
import test from "node:test";
import { financialNoticeActionUrl } from "../src/lib/financial-notice-navigation.ts";

test("a completed Stripe payout opens its matching Recebimentos record", () => {
  assert.equal(
    financialNoticeActionUrl({ id: "payout:po_1UMYfYLldOFERkAn5Dh1kMAa:paid" }),
    "/admin/recebimento?payout=po_1UMYfYLldOFERkAn5Dh1kMAa",
  );
});

test("balance notices and untrusted payout IDs stay on Recebimentos", () => {
  assert.equal(financialNoticeActionUrl({ id: "balance:available" }), "/admin/recebimento");
  assert.equal(financialNoticeActionUrl({ id: "payout:../other:paid" }), "/admin/recebimento");
});
