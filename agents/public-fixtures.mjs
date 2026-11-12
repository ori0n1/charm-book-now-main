const rootHtml = '<html><link href="/assets/styles-FAKE.css"><link href="/assets/index-FAKE.js"><main>Bellza</main></html>';
const studioHtml = '<html><link href="/assets/styles-FAKE.css"><link href="/assets/index-FAKE.js"><link href="/assets/s._slug-FAKE.js"><h1>marcação online</h1>A carregar estúdio... SYNTHETIC_PRIVATE_MARKER</html>';

export function publicFixture(scenario = "healthy") {
  if (!["healthy", "studio-failure", "resource-failure", "network-failure"].includes(scenario))
    throw new Error("INVALID_PUBLIC_SCENARIO");
  return async (url, options) => {
    if (!["GET", "HEAD"].includes(options.method) || options.redirect !== "manual" ||
        options.credentials !== "omit") throw new Error("UNSAFE_PUBLIC_FIXTURE_REQUEST");
    const path = new URL(url).pathname;
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
    return new Response(path === "/" ? rootHtml : studioHtml, {
      status: 200, headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}
