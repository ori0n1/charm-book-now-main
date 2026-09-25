import { expect, test } from "@playwright/test";
import {
  buildCspReportOnlyPolicy,
  getCanonicalRedirectLocation,
  isSensitivePublicPath,
  sanitizeCspReportUri,
  withCspReportOnly,
} from "../src/lib/http-security";

test("canonical edge redirect preserves path and query", () => {
  expect(
    getCanonicalRedirectLocation(new Request("http://bellza.pt/admin/agenda?range=week&studio=27")),
  ).toBe("https://bellza.pt/admin/agenda?range=week&studio=27");
  expect(
    getCanonicalRedirectLocation(new Request("https://www.bellza.pt/s/bellza?service=nails")),
  ).toBe("https://bellza.pt/s/bellza?service=nails");
  expect(
    getCanonicalRedirectLocation(new Request("http://www.bellza.pt/marcacao/example?step=2")),
  ).toBe("https://bellza.pt/marcacao/example?step=2");
  expect(getCanonicalRedirectLocation(new Request("http://127.0.0.1:4178/test?q=1"))).toBeNull();
});

test("sensitive public paths are rejected before the SPA fallback", () => {
  const blocked = [
    "/.git/config",
    "/%2egit/config",
    "/%252eenv",
    "/.env",
    "/.env.production",
    "/backups/database.sql.gz",
    "/.aws/credentials",
    "/aws_access_keys.csv",
    "/phpinfo.php",
    "/server-status",
    "/config.php",
  ];
  for (const pathname of blocked) expect(isSensitivePublicPath(pathname)).toBe(true);

  for (const pathname of ["/", "/s/bellza", "/blog/seguranca", "/assets/app.js"])
    expect(isSensitivePublicPath(pathname)).toBe(false);
});

test("CSP remains report-only, scoped and free of unsafe-eval", () => {
  const policy = buildCspReportOnlyPolicy("test-nonce");
  for (const directive of [
    "default-src",
    "script-src",
    "style-src",
    "img-src",
    "connect-src",
    "font-src",
    "worker-src",
    "manifest-src",
    "frame-src",
    "base-uri",
    "object-src",
    "frame-ancestors",
    "form-action",
  ]) {
    expect(policy).toContain(`${directive} `);
  }
  expect(policy).toContain("'nonce-test-nonce'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).not.toContain("data:");
  expect(policy).not.toContain("posthog");
  expect(policy).not.toMatch(/(?:^|; )[^;]*\shttps:(?:\s|;|$)/);
});

test("CSP report URI sanitizer drops query, fragment and capability values", () => {
  expect(
    sanitizeCspReportUri(
      "https://bellza.pt/marcacao/private-token?access_token=sensitive#confirmation",
    ),
  ).toBe("https://bellza.pt/marcacao");
  expect(
    sanitizeCspReportUri(
      "https://pwmdzpvnatrvfpgcvnzg.supabase.co/storage/v1/object/public/client-name.jpg?token=x",
    ),
  ).toBe("https://pwmdzpvnatrvfpgcvnzg.supabase.co/storage");
  expect(sanitizeCspReportUri("data:text/plain,secret")).toBe("data:");
  expect(sanitizeCspReportUri("not a URL?token=secret")).toBeNull();
});

test("local HTML serves report-only CSP and nonces every inline script", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);

  const headers = response.headers();
  const policy = headers["content-security-policy-report-only"];
  expect(policy).toBeTruthy();
  expect(headers["content-security-policy"]).toBeUndefined();
  expect(headers["strict-transport-security"]).toBeUndefined();

  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const html = await response.text();
  const inlineScripts = html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) ?? [];
  expect(inlineScripts.length).toBeGreaterThan(2);
  for (const openingTag of inlineScripts) {
    expect(openingTag).toContain(`nonce="${nonce}"`);
  }
  expect(html).toContain('type="application/ld+json"');

  const synthetic = await withCspReportOnly(
    new Request("https://bellza.pt/"),
    new Response('<script src="/app.js"></script><script>window.inline = true</script>', {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
  const syntheticPolicy = synthetic.headers.get("content-security-policy-report-only") ?? "";
  const syntheticNonce = syntheticPolicy.match(/'nonce-([^']+)'/)?.[1];
  const syntheticHtml = await synthetic.text();
  expect(syntheticHtml).toContain('<script src="/app.js">');
  expect(syntheticHtml).not.toContain(`<script nonce="${syntheticNonce}" src="/app.js">`);
  expect(syntheticHtml).toContain(`<script nonce="${syntheticNonce}">window.inline`);
});

test("local runtime returns 404 for sensitive files instead of the SPA shell", async ({
  request,
}) => {
  for (const pathname of [
    "/.git/config",
    "/.env",
    "/backups/prod.sql",
    "/.aws/credentials",
    "/phpinfo.php",
  ]) {
    const response = await request.get(pathname, { maxRedirects: 0 });
    expect(response.status(), pathname).toBe(404);
    expect(response.headers()["cache-control"], pathname).toBe("no-store");
    expect(await response.text(), pathname).toBe("Not Found");
  }
});

test("local edge runtime executes the canonical redirect", async ({ request }) => {
  const response = await request.get("/admin/agenda?range=week&studio=27", {
    headers: { Host: "www.bellza.pt" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe("https://bellza.pt/admin/agenda?range=week&studio=27");
});

test("CSP report endpoint validates and minimizes telemetry", async ({ request }) => {
  const report = await request.post("/api/security/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: {
      "csp-report": {
        "document-uri": "http://127.0.0.1:4178/marcacao/private-token?token=secret#fragment",
        "blocked-uri": "https://example.invalid/private/name.jpg?signature=secret#fragment",
        "effective-directive": "img-src",
        "status-code": 200,
        "script-sample": "must never be logged",
      },
    },
  });
  expect(report.status()).toBe(204);
  expect(report.headers()["cache-control"]).toBe("no-store");

  const invalid = await request.post("/api/security/csp-report", {
    headers: { "content-type": "text/plain" },
    data: "invalid",
  });
  expect(invalid.status()).toBe(415);
});

test("CSP report endpoint enforces body and request limits", async ({ request }, testInfo) => {
  const rateLimitIp =
    {
      chromium: "198.51.100.71",
      firefox: "198.51.100.72",
      webkit: "198.51.100.73",
    }[testInfo.project.name] ?? "198.51.100.74";
  const oversized = await request.post("/api/security/csp-report", {
    headers: {
      "content-type": "application/csp-report",
      "cf-connecting-ip": "198.51.100.70",
    },
    data: "x".repeat(17_000),
  });
  expect(oversized.status()).toBe(413);

  let lastStatus = 0;
  for (let attempt = 0; attempt < 31; attempt += 1) {
    const response = await request.post("/api/security/csp-report", {
      headers: {
        "content-type": "application/csp-report",
        "cf-connecting-ip": rateLimitIp,
      },
      data: "not-json",
    });
    lastStatus = response.status();
    if (attempt < 30) expect(lastStatus).toBe(400);
  }
  expect(lastStatus).toBe(429);
});
