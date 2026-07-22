import type { NestProfilerApi } from '../runtime';

/**
 * Wires the Timeline waterfall's two interactions: a `[data-trace-toggle]` caret folds
 * a span's whole subtree (a row hides when any ancestor is collapsed), and clicking a
 * `[data-trace-detail]` label expands its `[data-trace-detail-panel]` (full SQL/URL +
 * link). A detail stays hidden while its own row is folded away.
 */
export function initTraceWaterfall(api: NestProfilerApi): void {
  const collapsed = new Set<string>();
  const openDetails = new Set<string>();

  const apply = (): void => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-trace-node]'));
    const parentOf = new Map<string, string | null>();
    for (const node of nodes) {
      parentOf.set(node.dataset.traceNode!, node.dataset.traceParent ?? null);
    }

    const hiddenById = new Map<string, boolean>();
    for (const node of nodes) {
      const id = node.dataset.traceNode!;
      let hidden = false;
      let parent = parentOf.get(id) ?? null;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        if (collapsed.has(parent)) {
          hidden = true;
          break;
        }
        parent = parentOf.get(parent) ?? null;
      }
      hiddenById.set(id, hidden);
      node.classList.toggle('hidden', hidden);
    }

    document.querySelectorAll<HTMLElement>('[data-trace-toggle]').forEach((btn) => {
      const id = btn.dataset.traceToggle;
      btn.style.transform = id && collapsed.has(id) ? 'rotate(0deg)' : 'rotate(90deg)';
    });

    document.querySelectorAll<HTMLElement>('[data-trace-detail-panel]').forEach((panel) => {
      const id = panel.dataset.traceDetailPanel!;
      panel.classList.toggle('hidden', hiddenById.get(id) === true || !openDetails.has(id));
    });
  };

  const toggle = (set: Set<string>, id: string): void => {
    if (set.has(id)) set.delete(id);
    else set.add(id);
    apply();
  };

  api.delegate('click', '[data-trace-toggle]', (btn) => {
    if (btn.dataset.traceToggle) toggle(collapsed, btn.dataset.traceToggle);
  });
  api.delegate('click', '[data-trace-detail]', (btn) => {
    if (btn.dataset.traceDetail) toggle(openDetails, btn.dataset.traceDetail);
  });
}
