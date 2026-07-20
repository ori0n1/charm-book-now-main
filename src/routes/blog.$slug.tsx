import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, Clock3, Home } from "lucide-react";
import { BlogCard } from "@/components/blog/blog-card";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { APP_BRAND } from "@/lib/app-brand";
import {
  BLOG_BASE_URL,
  getArticleFAQSchema,
  formatBlogDate,
  getArticleSchema,
  getBlogArticle,
  getBreadcrumbSchema,
  getRelatedBlogArticles,
} from "@/lib/blog";

export const Route = createFileRoute("/blog/$slug")({
  head: ({ params }) => {
    const article = getBlogArticle(params.slug);
    if (!article) {
      return {
        meta: [
          { title: `Artigo não encontrado | ${APP_BRAND.name}` },
          { name: "robots", content: "noindex,follow" },
        ],
      };
    }

    const seoTitle = article.seoTitle ?? `${article.title} | Blog Bellza`;
    const seoDescription = article.seoDescription ?? article.description;

    return {
      meta: [
        { title: seoTitle },
        { name: "description", content: seoDescription },
        { name: "keywords", content: article.keywords.join(", ") },
        { property: "og:title", content: seoTitle },
        { property: "og:description", content: seoDescription },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: APP_BRAND.name },
        { property: "og:url", content: article.absoluteUrl },
        { property: "og:image", content: `${BLOG_BASE_URL}${article.coverImage}` },
        { property: "og:image:alt", content: article.coverAlt },
        { property: "article:published_time", content: article.publishedAt },
        { property: "article:modified_time", content: article.updatedAt },
        { property: "article:author", content: article.author },
        { property: "article:section", content: article.category },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: article.title },
        { name: "twitter:description", content: article.description },
        { name: "twitter:image", content: `${BLOG_BASE_URL}${article.coverImage}` },
        { name: "robots", content: "index,follow,max-image-preview:large" },
      ],
      links: [
        { rel: "canonical", href: article.absoluteUrl },
        { rel: "preload", as: "image", href: article.coverImage },
      ],
    };
  },
  component: BlogArticlePage,
});

function BlogArticlePage() {
  const { slug } = Route.useParams();
  const article = getBlogArticle(slug);

  if (!article) {
    return (
      <div className="public-shell public-site-theme min-h-screen">
        <LandingHeader />
        <main className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
          <h1 className="text-3xl font-semibold tracking-tight">Artigo não encontrado</h1>
          <p className="mt-3 text-muted-foreground">Este conteúdo pode ter sido removido ou alterado.</p>
          <Link to="/blog" className="public-btn-primary mt-8 h-12 px-6">
            Voltar ao Blog
          </Link>
        </main>
        <LandingFooter />
      </div>
    );
  }

  const related = getRelatedBlogArticles(article);
  const faqSchema = getArticleFAQSchema(article);

  return (
    <div className="public-shell public-site-theme min-h-screen overflow-x-hidden">
      <div className="public-grid-bg pointer-events-none fixed inset-0 opacity-35" aria-hidden="true" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(getArticleSchema(article)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(getBreadcrumbSchema(article)) }}
      />
      {faqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      )}
      <LandingHeader />

      <main>
        <article>
          <header className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 sm:pb-12 sm:pt-14">
            <nav className="mb-7 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Link to="/" className="inline-flex items-center gap-1 hover:text-foreground">
                <Home className="size-3.5" />
                Início
              </Link>
              <span>/</span>
              <Link to="/blog" className="hover:text-foreground">
                Blog
              </Link>
              <span>/</span>
              <span className="text-foreground">{article.category}</span>
            </nav>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(24rem,0.72fr)] lg:items-center">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur">
                  {article.category}
                </div>
                <h1 className="mt-5 text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
                  {article.title}
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                  {article.description}
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3 text-sm font-semibold text-muted-foreground">
                  <span>{article.author}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-4" />
                    {formatBlogDate(article.publishedAt)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 className="size-4" />
                    {article.readingMinutes} min de leitura
                  </span>
                </div>
              </div>

              <div className="public-card overflow-hidden">
                <img
                  src={article.coverImage}
                  alt={article.coverAlt}
                  width={1200}
                  height={675}
                  loading="eager"
                  decoding="async"
                  className="aspect-[16/9] h-full w-full object-cover"
                />
              </div>
            </div>
          </header>

          <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-14 sm:px-6 lg:grid-cols-[16rem_minmax(0,44rem)_16rem] lg:items-start">
            <aside className="lg:sticky lg:top-24">
              <div className="public-card p-4">
                <p className="public-section-label">
                  Índice
                </p>
                <ol className="mt-4 grid gap-2 text-sm font-semibold text-muted-foreground">
                  {article.sections.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`} className="transition hover:text-foreground">
                        {section.heading}
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            </aside>

            <div className="min-w-0">
              <div className="public-card p-5 sm:p-8">
                <p className="text-lg font-medium leading-relaxed text-foreground/85">
                  {article.excerpt}
                </p>

                <div className="mt-8 space-y-10">
                  {article.sections.map((section) => (
                    <section key={section.id} id={section.id} className="scroll-mt-28">
                      {section.eyebrow && (
                        <p className="public-section-label">
                          {section.eyebrow}
                        </p>
                      )}
                      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                        {section.heading}
                      </h2>
                      <div className="mt-4 space-y-4 text-base leading-relaxed text-muted-foreground">
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                      </div>
                      {section.bullets && (
                        <ul className="mt-5 grid gap-3">
                          {section.bullets.map((item) => (
                            <li
                              key={item}
                              className="rounded-2xl border border-border bg-muted/45 px-4 py-3 text-sm font-semibold text-foreground"
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      )}
                      {section.subsections?.map((subsection) => (
                        <section key={subsection.id} id={subsection.id} className="mt-6 scroll-mt-28">
                          <h3 className="text-xl font-semibold tracking-tight">
                            {subsection.heading}
                          </h3>
                          <div className="mt-3 space-y-3 text-base leading-relaxed text-muted-foreground">
                            {subsection.paragraphs.map((paragraph) => (
                              <p key={paragraph}>{paragraph}</p>
                            ))}
                          </div>
                          {subsection.bullets && (
                            <ul className="mt-4 grid gap-2">
                              {subsection.bullets.map((item) => (
                                <li
                                  key={item}
                                  className="rounded-xl border border-border bg-muted/35 px-4 py-2.5 text-sm font-semibold text-foreground"
                                >
                                  {item}
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      ))}
                    </section>
                  ))}
                </div>

                <section className="mt-10 rounded-2xl border border-border bg-muted/45 p-5">
                  <h2 className="text-2xl font-semibold tracking-tight">Conclusão</h2>
                  <div className="mt-4 space-y-4 text-base leading-relaxed text-muted-foreground">
                    {article.conclusion.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </section>

                {article.faq?.length ? (
                  <section className="mt-8 rounded-2xl border border-border bg-muted/45 p-5">
                    <p className="public-section-label">Perguntas frequentes</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight">FAQ</h2>
                    <div className="mt-5 grid gap-4">
                      {article.faq.map((item) => (
                        <div key={item.question} className="rounded-xl border border-border bg-card/70 p-4">
                          <h3 className="text-base font-semibold tracking-tight">{item.question}</h3>
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="public-card public-final-cta mt-8 p-5 sm:p-6">
                  <h2 className="text-2xl font-semibold tracking-tight">{article.cta.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{article.cta.body}</p>
                  <a
                    href={article.cta.href}
                    className="public-btn-primary mt-5"
                  >
                    {article.cta.label}
                    <ArrowRight className="size-4" />
                  </a>
                </section>
              </div>
            </div>

            <aside className="hidden lg:block lg:sticky lg:top-24">
              <div className="public-card p-4">
                <p className="public-section-label">
                  Palavras-chave
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {article.keywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-full border border-border bg-muted/45 px-3 py-1 text-[11px] font-semibold text-muted-foreground"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            </aside>
          </section>
        </article>

        {related.length > 0 && (
          <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
            <div className="mb-5">
              <p className="public-section-label">Leia também</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Artigos relacionados</h2>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {related.map((item) => (
                <BlogCard key={item.slug} article={item} compact />
              ))}
            </div>
          </section>
        )}
      </main>

      <LandingFooter />
    </div>
  );
}
