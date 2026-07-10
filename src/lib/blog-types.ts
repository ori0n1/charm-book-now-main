export type BlogSection = {
  id: string;
  heading: string;
  eyebrow?: string;
  paragraphs: string[];
  bullets?: string[];
};

export type BlogArticle = {
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  category: string;
  keywords: string[];
  publishedAt: string;
  updatedAt?: string;
  author: string;
  coverImage: string;
  coverAlt: string;
  featured?: boolean;
  sections: BlogSection[];
  conclusion: string[];
  cta: {
    title: string;
    body: string;
    label: string;
    href: string;
  };
  relatedSlugs: string[];
};
