import { createFileRoute } from "@tanstack/react-router";
import { BLOG_BASE_URL, blogArticles, escapeXml } from "@/lib/blog";

type SitemapUrl = {
  loc: string;
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
  priority: string;
  lastmod?: string;
};

const STATIC_URLS: SitemapUrl[] = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/blog", changefreq: "weekly", priority: "0.8" },
  { loc: "/contacto", changefreq: "monthly", priority: "0.5" },
  { loc: "/privacidade", changefreq: "yearly", priority: "0.3" },
  { loc: "/cookies", changefreq: "yearly", priority: "0.3" },
  { loc: "/termos", changefreq: "yearly", priority: "0.3" },
  { loc: "/rgpd", changefreq: "yearly", priority: "0.3" },
  { loc: "/politica-cancelamento", changefreq: "yearly", priority: "0.3" },
  { loc: "/politica-reembolso", changefreq: "yearly", priority: "0.3" },
];

async function getPublicStudioUrls(): Promise<SitemapUrl[]> {
  try {
    const { getAdminClient } = await import("@/lib/supabase-admin.server");
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("studios")
      .select("slug,updated_at")
      .eq("is_active", true)
      .not("slug", "is", null)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (error || !data) {
      if (error) console.error("sitemap_studios_query_failed", error.message);
      return [];
    }

    return data
      .map((studio) => ({
        loc: `/s/${String(studio.slug).trim().toLowerCase()}`,
        changefreq: "weekly" as const,
        priority: "0.6",
        lastmod: typeof studio.updated_at === "string" ? studio.updated_at.slice(0, 10) : undefined,
      }))
      .filter((url) => /^\/s\/[a-z0-9][a-z0-9-]*$/.test(url.loc));
  } catch (error) {
    console.error("sitemap_studios_unavailable", error instanceof Error ? error.message : error);
    return [];
  }
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const publicStudios = await getPublicStudioUrls();
        const urls = [
          ...STATIC_URLS,
          ...blogArticles.map((article) => ({
            loc: `/blog/${article.slug}`,
            changefreq: "monthly" as const,
            priority: article.featured ? "0.7" : "0.6",
            lastmod: article.updatedAt,
          })),
          ...publicStudios,
        ];

        const entries = urls
          .map((url) => {
            const lastmod = url.lastmod ? `\n    <lastmod>${escapeXml(url.lastmod)}</lastmod>` : "";
            return `  <url>
    <loc>${escapeXml(`${BLOG_BASE_URL}${url.loc}`)}</loc>${lastmod}
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`;
          })
          .join("\n");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;

        return new Response(xml, {
          headers: {
            "cache-control": "public, max-age=3600",
            "content-type": "application/xml; charset=utf-8",
          },
        });
      },
    },
  },
});
