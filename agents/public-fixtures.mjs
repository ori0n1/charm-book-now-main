const routeStem = (path) => path === "/" ? "index" : path === "/blog" ? "blog.index" :
  path.startsWith("/blog/") ? "blog._slug" : path.startsWith("/s/") ? "s._slug" : path.slice(1);
const fixtureHtml = (path) => `<html><link href="/assets/styles-FAKE.css">` +
  `<link href="/assets/index-FAKE.js"><link href="/assets/${routeStem(path)}-FAKE.js">` +
  (path.startsWith("/s/") ? '<h1>marcação online</h1>A carregar estúdio... SYNTHETIC_PRIVATE_MARKER' :
    '<main>Bellza</main>') + '</html>';
const sitemap = `<?xml version="1.0"?><urlset>${[
  "/", "/blog", "/contacto", "/privacidade", "/cookies", "/termos", "/rgpd",
  "/politica-cancelamento", "/politica-reembolso", "/s/capivarabarbearia",
  "/s/studio27braga", "/s/outroestudio", "/blog/post-sintetico",
].map((path) => `<url><loc>https://bellza.pt${path}</loc></url>`).join("")}</urlset>`;

export function publicFixture(scenario = "healthy") {
  if (!["healthy", "studio-failure", "resource-failure", "network-failure"].includes(scenario))
    throw new Error("INVALID_PUBLIC_SCENARIO");
  return async (url, options) => {
    if (!["GET", "HEAD"].includes(options.method) || options.redirect !== "manual" ||
        options.credentials !== "omit") throw new Error("UNSAFE_PUBLIC_FIXTURE_REQUEST");
    const path = new URL(url).pathname;
    if (path === "/sitemap.xml") return new Response(sitemap, {
      status: 200, headers: { "content-type": "application/xml" },
    });
    if (scenario === "network-failure" && path === "/s/studio27braga")
      throw new Error("SYNTHETIC_NETWORK_FAILURE");
    if (scenario === "studio-failure" && path === "/s/studio27braga")
      return new Response("", { status: 503 });
    if (scenario === "resource-failure" && path === "/assets/s._slug-FAKE.js")
      return new Response("", { status: 404 });
    if (options.method === "HEAD") return new Response(null, {
      status: 200, headers: { "content-type": path.endsWith(".css")
        ? "text/css" : "text/javascript" },
    });
    return new Response(fixtureHtml(path), {
      status: 200, headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}
