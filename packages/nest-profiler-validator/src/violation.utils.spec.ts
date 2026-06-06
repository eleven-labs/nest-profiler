import { countViolations } from './violation.utils';

describe('countViolations', () => {
  it('counts the number of constraints on a leaf violation', () => {
    expect(countViolations([{ property: 'a', constraints: { x: '1', y: '2' } }])).toBe(2);
  });

  it('counts a leaf with no constraints as a single violation', () => {
    expect(countViolations([{ property: 'a', constraints: {} }])).toBe(1);
  });

  it('counts only the children of a parent that has children but no constraints', () => {
    expect(
      countViolations([
        {
          property: 'parent',
          constraints: {},
          children: [
            { property: 'c1', constraints: { x: '1' } },
            { property: 'c2', constraints: { y: '2' } },
          ],
        },
      ]),
    ).toBe(2);
  });

  it('sums a parent constraint with its nested children', () => {
    expect(
      countViolations([
        {
          property: 'parent',
          constraints: { isObject: 'must be object' },
          children: [{ property: 'c1', constraints: { x: '1' } }],
        },
      ]),
    ).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(countViolations([])).toBe(0);
  });
});
