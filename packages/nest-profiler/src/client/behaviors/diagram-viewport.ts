/** Largest zoom, in screen pixels per diagram unit (100% is Mermaid's natural size). */
const MAX_SCALE = 4;
/** Zoom factor of one button press, key press or double-click. */
const ZOOM_STEP = 1.25;
/** Distance, in screen pixels, an arrow key pans the diagram. */
const PAN_STEP = 80;
/** Margin, in screen pixels, kept around the diagram when it is fitted to the viewport. */
const PADDING = 16;
/** Smallest height, in screen pixels, of the inline viewport. */
const MIN_HEIGHT = 240;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const viewports = new WeakMap<HTMLElement, DiagramViewport>();

function boundsOf(svg: SVGSVGElement): Box {
  const [x = 0, y = 0, width = 0, height = 0] = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (width > 0 && height > 0) return { x, y, width, height };
  // No usable viewBox: fall back to the drawn size.
  const rect = svg.getBoundingClientRect();
  return { x: 0, y: 0, width: rect.width || 1, height: rect.height || 1 };
}

const sameBounds = (a: Box, b: Box): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Pan and zoom over an SVG diagram rendered inside a `[data-diagram-viewport]` element.
 *
 * The view is driven through the SVG's `viewBox` rather than a CSS transform, so the browser
 * redraws the vectors at every zoom level and labels stay sharp. `scale` is in screen pixels per
 * diagram unit; (`x`, `y`) is the diagram point shown at the viewport's top-left corner.
 */
class DiagramViewport {
  private bounds: Box;
  private scale = 1;
  private x = 0;
  private y = 0;
  private width = 0;
  private height = 0;
  private drag: { pointerId: number; clientX: number; clientY: number } | undefined;

  constructor(
    private readonly root: HTMLElement,
    private svg: SVGSVGElement,
  ) {
    this.bounds = boundsOf(svg);
    this.prepare();
    this.sizeToContent();
    this.fit();
    this.listen();
  }

  /** Swaps in a re-rendered SVG (theme flip), keeping the current view when the layout matches. */
  replace(svg: SVGSVGElement): void {
    const bounds = boundsOf(svg);
    this.svg = svg;
    this.prepare();
    if (sameBounds(bounds, this.bounds)) {
      this.apply();
    } else {
      this.bounds = bounds;
      this.fit();
    }
  }

  private get expanded(): boolean {
    return this.root.hasAttribute('data-expanded');
  }

  /** The smallest zoom: half the fitted one, so the whole diagram can always be framed. */
  private get minScale(): number {
    return Math.min(this.fitScale(), 1) / 2;
  }

  private prepare(): void {
    // Mermaid sizes its SVG to the container width with a `max-width`; the viewport owns sizing now.
    this.svg.removeAttribute('style');
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    this.svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    this.svg.style.display = 'block';
  }

  /**
   * Sizes the inline viewport to the diagram's natural height, so a small diagram doesn't float
   * in empty space; the template caps it to the window for a large one.
   */
  private sizeToContent(): void {
    const height = Math.max(MIN_HEIGHT, Math.ceil(this.bounds.height + 2 * PADDING));
    this.root.style.setProperty('--diagram-height', `${height}px`);
  }

  private fitScale(): number {
    const width = Math.max(this.width - 2 * PADDING, 1) / this.bounds.width;
    const height = Math.max(this.height - 2 * PADDING, 1) / this.bounds.height;
    return Math.min(width, height);
  }

  private measure(): boolean {
    this.width = this.root.clientWidth;
    this.height = this.root.clientHeight;
    return this.width > 0 && this.height > 0;
  }

  /** Frames the whole diagram, never enlarging it past its natural size. */
  fit(): void {
    if (!this.measure()) return;
    this.scale = Math.min(this.fitScale(), 1);
    this.centerOn(this.bounds.x + this.bounds.width / 2, this.bounds.y + this.bounds.height / 2);
  }

  /** Zooms to `scale`, keeping the diagram point under (`clientX`, `clientY`) in place. */
  zoomTo(scale: number, clientX?: number, clientY?: number): void {
    const rect = this.root.getBoundingClientRect();
    const offsetX = clientX === undefined ? this.width / 2 : clientX - rect.left;
    const offsetY = clientY === undefined ? this.height / 2 : clientY - rect.top;
    const pointX = this.x + offsetX / this.scale;
    const pointY = this.y + offsetY / this.scale;
    this.scale = Math.min(MAX_SCALE, Math.max(this.minScale, scale));
    this.x = pointX - offsetX / this.scale;
    this.y = pointY - offsetY / this.scale;
    this.apply();
  }

  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    this.zoomTo(this.scale * factor, clientX, clientY);
  }

  /** Moves the diagram by (`dx`, `dy`) screen pixels. */
  panBy(dx: number, dy: number): void {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
    this.apply();
  }

  /**
   * Centres `element` (a node of the diagram), zooming in until it shows at its natural size or,
   * when it is taller than the viewport, until it fits.
   */
  focus(element: Element): void {
    if (this.width === 0 || this.height === 0) return;
    const rect = element.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    const x = this.x + (rect.left + rect.width / 2 - root.left) / this.scale;
    const y = this.y + (rect.top + rect.height / 2 - root.top) / this.scale;
    const height = rect.height / this.scale;
    const readable = height > 0 ? Math.min(1, (this.height - 2 * PADDING) / height) : 1;
    this.scale = Math.min(MAX_SCALE, Math.max(this.scale, readable));
    this.centerOn(x, y);
  }

  /** Enters or leaves the full-window view, keeping the same diagram point centred. */
  toggleExpanded(force?: boolean): void {
    const expanded = force ?? !this.expanded;
    if (expanded === this.expanded) return;
    this.root.toggleAttribute('data-expanded', expanded);
    this.root
      .querySelector('[data-diagram-action="expand"]')
      ?.setAttribute('aria-pressed', String(expanded));
    this.resize();
    if (expanded) this.root.focus({ preventScroll: true });
  }

  /** Follows a size change of the viewport, keeping its centre on the same diagram point. */
  resize(): void {
    const hadSize = this.width > 0 && this.height > 0;
    const centerX = this.x + this.width / 2 / this.scale;
    const centerY = this.y + this.height / 2 / this.scale;
    if (!this.measure()) return;
    // A viewport rendered while hidden (a theme flip on a closed section) is fitted once it shows.
    if (!hadSize) {
      this.fit();
      return;
    }
    this.centerOn(centerX, centerY);
  }

  private centerOn(x: number, y: number): void {
    this.x = x - this.width / 2 / this.scale;
    this.y = y - this.height / 2 / this.scale;
    this.apply();
  }

  private apply(): void {
    if (this.width === 0 || this.height === 0) return;
    const width = this.width / this.scale;
    const height = this.height / this.scale;
    this.svg.setAttribute('viewBox', `${this.x} ${this.y} ${width} ${height}`);
    const label = this.root.querySelector('[data-diagram-zoom]');
    if (label) label.textContent = `${Math.round(this.scale * 100)}%`;
  }

  private listen(): void {
    const { root } = this;
    const onControls = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('[data-diagram-controls]') !== null;

    root.addEventListener('click', (event) => {
      const button =
        event.target instanceof Element ? event.target.closest('[data-diagram-action]') : null;
      if (!button) return;
      const action = button.getAttribute('data-diagram-action');
      if (action === 'zoom-in') this.zoomBy(ZOOM_STEP);
      else if (action === 'zoom-out') this.zoomBy(1 / ZOOM_STEP);
      else if (action === 'fit') this.fit();
      else if (action === 'actual') this.zoomTo(1);
      else if (action === 'expand') this.toggleExpanded();
    });

    // Inline, a plain wheel keeps scrolling the page; Ctrl/⌘ + wheel (and trackpad pinch, which
    // browsers report as a Ctrl + wheel) zooms. Expanded, the diagram is all there is: wheel zooms.
    root.addEventListener(
      'wheel',
      (event) => {
        if (!this.expanded && !event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const delta =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
        this.zoomBy(Math.exp(-delta * 0.002), event.clientX, event.clientY);
      },
      { passive: false },
    );

    root.addEventListener('dblclick', (event) => {
      if (onControls(event.target)) return;
      event.preventDefault();
      this.zoomBy(event.shiftKey ? 1 / ZOOM_STEP : ZOOM_STEP, event.clientX, event.clientY);
    });

    root.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || onControls(event.target)) return;
      this.drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
      root.setPointerCapture?.(event.pointerId);
      root.setAttribute('data-dragging', '');
    });
    root.addEventListener('pointermove', (event) => {
      if (this.drag?.pointerId !== event.pointerId) return;
      this.panBy(event.clientX - this.drag.clientX, event.clientY - this.drag.clientY);
      this.drag = { ...this.drag, clientX: event.clientX, clientY: event.clientY };
    });
    const endDrag = (event: PointerEvent): void => {
      if (this.drag?.pointerId !== event.pointerId) return;
      this.drag = undefined;
      root.removeAttribute('data-dragging');
    };
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);

    root.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // A focused form control (the entity picker) keeps its own keys.
      if (event.target instanceof Element && event.target.closest('input, select, textarea'))
        return;
      const handled = this.onKey(event.key);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(root);
    }
  }

  private onKey(key: string): boolean {
    switch (key) {
      case '+':
      case '=':
        this.zoomBy(ZOOM_STEP);
        return true;
      case '-':
      case '_':
        this.zoomBy(1 / ZOOM_STEP);
        return true;
      case '0':
        this.fit();
        return true;
      case '1':
        this.zoomTo(1);
        return true;
      case 'ArrowLeft':
        this.panBy(PAN_STEP, 0);
        return true;
      case 'ArrowRight':
        this.panBy(-PAN_STEP, 0);
        return true;
      case 'ArrowUp':
        this.panBy(0, PAN_STEP);
        return true;
      case 'ArrowDown':
        this.panBy(0, -PAN_STEP);
        return true;
      case 'Escape':
        if (!this.expanded) return false;
        this.toggleExpanded(false);
        return true;
      default:
        return false;
    }
  }
}

/**
 * Makes the SVG rendered inside `root` (a `[data-diagram-viewport]` element) pannable and
 * zoomable: drag to pan, Ctrl/⌘ + wheel or double-click to zoom, `[data-diagram-action]` buttons
 * (`zoom-in`, `zoom-out`, `fit`, `actual`, `expand`) and keyboard shortcuts while focused. Calling
 * it again for the same root swaps in a re-rendered SVG.
 */
export function mountDiagramViewport(root: HTMLElement, svg: SVGSVGElement): void {
  const existing = viewports.get(root);
  if (existing) existing.replace(svg);
  else viewports.set(root, new DiagramViewport(root, svg));
}

/** Centres `element`, a node of the diagram mounted in `root`. */
export function focusDiagramElement(root: HTMLElement, element: Element): void {
  viewports.get(root)?.focus(element);
}
