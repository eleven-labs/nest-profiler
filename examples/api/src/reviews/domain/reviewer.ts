/**
 * The author of a review, as the reviews context knows it: a profile owned by an **external user
 * directory** (the jsonplaceholder API stands in for it), referenced by {@link Review.authorId}.
 * Nothing about it is persisted in MongoDB — it is resolved over HTTP when a client asks for it,
 * which is what makes a single `products` GraphQL query touch three sources at once: the SQL
 * catalog, the MongoDB reviews and this HTTP directory.
 */
export interface Reviewer {
  id: number;
  name: string;
  username: string;
  company: string;
}

/** Raw user shape returned by the external directory — the anti-corruption boundary lives in the gateway. */
export interface ExternalUser {
  id: number;
  name: string;
  username: string;
  company: { name: string };
}
