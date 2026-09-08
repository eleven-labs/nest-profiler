import { AsyncLocalStorage } from 'node:async_hooks';
import type { HttpPhases } from '../http-phases.interface';

/**
 * A place for a phases provider to deposit what it measured, for the instrumentation that is
 * recording the surrounding call to pick up.
 *
 * It exists because some clients never expose their transport: with `fetch`, the adapter holds a
 * `Request`/`Response` pair and undici holds the timings, and the two only ever meet through the
 * async context they share.
 */
export interface HttpPhaseSlot {
  phases?: HttpPhases;
}

const storage = new AsyncLocalStorage<HttpPhaseSlot>();

/**
 * How many providers are installed. Instrumentations check it to keep their hot path free: with
 * no provider registered, no slot is opened and no async context is entered at all.
 */
let installedProviders = 0;

/** Called by a phases provider when it installs. */
export function registerPhaseSlotProvider(): void {
  installedProviders += 1;
}

/** Whether opening a slot can lead to anything being measured. */
export function phaseSlotsEnabled(): boolean {
  return installedProviders > 0;
}

/**
 * Run `execute` with a fresh slot in scope. The slot is handed to the callback *and* readable by
 * any provider running in that async context, which is how the two sides meet.
 */
export function openPhaseSlot<T>(execute: (slot: HttpPhaseSlot) => T): T {
  const slot: HttpPhaseSlot = {};
  return storage.run(slot, () => execute(slot));
}

/** The slot open in the current async context, if a call is being recorded around us. */
export function activePhaseSlot(): HttpPhaseSlot | undefined {
  return storage.getStore();
}

/** Test seam: forget the installed providers so a suite starts from a known state. */
export function resetPhaseSlotProviders(): void {
  installedProviders = 0;
}
