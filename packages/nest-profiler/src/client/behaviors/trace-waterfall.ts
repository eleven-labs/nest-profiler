import type { NestProfilerApi } from '../runtime';

/** Which spans the waterfall shows. See the `[data-trace-lens]` buttons in the panel. */
type Lens = 'all' | 'io' | 'code';

/**
 * Wires the Timeline waterfall's three interactions: a `[data-trace-toggle]` caret folds a span's
 * whole subtree (a row hides when any ancestor is collapsed), clicking a `[data-trace-detail]`
 * label expands its `[data-trace-detail-panel]` (full SQL/URL + link), and `[data-trace-lens]`
 * switches which kinds of span are shown. A detail stays hidden while its own row is folded away.
 *
 * The lens hides rows rather than rebuilding the tree, so a hidden method span's children keep
 * their real parent and their indentation — the point being to read *the same* trace at a
 * different density, not to see a different tree.
 */
export function initTraceWaterfall(api: NestProfilerApi): void {
  const collapsed = new Set<string>();
  const openDetails = new Set<string>();
  let lens: Lens = 'all';
  let minDuration = 0;
  let criticalOnly = false;

  /** A span's own duration, as the template rendered it. */
  const durationOf = (node: HTMLElement): number => Number(node.dataset.traceDuration ?? '0');

  /** Whether a row is filtered out by the active lens or by the duration threshold. */
  const filtered = (node: HTMLElement): boolean => {
    // The entrypoint is never hidden by the threshold: it is the axis everything is drawn against.
    if (minDuration > 0 && node.dataset.traceKind !== 'entrypoint') {
      if (durationOf(node) < minDuration) return true;
    }
    const kind = node.dataset.traceKind;
    if (lens === 'io') return kind === 'method';
    // `code` keeps the entrypoint too: without a root the remaining bars have nothing to sit under.
    if (lens === 'code') return kind !== 'method' && kind !== 'entrypoint';
    return false;
  };

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
      hidden = hidden || filtered(node);
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

    // The table below the bars is the same trace read as a list, so it follows the bars exactly:
    // a row whose bar is hidden — by the lens or by a fold — is hidden too. Without this, "I/O
    // only" still listed every method call underneath.
    document.querySelectorAll<HTMLElement>('[data-trace-row]').forEach((row) => {
      row.classList.toggle('hidden', hiddenById.get(row.dataset.traceRow!) === true);
    });

    const shown = [...hiddenById.values()].filter((hidden) => !hidden).length;
    document.querySelectorAll<HTMLElement>('[data-trace-count]').forEach((el) => {
      // Silent at full size: a count that always shows would read as noise rather than as the
      // signal "you are looking at a subset".
      const partial = shown < hiddenById.size;
      el.hidden = !partial;
      el.textContent = partial ? `${shown} of ${hiddenById.size} spans · ` : '';
    });

    // Critical path dims rather than hides: the value is seeing the deciding chain *against* the
    // rest, and hiding the rest would leave a single column with nothing to compare it to.
    document.querySelectorAll<HTMLElement>('[data-trace-node]').forEach((node) => {
      const off = criticalOnly && node.dataset.traceCriticalNode === undefined;
      node.classList.toggle('opacity-30', off);
    });
    document.querySelectorAll<HTMLElement>('[data-trace-critical]').forEach((btn) => {
      btn.classList.toggle('bg-surface-muted', criticalOnly);
      btn.classList.toggle('text-foreground', criticalOnly);
      btn.setAttribute('aria-pressed', String(criticalOnly));
    });

    document.querySelectorAll<HTMLElement>('[data-trace-lens]').forEach((btn) => {
      const active = btn.dataset.traceLens === lens;
      btn.classList.toggle('bg-surface-muted', active);
      btn.classList.toggle('text-foreground', active);
      btn.setAttribute('aria-pressed', String(active));
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
  api.delegate('click', '[data-trace-critical]', () => {
    criticalOnly = !criticalOnly;
    apply();
  });
  api.delegate('change', '[data-trace-min]', (select) => {
    minDuration = Number((select as HTMLSelectElement).value) || 0;
    apply();
  });
  api.delegate('click', '[data-trace-lens]', (btn) => {
    const next = btn.dataset.traceLens;
    if (next === 'all' || next === 'io' || next === 'code') {
      lens = next;
      apply();
    }
  });

  // Reflect the initial state on the controls — the selected lens, and a threshold the host may
  // have set as a module default — before any interaction.
  api.onReady(() => {
    const select = document.querySelector<HTMLSelectElement>('[data-trace-min]');
    if (select) minDuration = Number(select.value) || 0;
    apply();
  });
}
