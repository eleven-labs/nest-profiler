import { parseExplainPlan } from './parse-explain';
import type { ExplainRawResult } from './explain.interface';

const raw = (
  dialect: ExplainRawResult['dialect'],
  value: unknown,
  analyzed = false,
): ExplainRawResult => ({
  dialect,
  analyzed,
  raw: value,
});

describe('parseExplainPlan — postgres', () => {
  it('extracts a top-level Seq Scan with rows and cost', () => {
    const plan = parseExplainPlan(
      raw('postgres', [
        {
          Plan: {
            'Node Type': 'Seq Scan',
            'Relation Name': 'products',
            'Plan Rows': 100000,
            'Total Cost': 2500.5,
          },
        },
      ]),
    );
    expect(plan.planType).toBe('Seq Scan');
    expect(plan.hasSeqScan).toBe(true);
    expect(plan.seqScanRelations).toEqual(['products']);
    expect(plan.estimatedRows).toBe(100000);
    expect(plan.estimatedCost).toBe(2500.5);
  });

  it('walks nested Plans and flags a deep Seq Scan while keeping the top node type', () => {
    const plan = parseExplainPlan(
      raw('postgres', [
        {
          Plan: {
            'Node Type': 'Nested Loop',
            'Plan Rows': 10,
            'Total Cost': 42,
            Plans: [
              { 'Node Type': 'Index Scan', 'Relation Name': 'users' },
              { 'Node Type': 'Seq Scan', 'Relation Name': 'orders' },
            ],
          },
        },
      ]),
    );
    expect(plan.planType).toBe('Nested Loop');
    expect(plan.hasSeqScan).toBe(true);
    expect(plan.seqScanRelations).toEqual(['orders']);
  });

  it('reports no seq scan for a pure Index Scan', () => {
    const plan = parseExplainPlan(
      raw('postgres', [{ Plan: { 'Node Type': 'Index Only Scan', 'Relation Name': 'users' } }]),
    );
    expect(plan.hasSeqScan).toBe(false);
    expect(plan.seqScanRelations).toEqual([]);
    expect(plan.planType).toBe('Index Only Scan');
  });

  it('accepts the object form ({ Plan }) as well as the array form', () => {
    const plan = parseExplainPlan(
      raw('postgres', { Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 't' } }),
    );
    expect(plan.hasSeqScan).toBe(true);
    expect(plan.seqScanRelations).toEqual(['t']);
  });
});

describe('parseExplainPlan — mysql', () => {
  it('flags access_type ALL as a full scan with rows and cost', () => {
    const plan = parseExplainPlan(
      raw('mysql', {
        query_block: {
          select_id: 1,
          cost_info: { query_cost: '12.34' },
          table: { table_name: 'products', access_type: 'ALL', rows_examined_per_scan: 5000 },
        },
      }),
    );
    expect(plan.hasSeqScan).toBe(true);
    expect(plan.seqScanRelations).toEqual(['products']);
    expect(plan.planType).toBe('access_type: ALL');
    expect(plan.estimatedRows).toBe(5000);
    expect(plan.estimatedCost).toBe(12.34);
  });

  it('does not flag an indexed access_type (ref)', () => {
    const plan = parseExplainPlan(
      raw('mysql', {
        query_block: { table: { table_name: 'users', access_type: 'ref' } },
      }),
    );
    expect(plan.hasSeqScan).toBe(false);
    expect(plan.planType).toBe('access_type: ref');
  });

  it('recurses into nested_loop entries', () => {
    const plan = parseExplainPlan(
      raw('mysql', {
        query_block: {
          nested_loop: [
            { table: { table_name: 'a', access_type: 'eq_ref' } },
            { table: { table_name: 'b', access_type: 'ALL' } },
          ],
        },
      }),
    );
    expect(plan.hasSeqScan).toBe(true);
    expect(plan.seqScanRelations).toEqual(['b']);
  });
});

describe('parseExplainPlan — sqlite', () => {
  it('flags a SCAN row as a full scan and captures the table', () => {
    const plan = parseExplainPlan(
      raw('sqlite', [{ id: 2, parent: 0, notused: 0, detail: 'SCAN products' }]),
    );
    expect(plan.hasSeqScan).toBe(true);
    expect(plan.seqScanRelations).toEqual(['products']);
    expect(plan.planType).toBe('SCAN products');
  });

  it('handles the "SCAN TABLE x" wording', () => {
    const plan = parseExplainPlan(raw('sqlite', [{ detail: 'SCAN TABLE orders' }]));
    expect(plan.seqScanRelations).toEqual(['orders']);
  });

  it('does not flag a SEARCH ... USING INDEX row', () => {
    const plan = parseExplainPlan(
      raw('sqlite', [{ detail: 'SEARCH products USING INDEX idx_sku (sku=?)' }]),
    );
    expect(plan.hasSeqScan).toBe(false);
    expect(plan.seqScanRelations).toEqual([]);
  });
});

describe('parseExplainPlan — robustness', () => {
  it('carries the analyzed flag and raw output through', () => {
    const plan = parseExplainPlan(raw('postgres', [{ Plan: { 'Node Type': 'Result' } }], true));
    expect(plan.analyzed).toBe(true);
    expect(plan.raw).toEqual([{ Plan: { 'Node Type': 'Result' } }]);
  });

  it('returns a minimal plan (never throws) on malformed input', () => {
    for (const value of [null, undefined, 'garbage', {}, [], 42]) {
      const plan = parseExplainPlan(raw('postgres', value));
      expect(plan.hasSeqScan).toBe(false);
      expect(plan.seqScanRelations).toEqual([]);
      expect(plan.planType).toBeNull();
    }
  });
});
