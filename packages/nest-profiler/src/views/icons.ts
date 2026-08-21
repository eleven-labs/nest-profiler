/**
 * Protocol-identity glyphs shared across the UI. One protocol keeps **one** glyph wherever it is
 * named — its list section under **Profiling**, its **Discover** view, its collector panel, its
 * detail tab when that tab is the protocol itself — so a reader recognises HTTP or GraphQL by
 * shape alone. Only tabs naming a *content* rather than a protocol (Request, Response, Message,
 * Performance…) keep an icon of their own, local to their definition.
 */

/** HTTP: a globe with the equator and two meridians. Also the HTTP Client collector's glyph. */
export const HTTP_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-3 4-3 6s1 4 3 6M8 2c2 2 3 4 3 6s-1 4-3 6"/></svg>`;
