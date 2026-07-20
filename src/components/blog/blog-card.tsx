import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { formatBlogDate, type NormalizedBlogArticle } from "@/lib/blog";

export function BlogCard({
  article,
  compact = false,
}: {
  article: NormalizedBlogArticle;
  compact?: boolean;
}) {
  return (
    <article className="public-card group overflow-hidden transition duration-200 hover:-translate-y-1 hover:border-accent/40 hover:shadow-lg">
      <Link to="/blog/$slug" params={{ slug: article.slug }} className="block">
        <div className="relative aspect-[16/9] overflow-hidden bg-muted">
          <img
            src={article.coverImage}
            alt={article.coverAlt}
            loading={article.featured ? "eager" : "lazy"}
            decoding="async"
            width={1200}
            height={675}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
          />
          <div className="absolute left-3 top-3 rounded-full border border-border bg-card/90 px-3 py-1 text-[10px] font-semibold text-foreground shadow-sm backdrop-blur">
            {article.category}
          </div>
        </div>
        <div className={compact ? "p-4" : "p-5 sm:p-6"}>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted-foreground">
            <span>{formatBlogDate(article.publishedAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3.5" />
              {article.readingMinutes} min
            </span>
          </div>
          <h2 className="mt-3 text-xl font-semibold leading-tight tracking-tight text-foreground">
            {article.title}
          </h2>
          <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {article.excerpt}
          </p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent">
            Ler artigo
            <ArrowUpRight className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </div>
      </Link>
    </article>
  );
}
