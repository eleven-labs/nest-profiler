import { ClsService } from 'nestjs-cls';
import { readActiveSpanId } from './active-span';
import { PROFILER_CLS_KEYS } from '../constants';

describe('readActiveSpanId', () => {
  it('returns the active span id from the CLS store', () => {
    const cls = { get: () => 'span-1' } as unknown as ClsService;
    expect(readActiveSpanId(cls)).toBe('span-1');
  });

  it('reads the profiler active-span key', () => {
    const get = jest.fn().mockReturnValue('span-2');
    readActiveSpanId({ get } as unknown as ClsService);
    expect(get).toHaveBeenCalledWith(PROFILER_CLS_KEYS.activeSpanId);
  });

  it('returns undefined when there is no CLS service', () => {
    expect(readActiveSpanId(undefined)).toBeUndefined();
  });

  it('returns undefined (never throws) outside a CLS context', () => {
    const cls = {
      get: () => {
        throw new Error('outside CLS');
      },
    } as unknown as ClsService;
    expect(readActiveSpanId(cls)).toBeUndefined();
  });
});
