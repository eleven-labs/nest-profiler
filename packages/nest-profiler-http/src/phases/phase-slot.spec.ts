import {
  activePhaseSlot,
  openPhaseSlot,
  phaseSlotsEnabled,
  registerPhaseSlotProvider,
  resetPhaseSlotProviders,
} from './phase-slot';

describe('phase slot', () => {
  afterEach(() => {
    resetPhaseSlotProviders();
  });

  it('stays disabled until a provider installs, so no adapter pays for a context', () => {
    expect(phaseSlotsEnabled()).toBe(false);
    registerPhaseSlotProvider();
    expect(phaseSlotsEnabled()).toBe(true);
  });

  it('exposes the open slot to code running inside it, and nothing outside', () => {
    expect(activePhaseSlot()).toBeUndefined();

    const seen = openPhaseSlot((slot) => {
      slot.phases = { dns: 1 };
      return activePhaseSlot();
    });

    expect(seen).toEqual({ phases: { dns: 1 } });
    expect(activePhaseSlot()).toBeUndefined();
  });

  it('gives concurrent calls independent slots', async () => {
    const fill = (dns: number, delay: number): Promise<unknown> =>
      openPhaseSlot(async (slot) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const inner = activePhaseSlot();
        if (inner) inner.phases = { dns };
        return slot.phases;
      });

    await expect(Promise.all([fill(1, 10), fill(2, 1)])).resolves.toEqual([{ dns: 1 }, { dns: 2 }]);
  });
});
