import { expect, test } from "@playwright/test";
import {
  canAttachAppointmentClientToSession,
  canExposePublicClientRecord,
} from "../src/lib/public-client-identity";

test.describe("public client identity isolation", () => {
  test("only exposes client records linked to the authenticated user id", () => {
    expect(canExposePublicClientRecord({ recordAuthUserId: "user-a", sessionUserId: "user-a" })).toBe(true);
    expect(canExposePublicClientRecord({ recordAuthUserId: "user-a", sessionUserId: "user-b" })).toBe(false);
    expect(canExposePublicClientRecord({ recordAuthUserId: null, sessionUserId: "user-b" })).toBe(false);
  });

  test("does not attach an existing appointment client when the email belongs to another account", () => {
    expect(
      canAttachAppointmentClientToSession({
        currentAuthUserId: null,
        clientEmail: "old-client@example.com",
        sessionUserId: "new-user",
        sessionEmail: "new-client@example.com",
      }),
    ).toBe(false);
  });

  test("allows attaching the appointment just created by the same verified email", () => {
    expect(
      canAttachAppointmentClientToSession({
        currentAuthUserId: null,
        clientEmail: "CLIENTE@EXAMPLE.COM",
        sessionUserId: "client-user",
        sessionEmail: "cliente@example.com",
      }),
    ).toBe(true);
  });

  test("does not allow taking over a client already linked to another auth user", () => {
    expect(
      canAttachAppointmentClientToSession({
        currentAuthUserId: "other-user",
        clientEmail: "cliente@example.com",
        sessionUserId: "client-user",
        sessionEmail: "cliente@example.com",
      }),
    ).toBe(false);
  });
});
