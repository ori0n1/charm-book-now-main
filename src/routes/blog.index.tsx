import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BookOpenText, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { BlogCard } from "@/components/blog/blog-card";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { APP_BRAND } from "@/lib/app-brand";
import {
  BLOG_BASE_URL,
  blogArticles,
  blogCategories,
  featuredBlogArticles,
  getBreadcrumbSchema,
} from "@/lib/blog";

const BLOG_TITLE = "Blog Bellza | Gestão, agenda online e crescimento para estúdios";
const BLOG_DESCRIPTION =
  "Guias simples para estúdios de beleza, manicure, estética e barbearias captarem clientes, reduzirem faltas e organizarem a gestão.";

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: BLOG_TITLE },
      { name: "description", content: BLOG_DESCRIPTION },
      {
        name: "keywords",
        content:
          "blog Bellza, sistema para salão, sistema para estúdio de beleza, agenda online, gestão de salão, software para beleza",
      },
      { property: "og:title", content: BLOG_TITLE },
      { property: "og:description", content: BLOG_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: APP_BRAND.name },
      { property: "og:url", content: `${BLOG_BASE_URL}/blog` },
      { property: "og:image", content: `${BLOG_BASE_URL}/blog/capas/organizar-estudio-tecnologia.jpg` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: BLOG_TITLE },
      { name: "twitter:description", content: BLOG_DESCRIPTION },
      { name: "twitter:image", content: `${BLOG_BASE_URL}/blog/capas/organizar-estudio-tecnologia.jpg` },
      { name: "robots", content: "index,follow,max-image-preview:large" },
    ],
    links: [
      { rel: "canonical", href: `${BLOG_BASE_URL}/blog` },
      { rel: "alternate", type: "application/rss+xml", title: "Blog Bellza", href: `${BLOG_BASE_URL}/rss.xml` },
    ],
  }),
  component: BlogIndexPage,
});

function BlogIndexPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todos");
  const [visible, setVisible] = useState(6);

  const filteredArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return blogArticles.filter((article) => {
      const matchesCategory = category === "Todos" || article.category === category;
      const searchable = [
        article.title,
        article.description,
        article.excerpt,
        article.category,
        article.keywords.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [category, query]);

  const visibleArticles = filteredArticles.slice(0, visible);

  return (
    <div className="public-shell min-h-screen overflow-x-hidden">
      <div className="public-grid-bg pointer-events-none fixed inset-0 opacity-35" aria-hidden="true" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(getBreadcrumbSchema()) }}
      />
      <LandingHeader />

      <main>
        <section className="relative mx-auto max-w-7xl px-4 pb-10 pt-10 sm:px-6 sm:pb-14 sm:pt-16">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur">
              <BookOpenText className="size-3.5 text-accent" aria-hidden="true" />
              Blog Bellza
            </div>
            <h1 className="mt-6 text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
              Guias simples para crescer o seu estúdio.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Conteúdos práticos sobre agenda online, gestão de salão, captação de clientes e tecnologia para beleza.
            </p>
          </div>

          <div className="mt-9 rounded-[1.45rem] border border-border/80 bg-card/74 p-3 shadow-sm shadow-black/5 backdrop-blur sm:p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <label className="relative block">
                <span className="sr-only">Pesquisar artigos</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setVisible(6);
                  }}
                  placeholder="Pesquisar por agenda, clientes, marketing..."
                  className="h-12 w-full rounded-2xl border border-border/80 bg-background/80 pl-11 pr-4 text-sm font-medium outline-none transition focus:border-foreground/35 focus:ring-2 focus:ring-foreground/10"
                />
              </label>
              <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {["Todos", ...blogCategories].map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setCategory(item);
                      setVisible(6);
                    }}
                    className={`h-11 shrink-0 rounded-2xl border px-4 text-xs font-bold uppercase tracking-[0.13em] transition ${
                      category === item
                        ? "border-foreground bg-foreground text-background shadow-lg shadow-black/15"
                        : "border-border/80 bg-background/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {featuredBlogArticles.length > 0 && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">Destaques</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">Comece por aqui</h2>
              </div>
              <Sparkles className="hidden size-5 text-accent sm:block" />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {featuredBlogArticles.slice(0, 3).map((article) => (
                <BlogCard key={article.slug} article={article} compact />
              ))}
            </div>
          </section>
        )}

        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:pb-16">
          <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">Artigos recentes</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Estratégias para o dia a dia</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {filteredArticles.length} artigo{filteredArticles.length === 1 ? "" : "s"}
            </p>
          </div>

          {visibleArticles.length > 0 ? (
            <>
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {visibleArticles.map((article) => (
                  <BlogCard key={article.slug} article={article} />
                ))}
              </div>
              {visible < filteredArticles.length && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisible((current) => current + 6)}
                    className="public-btn-primary h-12 px-6"
                  >
                    Carregar mais artigos
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-[1.45rem] border border-dashed border-border bg-card/60 p-8 text-center">
              <h2 className="text-xl font-semibold">Nenhum artigo encontrado</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Experimente pesquisar por agenda online, clientes ou gestão de salão.
              </p>
            </div>
          )}
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          <div className="rounded-[1.65rem] border border-border/80 bg-foreground p-6 text-background shadow-xl shadow-black/10 sm:p-8 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-background/50">Bellza</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">Transforme leitura em ação.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-background/68">
                Use a Bellza para organizar agenda, clientes, profissionais e comunicação num painel simples e premium.
              </p>
            </div>
            <Link
              to="/signup"
              search={{ ref: undefined }}
              className="mt-5 inline-flex h-12 items-center justify-center rounded-full bg-background px-6 text-sm font-bold text-foreground transition hover:-translate-y-0.5 md:mt-0"
            >
              Criar conta
            </Link>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
