const PRIVATE_RETURN_PATHS = ["/admin", "/onboarding"] as const;

export function sanitizePrivateReturnTo(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;

  try {
    const url = new URL(value, "https://bellza.invalid");
    if (url.origin !== "https://bellza.invalid" || url.hash) return undefined;
    const isAllowed = PRIVATE_RETURN_PATHS.some(
      (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
    );
    return isAllowed ? `${url.pathname}${url.search}` : undefined;
  } catch {
    return undefined;
  }
}
