import type { ViolationEntry } from './validator-collector.interface';

/**
 * Total number of constraint failures across a violation tree. A leaf with
 * constraints counts each constraint; a leaf with neither constraints nor
 * children counts as one; children are summed recursively. Validator-neutral —
 * it operates only on the normalized {@link ViolationEntry} shape.
 */
export function countViolations(violations: ViolationEntry[]): number {
  return violations.reduce((acc, v) => {
    const childCount = v.children ? countViolations(v.children) : 0;
    return acc + (Object.keys(v.constraints).length || (v.children?.length ? 0 : 1)) + childCount;
  }, 0);
}
