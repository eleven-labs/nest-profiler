/**
 * The Mermaid runtime the Schema panel loads, on demand, to draw its entity-relationship
 * diagram. It is fetched by the browser from jsDelivr when the diagram is first opened rather
 * than vendored, so the package (and the consumer's install) stays free of its ~5 MB bundle.
 *
 * Shared by the server (the profiler CSP allows exactly this URL) and the client bundle (which
 * injects the script with its Subresource Integrity hash), so the two can never drift apart.
 * The version is pinned: bumping it means updating the URL and the integrity hash together.
 */
export const MERMAID_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js';

/** SHA-384 Subresource Integrity hash of {@link MERMAID_SCRIPT_URL}. */
export const MERMAID_SCRIPT_INTEGRITY =
  'sha384-EbBpjO7rlR6eqZEcG7GaPpyk9H9WrMyPWX4d3KvPYltgt8Z8l0z6R56B1qP40pR4';
