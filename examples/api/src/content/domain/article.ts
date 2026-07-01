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
