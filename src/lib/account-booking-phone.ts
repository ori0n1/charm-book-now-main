export function normalizeAccountBookingPhone(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[^\d+\s]/g, "")
    .replace(/\s+/g, " ");
}

export function isUsableAccountPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

export function readAccountPreferredPhone(metadata: unknown): string {
  const value = (metadata as Record<string, unknown> | null)?.bellza_booking_phone;
  if (typeof value === "string" && /^account:/i.test(value.trim())) return "";
  const phone = typeof value === "string" ? normalizeAccountBookingPhone(value) : "";
  return isUsableAccountPhone(phone) ? phone : "";
}

export const ACCOUNT_CONTACT_CONSENT_VERSION = "booking-v1";
const ACCOUNT_CONTACT_AUTHORIZATIONS_KEY = "bellza_booking_contact_authorizations";

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function accountPhoneIdentity(value: unknown): string {
  const phone = String(value ?? "").trim();
  if (/^account:/i.test(phone)) return "";
  const digits = phone.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 9) return `351${digits}`;
  return digits.length >= 9 && digits.length <= 15 ? digits : "";
}

export function authorizeAccountBookingContact(
  metadata: unknown, studioId: string, phone: string, acceptedAt: string,
): Record<string, unknown> {
  const current = metadataRecord(metadata);
  const authorizations = metadataRecord(current[ACCOUNT_CONTACT_AUTHORIZATIONS_KEY]);
  return {
    ...current,
    bellza_booking_phone: phone,
    [ACCOUNT_CONTACT_AUTHORIZATIONS_KEY]: {
      ...authorizations,
      [studioId]: { phone, acceptedAt, version: ACCOUNT_CONTACT_CONSENT_VERSION },
    },
  };
}

export function changeAccountBookingPhone(
  metadata: unknown, studioId: string, phone: string,
): Record<string, unknown> {
  const current = metadataRecord(metadata);
  const authorizations = { ...metadataRecord(current[ACCOUNT_CONTACT_AUTHORIZATIONS_KEY]) };
  if (accountPhoneIdentity(readAccountPreferredPhone(current)) !== accountPhoneIdentity(phone)) {
    delete authorizations[studioId];
  }
  return { ...current, bellza_booking_phone: phone,
    [ACCOUNT_CONTACT_AUTHORIZATIONS_KEY]: authorizations };
}

export function hasAccountBookingContactAuthorization(
  metadata: unknown, studioId: string, phone: string,
): boolean {
  const current = metadataRecord(metadata);
  const authorizations = metadataRecord(current[ACCOUNT_CONTACT_AUTHORIZATIONS_KEY]);
  const authorization = metadataRecord(authorizations[studioId]);
  return authorization.version === ACCOUNT_CONTACT_CONSENT_VERSION &&
    typeof authorization.acceptedAt === "string" &&
    Number.isFinite(Date.parse(authorization.acceptedAt)) &&
    accountPhoneIdentity(authorization.phone) !== "" &&
    accountPhoneIdentity(authorization.phone) === accountPhoneIdentity(phone);
}

export function chooseAccountBookingContactRecipient(input: {
  studioId: string;
  authUserId: string;
  metadata: unknown;
  ownedClients: Array<{
    studio_id: string;
    auth_user_id: string | null;
    phone: string | null;
    contact_consent_at: string | null;
    contact_consent_version: string | null;
  }>;
}): string | null {
  const preferred = readAccountPreferredPhone(input.metadata);
  const ownedConsentedPhones = input.ownedClients
    .filter((client) => client.studio_id === input.studioId &&
      client.auth_user_id === input.authUserId &&
      Boolean(client.contact_consent_at) &&
      client.contact_consent_version === ACCOUNT_CONTACT_CONSENT_VERSION)
    .map((client) => client.phone ?? "")
    .filter((phone) => accountPhoneIdentity(phone) !== "");
  if (preferred) {
    const key = accountPhoneIdentity(preferred);
    return hasAccountBookingContactAuthorization(input.metadata, input.studioId, preferred) ||
      ownedConsentedPhones.some((phone) => accountPhoneIdentity(phone) === key)
      ? preferred : null;
  }
  const distinct = new Set(ownedConsentedPhones.map(accountPhoneIdentity));
  return distinct.size === 1 ? ownedConsentedPhones[0] : null;
}
