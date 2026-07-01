/**
 * A generic domain event flowing out of a bounded context. Kept intentionally generic (a name + an
 * opaque payload) so the notifications context never depends on the contexts that emit events.
 */
export interface DomainEvent {
  name: string;
  payload: Record<string, unknown>;
}
