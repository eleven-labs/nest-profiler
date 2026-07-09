/**
 * Domain model for the content context — a blog article sourced from an external CMS (the
 * jsonplaceholder API stands in for it). The application layer enriches raw articles with their
 * author before returning them.
 */
export interface Article {
  id: number;
  title: string;
  body: string;
  author: ArticleAuthor | null;
}

export interface ArticleAuthor {
  id: number;
  name: string;
  username: string;
  email: string;
  company: string;
}

/** Data required to create/forward an article. */
export interface NewArticle {
  title: string;
  body: string;
  tags?: string[];
  coverImageUrl?: string;
}

/** Raw shapes returned by the external API — the anti-corruption boundary lives in the gateway. */
export interface ExternalArticle {
  userId: number;
  id: number;
  title: string;
  body: string;
}

export interface ExternalAuthor {
  id: number;
  name: string;
  username: string;
  email: string;
  company: { name: string };
}

export interface ExternalTodo {
  userId: number;
  id: number;
  title: string;
  completed: boolean;
}

/** The external API's response when an article is forwarded (echoes the payload with a new id). */
export interface ForwardedArticle {
  id: number;
  title: string;
  body: string;
  userId: number;
}

/** A todo enriched with its assignee — the shape returned by the todo use case. */
export interface TodoWithAssignee extends ExternalTodo {
  assignee: Pick<ExternalAuthor, 'id' | 'name' | 'username' | 'email'>;
}
