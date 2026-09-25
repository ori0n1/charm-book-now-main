import { createFileRoute } from "@tanstack/react-router";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { BELLZA_APP_ICON_SVG } from "@/lib/brand-assets";

export const Route = createFileRoute("/api/public/studio-manifest/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { slug } = params;
        try {
          const supabase = getAdminClient();
          const { data } = await supabase
            .from("studios")
            .select("name, logo_url, brand_color, updated_at")
            .eq("slug", slug)
            .eq("is_active", true)
            .maybeSingle();

          if (!data) {
            return Response.json({ error: "not_found" }, { status: 404 });
          }

          const studioName = data.name;
          const shortName =
            studioName.length > 12 ? studioName.split(/\s+/)[0] : studioName;
          const manifestVersion = encodeURIComponent(data.updated_at ?? new Date().toISOString());
          const iconSrc = data.logo_url
            ? withAssetVersion(data.logo_url, manifestVersion)
            : BELLZA_APP_ICON_SVG;
          const iconType = iconSrc.split("?")[0].toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png";
          // Use the studio brand color if available, fallback to a neutral app color.
          const themeColor = data?.brand_color ?? "#111318";

          // Derive base URL from request so start_url is absolute — required by
          // some browsers for PWA install and home-screen launch to work correctly.
          const origin = new URL(request.url).origin;
          const startUrl = `${origin}/s/${slug}`;
          const scope = `${origin}/`;

          const manifest = {
            name: studioName,
            short_name: shortName,
            description: `Reserve em ${studioName}`,
            id: `/s/${slug}`,
            start_url: startUrl,
            scope,
            display: "standalone",
            background_color: "#f7f3ed",
            theme_color: themeColor,
            orientation: "portrait",
            lang: "pt-PT",
            manifest_version: data.updated_at,
            icons: [
              {
                src: iconSrc,
                sizes: iconType === "image/svg+xml" ? "any" : "512x512",
                type: iconType,
                purpose: "any maskable",
              },
            ],
          };

          return new Response(JSON.stringify(manifest), {
            headers: {
              "Content-Type": "application/manifest+json",
              // Dynamic manifests must not stay stale in already-installed PWAs.
              // iOS/Android may keep the home-screen icon until the OS refreshes
              // the installed web app, but the app content, theme and manifest
              // endpoint are always fetched fresh on launch/navigation.
              "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
              Pragma: "no-cache",
              Expires: "0",
              ETag: `"studio-manifest-${slug}-${manifestVersion}"`,
            },
          });
        } catch {
          return Response.json({ error: "not_found" }, { status: 404 });
        }
      },
    },
  },
});

function withAssetVersion(url: string, version: string) {
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${version}`;
}
