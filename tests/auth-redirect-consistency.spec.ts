import { expect, test } from "@playwright/test";
import {
  resolveAuthCallbackDestination,
  withValidatedAccountType,
} from "../src/lib/auth-context";

test.describe("authentication redirect consistency", () => {
  test("explicit public context keeps a studio account on the public studio page", () => {
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

    expect(explicitPublic).toEqual({
      destination: "/s/capivarabarbearia",
      accountType: "studio",
    });
    expect(regularLogin).toEqual({ destination: "/admin", accountType: "studio" });
  });

  test("staff keeps its role but remains in the explicit public context", () => {
    expect(
      resolveAuthCallbackDestination({
        landing: "/admin/agenda",
        callbackContext: "public",
        publicReturnTo: "/s/another-studio",
      }),
    ).toEqual({ destination: "/s/another-studio", accountType: "studio" });

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

  test("callback captures public context before OAuth cleanup", async () => {
    const callbackSource = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/routes/auth.callback.tsx", "utf8"),
    );
    const readAt = callbackSource.indexOf("const callbackContext = readAuthCallbackContext()");
    const settleAt = callbackSource.indexOf('settleSessionFromCurrentUrl("/auth/callback")');

    expect(readAt).toBeGreaterThan(-1);
    expect(settleAt).toBeGreaterThan(readAt);
    expect(callbackSource).toContain("Only the current callback URL is proof");
  });
});
