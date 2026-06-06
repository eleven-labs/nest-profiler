import { classValidatorExtractor, mapClassValidatorErrors } from './class-validator.extractor';
import { VALIDATOR_RAW_ERRORS } from '../violation-extractor.interface';

function errorCarrying(raw: unknown): unknown {
  return { [VALIDATOR_RAW_ERRORS]: raw };
}

describe('classValidatorExtractor', () => {
  it('maps raw class-validator errors attached under the symbol', () => {
    const raw = [
      { property: 'name', value: '', constraints: { isNotEmpty: 'name should not be empty' } },
    ];
    const violations = classValidatorExtractor.extract({ error: errorCarrying(raw) });
    expect(violations).toEqual([
      {
        property: 'name',
        value: '',
        constraints: { isNotEmpty: 'name should not be empty' },
        children: undefined,
      },
    ]);
  });

  it('recurses into nested child errors', () => {
    const raw = [
      {
        property: 'address',
        children: [{ property: 'city', constraints: { isNotEmpty: 'required' } }],
      },
    ];
    const violations = classValidatorExtractor.extract({ error: errorCarrying(raw) });
    expect(violations?.[0]?.children?.[0]?.property).toBe('city');
  });

  it('returns an empty array when the attached array is empty', () => {
    expect(classValidatorExtractor.extract({ error: errorCarrying([]) })).toEqual([]);
  });

  it('returns null when the symbol is absent', () => {
    expect(classValidatorExtractor.extract({ error: new Error('boom') })).toBeNull();
  });

  it('returns null when the attached value is not an error array', () => {
    expect(classValidatorExtractor.extract({ error: errorCarrying('nope') })).toBeNull();
  });

  it('returns null for non-object errors', () => {
    expect(classValidatorExtractor.extract({ error: 'string error' })).toBeNull();
    expect(classValidatorExtractor.extract({ error: null })).toBeNull();
  });
});

describe('mapClassValidatorErrors', () => {
  it('maps property/value/constraints and defaults missing constraints to {}', () => {
    expect(
      mapClassValidatorErrors([
        { property: 'a', value: 1, constraints: { isInt: 'must be int' } },
        { property: 'b' },
      ]),
    ).toEqual([
      { property: 'a', value: 1, constraints: { isInt: 'must be int' }, children: undefined },
      { property: 'b', value: undefined, constraints: {}, children: undefined },
    ]);
  });
});
