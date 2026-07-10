import { createFileRoute } from "@tanstack/react-router";
import { BLOG_BASE_URL, blogArticles, escapeXml } from "@/lib/blog";

export const Route = createFileRoute("/rss.xml")({
  server: {
    handlers: {
      GET: async () => {
        const updatedAt = blogArticles[0]?.updatedAt ?? new Date().toISOString();
        const items = blogArticles
          .map(
            (article) => `
    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${escapeXml(article.absoluteUrl)}</link>
      <guid>${escapeXml(article.absoluteUrl)}</guid>
      <description>${escapeXml(article.description)}</description>
      <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>
      <author>${escapeXml(article.author)}</author>
      <category>${escapeXml(article.category)}</category>
      <enclosure url="${escapeXml(`${BLOG_BASE_URL}${article.coverImage}`)}" type="image/jpeg" />
    </item>`,
          )
          .join("");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Blog Bellza</title>
    <link>${BLOG_BASE_URL}/blog</link>
    <description>Conteúdos simples para ajudar estúdios de beleza a organizar agenda, clientes e crescimento.</description>
    <language>pt-PT</language>
    <lastBuildDate>${new Date(updatedAt).toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;

        return new Response(xml, {
          headers: {
            "cache-control": "public, max-age=3600",
            "content-type": "application/rss+xml; charset=utf-8",
          },
        });
      },
    },
  },
});
