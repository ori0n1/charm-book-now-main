// These permanent QA studios may be active for authenticated testing, but must
// never appear in unauthenticated studio discovery or public booking flows.
const QA_STUDIO_IDS = new Set([
  "e2663064-7774-41c5-95cb-e5e6afc4fab4",
  "2cc1683e-ab91-4488-a702-6a8feb60f379",
]);

const QA_STUDIO_SLUGS = new Set([
  "bellza-qa-e2663064",
  "bellza-qa-b",
]);

export function isExcludedQaStudio(studio: { id?: string | null; slug?: string | null }): boolean {
  return (typeof studio.id === "string" && QA_STUDIO_IDS.has(studio.id.toLowerCase()))
    || (typeof studio.slug === "string" && QA_STUDIO_SLUGS.has(studio.slug.toLowerCase()));
}

export function isExcludedFromSearchIndex(studio: { id?: string | null; slug?: string | null }): boolean {
  return isExcludedQaStudio(studio)
    || studio.slug?.toLowerCase() === "bellza-studio-demo";
}
