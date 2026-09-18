/** Token the language model is injected under — a value provider, so no abstract-class port. */
export const LANGUAGE_MODEL = Symbol('LANGUAGE_MODEL');

/** What a non-streaming answer reports back, mirroring what the AI panel shows. */
export interface AssistantAnswer {
  model: string;
  text: string;
  finishReason: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/** What `generateObject` is asked to produce — a small, schema-checked digest of an article. */
export interface ArticleDigest {
  title: string;
  summary: string;
  topics: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

/** The half of a human-in-the-loop exchange that comes back when nobody has decided yet. */
export interface ApprovalRequested {
  status: 'awaiting-approval';
  /** Hand this back to `POST /ai/approval/:pendingId` with a decision. */
  pendingId: string;
  tool: string;
  input: unknown;
  reason?: string;
}

export type ApprovalOutcome = ApprovalRequested | (AssistantAnswer & { status: 'answered' });
