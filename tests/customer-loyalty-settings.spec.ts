import { expect, test } from "@playwright/test";
import { isCustomerLoyaltyEnabled } from "../src/lib/customer-loyalty.functions";

test.describe("customer loyalty visibility", () => {
  test("is disabled unless the studio explicitly enables it", () => {
    expect(isCustomerLoyaltyEnabled(null)).toBe(false);
    expect(isCustomerLoyaltyEnabled(undefined)).toBe(false);
    expect(isCustomerLoyaltyEnabled({ enabled: false })).toBe(false);
    expect(isCustomerLoyaltyEnabled({ enabled: true })).toBe(true);
  });
});
