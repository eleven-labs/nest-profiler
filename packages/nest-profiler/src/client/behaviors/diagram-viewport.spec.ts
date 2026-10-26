/**
 * @jest-environment jsdom
 */
import { focusDiagramElement, mountDiagramViewport } from './diagram-viewport';

// jsdom does no layout: the viewport reports this size, and sits at the page origin.
const WIDTH = 800;
const HEIGHT = 400;

/** Mirrors the viewport markup `schema-panel.ejs` emits around the rendered SVG. */
function mount(viewBox = '0 0 1600 1200'): { root: HTMLElement; svg: SVGSVGElement } {
  document.body.innerHTML = `
    <div tabindex="0" data-diagram-viewport>
      <div data-mermaid-output>
        <svg viewBox="${viewBox}" style="max-width: 1600px"><g id="node"></g></svg>
      </div>
      <div data-diagram-controls>
        <select><option value="">Go to entity…</option></select>
        <button data-diagram-action="zoom-out"></button>
        <button data-diagram-action="actual" data-diagram-zoom></button>
        <button data-diagram-action="zoom-in"></button>
        <button data-diagram-action="fit"></button>
        <button data-diagram-action="expand" aria-pressed="false"></button>
      </div>
    </div>`;
  const root = document.querySelector<HTMLElement>('[data-diagram-viewport]')!;
  Object.defineProperty(root, 'clientWidth', { configurable: true, value: WIDTH });
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: HEIGHT });
  const svg = root.querySelector('svg')!;
  mountDiagramViewport(root, svg);
  return { root, svg };
}

/** The current view: its centre in diagram units and its zoom in screen pixels per unit. */
function view(svg: SVGSVGElement): { x: number; y: number; scale: number } {
  const [x = 0, y = 0, width = 0, height = 0] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  return { x: x + width / 2, y: y + height / 2, scale: WIDTH / width };
}

const zoomLabel = (root: HTMLElement): string =>
  root.querySelector('[data-diagram-zoom]')!.textContent ?? '';

const click = (root: HTMLElement, action: string): void =>
  root.querySelector<HTMLElement>(`[data-diagram-action="${action}"]`)!.click();

function pointer(target: Element, type: string, clientX: number, clientY: number): void {
  // jsdom has no PointerEvent; a MouseEvent carrying a pointerId is all the viewport reads.
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

function wheel(target: Element, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const key = (target: Element, name: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
};

describe('diagram viewport', () => {
  it('takes over sizing from Mermaid and frames the whole diagram', () => {
    const { root, svg } = mount();

    expect(svg.getAttribute('style')).not.toContain('max-width');
    expect(svg.getAttribute('width')).toBe('100%');
    // Fitting 1600×1200 (+16px margins) into 800×400 is height-bound: 368 / 1200.
    expect(view(svg)).toEqual({ x: 800, y: 600, scale: 368 / 1200 });
    expect(zoomLabel(root)).toBe('31%');
    expect(root.style.getPropertyValue('--diagram-height')).toBe('1232px');
  });

  it('never enlarges a small diagram past its natural size', () => {
    const { root, svg } = mount('0 0 200 100');

    expect(view(svg).scale).toBe(1);
    expect(root.style.getPropertyValue('--diagram-height')).toBe('240px');
  });

  it('zooms with the buttons and returns to the fitted view', () => {
    const { root, svg } = mount();
    const fitted = view(svg);

    click(root, 'zoom-in');
    expect(view(svg).scale).toBeCloseTo(fitted.scale * 1.25);
    click(root, 'actual');
    expect(zoomLabel(root)).toBe('100%');
    expect(view(svg)).toMatchObject({ x: 800, y: 600 });
    click(root, 'fit');
    expect(view(svg)).toEqual(fitted);
  });

  it('clamps the zoom between half the fitted view and 400%', () => {
    const { root, svg } = mount();
    const fitted = view(svg).scale;

    for (let step = 0; step < 20; step += 1) click(root, 'zoom-out');
    expect(view(svg).scale).toBeCloseTo(fitted / 2);
    for (let step = 0; step < 40; step += 1) click(root, 'zoom-in');
    expect(zoomLabel(root)).toBe('400%');
  });

  it('zooms on Ctrl + wheel around the cursor, leaving a plain wheel to the page', () => {
    const { root, svg } = mount();
    const before = view(svg);

    const plain = wheel(root, { deltaY: -100, clientX: 0, clientY: 0 });
    expect(plain.defaultPrevented).toBe(false);
    expect(view(svg)).toEqual(before);

    // Zooming in around the top-left corner keeps that corner on the same diagram point.
    const corner = (): number => view(svg).x - WIDTH / 2 / view(svg).scale;
    const cornerBefore = corner();
    const zoom = wheel(root, { deltaY: -100, ctrlKey: true, clientX: 0, clientY: 0 });
    expect(zoom.defaultPrevented).toBe(true);
    expect(view(svg).scale).toBeGreaterThan(before.scale);
    expect(corner()).toBeCloseTo(cornerBefore);
  });

  it('pans by dragging, but not from the controls', () => {
    const { root, svg } = mount();
    const before = view(svg);

    pointer(root, 'pointerdown', 100, 100);
    pointer(root, 'pointermove', 160, 130);
    pointer(root, 'pointerup', 160, 130);
    expect(view(svg).x).toBeCloseTo(before.x - 60 / before.scale);
    expect(view(svg).y).toBeCloseTo(before.y - 30 / before.scale);
    expect(root.hasAttribute('data-dragging')).toBe(false);

    const moved = view(svg);
    const select = root.querySelector('select')!;
    pointer(select, 'pointerdown', 100, 100);
    pointer(root, 'pointermove', 300, 300);
    expect(view(svg)).toEqual(moved);
  });

  it('answers keyboard shortcuts, except inside the entity picker', () => {
    const { root, svg } = mount();
    const fitted = view(svg);

    key(root, '+');
    expect(view(svg).scale).toBeCloseTo(fitted.scale * 1.25);
    key(root, 'ArrowRight');
    expect(view(svg).x).toBeCloseTo(fitted.x + 80 / view(svg).scale);
    key(root, '0');
    expect(view(svg)).toEqual(fitted);

    key(root.querySelector('select')!, '+');
    expect(view(svg)).toEqual(fitted);
  });

  it('expands to the full window, where a plain wheel zooms, and leaves it on Escape', () => {
    const { root, svg } = mount();

    click(root, 'expand');
    expect(root.hasAttribute('data-expanded')).toBe(true);
    expect(root.querySelector('[data-diagram-action="expand"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    const before = view(svg).scale;
    expect(wheel(root, { deltaY: -100 }).defaultPrevented).toBe(true);
    expect(view(svg).scale).toBeGreaterThan(before);

    key(root, 'Escape');
    expect(root.hasAttribute('data-expanded')).toBe(false);
  });

  it('keeps the view when a re-rendered SVG has the same layout, and refits otherwise', () => {
    const { root, svg } = mount();
    click(root, 'zoom-in');
    const zoomed = view(svg);

    const sameLayout = svg.cloneNode() as SVGSVGElement;
    sameLayout.setAttribute('viewBox', '0 0 1600 1200');
    mountDiagramViewport(root, sameLayout);
    expect(view(sameLayout)).toEqual(zoomed);

    const otherLayout = svg.cloneNode() as SVGSVGElement;
    otherLayout.setAttribute('viewBox', '0 0 400 200');
    mountDiagramViewport(root, otherLayout);
    expect(view(otherLayout)).toEqual({ x: 200, y: 100, scale: 1 });
  });

  it('centres a focused node at a readable zoom', () => {
    const { root, svg } = mount();
    const node = svg.querySelector('g')!;
    // A 30-pixel-square node drawn 100 pixels right and 50 down of the viewport's top-left.
    const fitted = view(svg);
    jest
      .spyOn(node, 'getBoundingClientRect')
      .mockReturnValue({ left: 100, top: 50, width: 30, height: 30 } as DOMRect);

    focusDiagramElement(root, node);

    const left = fitted.x - WIDTH / 2 / fitted.scale;
    const top = fitted.y - HEIGHT / 2 / fitted.scale;
    expect(view(svg)).toEqual({
      x: expect.closeTo(left + 115 / fitted.scale) as number,
      y: expect.closeTo(top + 65 / fitted.scale) as number,
      scale: 1,
    });
  });
});
