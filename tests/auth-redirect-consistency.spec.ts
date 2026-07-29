import { expect, test } from "@playwright/test";
import {
  resolveAuthCallbackDestination,
  withValidatedAccountType,
} from "../src/lib/auth-context";

test.describe("authentication redirect consistency", () => {
  test("studio role always wins over an explicit or stale public context", () => {
    const explicitPublic = resolveAuthCallbackDestination({
      landing: "/admin",
      callbackContext: "public",
      publicReturnTo: "/s/capivarabarbearia",
    });
    const regularLogin = resolveAuthCallbackDestination({
      landing: "/admin",
      callbackContext: null,
      publicReturnTo: "/s/capivarabarbearia",
    });

    expect(explicitPublic).toEqual({ destination: "/admin", accountType: "studio" });
    expect(regularLogin).toEqual({ destination: "/admin", accountType: "studio" });
  });

  test("staff destinations remain role-specific on every device", () => {
    expect(
      resolveAuthCallbackDestination({
        landing: "/admin/agenda",
        callbackContext: "public",
        publicReturnTo: "/s/another-studio",
      }),
    ).toEqual({ destination: "/admin/agenda", accountType: "studio" });

    expect(
      resolveAuthCallbackDestination({
        landing: "/admin/balcao",
        callbackContext: null,
        publicReturnTo: null,
      }),
    ).toEqual({ destination: "/admin/balcao", accountType: "studio" });
  });

  test("only an explicit current callback can return a pure customer to the public area", () => {
    expect(
      resolveAuthCallbackDestination({
        landing: "/onboarding",
        callbackContext: "public",
        publicReturnTo: "/s/capivarabarbearia?tab=services",
      }),
    ).toEqual({
      destination: "/s/capivarabarbearia?tab=services",
      accountType: "customer",
    });

    expect(
      resolveAuthCallbackDestination({
        landing: "/onboarding",
        callbackContext: null,
        publicReturnTo: "/s/capivarabarbearia",
      }),
    ).toEqual({ destination: "/onboarding", accountType: null });
  });

  test("repairs contaminated customer metadata after a validated studio role", () => {
    const repaired = withValidatedAccountType(
      {
        full_name: "Gabriel",
        account_type: "customer",
        bellza_account_type: "customer",
      },
      "studio",
    );

    expect(repaired).toMatchObject({
      full_name: "Gabriel",
      account_type: "studio",
      bellza_account_type: "studio",
    });
  });
});
