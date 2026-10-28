export type GooglePlace = { id: string; name: string; address: string };
export type GoogleReview = {
  id: string;
  rating: number;
  text: string;
  author: string;
  authorUri: string | null;
  publishedAt: string;
  uri: string | null;
};
export type GoogleReviewsState = {
  status: "disabled" | "disconnected" | "available" | "unavailable";
  rating: number | null;
  count: number;
  reviews: GoogleReview[];
  mapsUri: string | null;
};
