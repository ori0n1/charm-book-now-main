const paths = ["/", "/login", "/signup", "/forgot-password", "/blog",
  "/contacto", "/s/capivarabarbearia", "/s/studio27braga"];
const sitemap = `<?xml version="1.0"?><urlset>${paths.map((path) =>
  `<url><loc>https://bellza.pt${path}</loc></url>`).join("")}</urlset>`;

export function visualFixture(scenario = "healthy") {
  if (!["healthy", "js-error", "missing-main", "asset-404", "offline",
    "mobile-overflow"].includes(scenario)) throw new Error("INVALID_VISUAL_SCENARIO");
  const fetchImpl = async (url, options) => {
    if (url !== "https://bellza.pt/sitemap.xml" || options.method !== "GET")
      throw new Error("UNSAFE_FIXTURE_FETCH");
    return new Response(sitemap, { status: 200,
      headers: { "content-type": "application/xml" } });
  };
  const routeResponder = async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(".css")) {
      await route.fulfill({ status: scenario === "asset-404" ? 404 : 200,
        contentType: "text/css", body: "main{min-height:100px}" });
      return;
    }
    if (path.endsWith(".js")) {
      await route.fulfill({ status: 200, contentType: "text/javascript",
        body: scenario === "js-error" ? 'throw new Error("SYNTHETIC_ONLY")' : "" });
      return;
    }
    const studio = path.startsWith("/s/");
    const main = scenario === "missing-main" ? "<div>synthetic fixture</div>" :
      `<main${scenario === "mobile-overflow" ? ' style="width:900px"' : ""}>` +
      `<h1>Fixture pública</h1>${studio ? "A carregar estúdio" : "Conteúdo público"}` +
      `${path === "/login" ? "<form></form>" : ""}` +
      `${path === "/" ? '<a href="/login">Login</a><a href="/signup">Signup</a>' : ""}</main>`;
    await route.fulfill({ status: scenario === "offline" ? 503 : 200,
      contentType: "text/html", body: `<html><head><link rel="stylesheet" href="/assets/fixture.css"></head><body>${main}<script src="/assets/fixture.js"></script></body></html>` });
  };
  return { fetchImpl, routeResponder };
}
