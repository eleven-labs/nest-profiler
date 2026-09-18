import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';

/** How many pending approvals are kept before the oldest is dropped. */
const MAX_PENDING = 50;

export interface PendingApproval {
  id: string;
  approvalId: string;
  tool: string;
  input: unknown;
  reason?: string;
  /** The conversation to resume with, once a decision comes back. */
  messages: ModelMessage[];
}

/**
 * Holds the conversations waiting on a human decision.
 *
 * In memory and bounded, which is all a demo needs: a real application would persist this, since
 * the approval arrives in a later request that any instance may serve.
 */
@Injectable()
export class ApprovalStore {
  private readonly pending = new Map<string, PendingApproval>();

  save(approval: Omit<PendingApproval, 'id'>): PendingApproval {
    const entry: PendingApproval = { id: randomUUID(), ...approval };
    this.pending.set(entry.id, entry);
    if (this.pending.size > MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    return entry;
  }

  take(id: string): PendingApproval | undefined {
    const entry = this.pending.get(id);
    this.pending.delete(id);
    return entry;
  }
}
