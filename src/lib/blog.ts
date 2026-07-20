import { APP_BRAND, CANONICAL_ORIGIN } from "@/lib/app-brand";
import type { BlogArticle } from "@/lib/blog-types";

type ArticleModule = { default: BlogArticle };

const articleModules = import.meta.glob("../../content/blog/*.ts", {
  eager: true,
}) as Record<string, ArticleModule>;

export const BLOG_BASE_URL = CANONICAL_ORIGIN;

function normalizeArticle(article: BlogArticle) {
  return {
    ...article,
    url: `/blog/${article.slug}`,
    absoluteUrl: `${BLOG_BASE_URL}/blog/${article.slug}`,
    readingMinutes: getReadingMinutes(article),
    updatedAt: article.updatedAt ?? article.publishedAt,
  };
}

export type NormalizedBlogArticle = ReturnType<typeof normalizeArticle>;

export const blogArticles = Object.values(articleModules)
  .map((module) => normalizeArticle(module.default))
  .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

export const blogCategories = Array.from(new Set(blogArticles.map((article) => article.category))).sort();

export const featuredBlogArticles = blogArticles.filter((article) => article.featured);

export function getBlogArticle(slug: string) {
  return blogArticles.find((article) => article.slug === slug) ?? null;
}

export function getRelatedBlogArticles(article: NormalizedBlogArticle, limit = 3) {
  const related = article.relatedSlugs
    .map((slug) => getBlogArticle(slug))
    .filter(Boolean) as NormalizedBlogArticle[];
  const fallback = blogArticles.filter(
    (candidate) =>
      candidate.slug !== article.slug &&
      candidate.category === article.category &&
      !related.some((item) => item.slug === candidate.slug),
  );
  return [...related, ...fallback].slice(0, limit);
}

export function getBlogArticleText(article: BlogArticle) {
  return [
    article.title,
    article.seoTitle ?? "",
    article.description,
    article.seoDescription ?? "",
    article.excerpt,
    ...article.sections.flatMap((section) => [
      section.heading,
      ...section.paragraphs,
      ...(section.bullets ?? []),
      ...(section.subsections ?? []).flatMap((subsection) => [
        subsection.heading,
        ...subsection.paragraphs,
        ...(subsection.bullets ?? []),
      ]),
    ]),
    ...article.conclusion,
    ...(article.faq ?? []).flatMap((item) => [item.question, item.answer]),
    article.cta.title,
    article.cta.body,
  ].join(" ");
}

export function getReadingMinutes(article: BlogArticle) {
  const words = getBlogArticleText(article).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 190));
}

export function formatBlogDate(value: string) {
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function getArticleSchema(article: NormalizedBlogArticle) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.seoDescription ?? article.description,
    image: `${BLOG_BASE_URL}${article.coverImage}`,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: {
      "@type": "Organization",
      name: article.author,
    },
    publisher: {
      "@type": "Organization",
      name: APP_BRAND.name,
      logo: {
        "@type": "ImageObject",
        url: `${BLOG_BASE_URL}/bellza-logo.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": article.absoluteUrl,
    },
  };
}

export function getArticleFAQSchema(article: NormalizedBlogArticle) {
  if (!article.faq?.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: article.faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function getBreadcrumbSchema(article?: NormalizedBlogArticle) {
  const items = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Início",
      item: `${BLOG_BASE_URL}/`,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Blog",
      item: `${BLOG_BASE_URL}/blog`,
    },
  ];

  if (article) {
    items.push({
      "@type": "ListItem",
      position: 3,
      name: article.title,
      item: article.absoluteUrl,
    });
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
