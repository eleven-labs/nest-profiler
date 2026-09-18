import {
  configureAiPricing,
  estimateCost,
  loadAiPricing,
  pricingFor,
  resetAiPricing,
} from './ai-pricing';
import { fetchOpenRouterPricing } from './openrouter-pricing';

describe('AI pricing registry', () => {
  afterEach(() => {
    resetAiPricing();
    jest.useRealTimers();
  });

  describe('lookup', () => {
    it('matches the fully qualified provider first', () => {
      configureAiPricing({
        table: {
          'openai.responses:gpt-4o-mini': { input: 1, output: 2 },
          'openai:gpt-4o-mini': { input: 3, output: 4 },
          'gpt-4o-mini': { input: 5, output: 6 },
        },
      });

      expect(pricingFor('openai.responses', 'gpt-4o-mini')).toEqual({ input: 1, output: 2 });
    });

    it('falls back to the provider root, then to the bare model id', () => {
      configureAiPricing({ table: { 'openai:gpt-4o': { input: 3, output: 4 } } });
      expect(pricingFor('openai.responses', 'gpt-4o')).toEqual({ input: 3, output: 4 });

      configureAiPricing({ table: { 'gpt-4o': { input: 5, output: 6 } } });
      expect(pricingFor('openai.responses', 'gpt-4o')).toEqual({ input: 5, output: 6 });
    });

    it('ignores the case of both the key and the lookup', () => {
      configureAiPricing({ table: { 'OpenAI:GPT-4o': { input: 1, output: 2 } } });
      expect(pricingFor('openai', 'gpt-4O')).toEqual({ input: 1, output: 2 });
    });

    it('has no price for a model nobody configured', () => {
      configureAiPricing({ table: { 'gpt-4o': { input: 1, output: 2 } } });
      expect(pricingFor('openai', 'claude-4')).toBeUndefined();
    });
  });

  describe('cost', () => {
    beforeEach(() => {
      configureAiPricing({
        table: {
          'openai:gpt-4o-mini': {
            input: 0.15,
            output: 0.6,
            cacheRead: 0.075,
            cacheWrite: 0.1875,
            reasoning: 2.4,
          },
          flat: { input: 1, output: 2 },
          'per-token': { input: 0.0000005, output: 0.000002, per: 1 },
        },
      });
    });

    it('prices input and output per million tokens', () => {
      const cost = estimateCost({ input: 1_000_000, output: 1_000_000 }, 'openai', 'gpt-4o-mini');

      expect(cost).toBeCloseTo(0.75, 9);
    });

    it('bills cached and thinking tokens at their own rate, not twice', () => {
      // 1000 input = 600 fresh + 300 cache reads + 100 cache writes; 500 output = 400 text + 100 thinking.
      const cost = estimateCost(
        { input: 1000, cacheRead: 300, cacheWrite: 100, output: 500, reasoning: 100 },
        'openai',
        'gpt-4o-mini',
      );

      const expected =
        (600 * 0.15 + 300 * 0.075 + 100 * 0.1875 + 400 * 0.6 + 100 * 2.4) / 1_000_000;
      expect(cost).toBeCloseTo(expected, 9);
    });

    it('falls back to the input and output rates when no cache or thinking rate is given', () => {
      const cost = estimateCost(
        { input: 100, cacheRead: 40, output: 50, reasoning: 20 },
        'x',
        'flat',
      );

      expect(cost).toBeCloseTo((60 * 1 + 40 * 1 + 30 * 2 + 20 * 2) / 1_000_000, 9);
    });

    it('honours a table quoted per token', () => {
      const cost = estimateCost({ input: 1000, output: 500 }, 'x', 'per-token');

      expect(cost).toBeCloseTo(1000 * 0.0000005 + 500 * 0.000002, 9);
    });

    it('clamps the fresh share to zero when the details exceed their total', () => {
      const cost = estimateCost({ input: 10, cacheRead: 999, output: 0 }, 'x', 'flat');

      // Nothing fresh is billed on top of the 999 cached tokens, and nothing is subtracted.
      expect(cost).toBeCloseTo(999 / 1_000_000, 9);
    });

    it('bills a cache write at its own rate when one is configured', () => {
      const cost = estimateCost({ input: 100, cacheWrite: 40, output: 0 }, 'openai', 'gpt-4o-mini');

      expect(cost).toBeCloseTo((60 * 0.15 + 40 * 0.1875) / 1_000_000, 9);
    });

    it('leaves the cost unknown without usage or without a price', () => {
      expect(estimateCost(undefined, 'openai', 'gpt-4o-mini')).toBeUndefined();
      expect(estimateCost({ input: 10, output: 10 }, 'openai', 'unpriced')).toBeUndefined();
    });
  });

  describe('source', () => {
    it('does nothing at all when no source is configured', async () => {
      configureAiPricing({ table: { 'gpt-4o': { input: 1, output: 2 } } });

      await expect(loadAiPricing()).resolves.toBeUndefined();
      expect(pricingFor('', 'gpt-4o')).toEqual({ input: 1, output: 2 });
    });

    it('loads the table once and serves it from cache', async () => {
      const source = jest.fn().mockResolvedValue({ 'gpt-4o': { input: 1, output: 2 } });
      configureAiPricing({ source });

      await loadAiPricing();
      await loadAiPricing();

      expect(pricingFor('openai', 'gpt-4o')).toEqual({ input: 1, output: 2 });
      expect(source).toHaveBeenCalledTimes(1);
    });

    it('keeps a configured price ahead of a loaded one', async () => {
      configureAiPricing({
        table: { 'gpt-4o': { input: 9, output: 9 } },
        source: () => ({ 'gpt-4o': { input: 1, output: 2 } }),
      });

      await loadAiPricing();

      expect(pricingFor('openai', 'gpt-4o')).toEqual({ input: 9, output: 9 });
    });

    it('leaves costs unknown when the source fails, and asks it once, not once per call', async () => {
      const source = jest.fn().mockRejectedValue(new Error('down'));
      configureAiPricing({ source });

      await loadAiPricing();

      expect(pricingFor('openai', 'gpt-4o')).toBeUndefined();
      expect(pricingFor('openai', 'gpt-4o')).toBeUndefined();
      await loadAiPricing();
      expect(source).toHaveBeenCalledTimes(1);
    });

    it('reloads in the background once the table is stale', async () => {
      const source = jest
        .fn()
        .mockResolvedValueOnce({ 'gpt-4o': { input: 1, output: 2 } })
        .mockResolvedValueOnce({ 'gpt-4o': { input: 3, output: 4 } });
      configureAiPricing({ source, ttl: 1000 });

      await loadAiPricing();
      expect(pricingFor('openai', 'gpt-4o')).toEqual({ input: 1, output: 2 });

      jest.useFakeTimers().setSystemTime(Date.now() + 2000);
      // The stale lookup still answers from the old table — nothing on a request waits.
      expect(pricingFor('openai', 'gpt-4o')).toEqual({ input: 1, output: 2 });
      jest.useRealTimers();

      await loadAiPricing();
      expect(pricingFor('openai', 'gpt-4o')).toEqual({ input: 3, output: 4 });
      expect(source).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchOpenRouterPricing', () => {
    const payload = {
      data: [
        {
          id: 'openai/gpt-4o-mini',
          pricing: {
            prompt: '0.00000015',
            completion: '0.0000006',
            input_cache_read: '0.000000075',
            internal_reasoning: '0',
          },
        },
        { id: 'free/model', pricing: { prompt: '0', completion: '0' } },
        { id: 'broken/model', pricing: { prompt: 'n/a' } },
        { id: '', pricing: { prompt: '1', completion: '1' } },
        'not an object',
      ],
    };

    const okResponse = (body: unknown): Response =>
      ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

    it('turns the model list into a per-token table', async () => {
      const fetchMock = jest.fn().mockResolvedValue(okResponse(payload));

      const table = await fetchOpenRouterPricing({ fetch: fetchMock });

      expect(table['openai/gpt-4o-mini']).toEqual({
        input: 0.00000015,
        output: 0.0000006,
        cacheRead: 0.000000075,
        reasoning: 0,
        per: 1,
      });
      expect(table['free/model']).toEqual({ input: 0, output: 0, per: 1 });
      expect(table['broken/model']).toBeUndefined();
      expect(Object.keys(table)).toHaveLength(2);
    });

    it('skips a model with no pricing object at all', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(okResponse({ data: [{ id: 'a/b' }, { id: 'c/d', pricing: null }] }));

      await expect(fetchOpenRouterPricing({ fetch: fetchMock })).resolves.toEqual({});
    });

    it('reads the public list with no key by default', async () => {
      const fetchMock = jest.fn().mockResolvedValue(okResponse(payload));

      await fetchOpenRouterPricing({ fetch: fetchMock });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({ headers: {} }),
      );
    });

    it('keeps a cache-write rate when the list carries one', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        okResponse({
          data: [
            {
              id: 'anthropic/claude',
              pricing: {
                prompt: '0.000003',
                completion: '0.000015',
                input_cache_write: '0.00000375',
              },
            },
          ],
        }),
      );

      const table = await fetchOpenRouterPricing({ fetch: fetchMock });

      expect(table['anthropic/claude']).toMatchObject({ cacheWrite: 0.00000375 });
    });

    it('sends the key when one is given, and none otherwise', async () => {
      const fetchMock = jest.fn().mockResolvedValue(okResponse(payload));

      await fetchOpenRouterPricing({ fetch: fetchMock, apiKey: 'sk-test', url: 'https://mirror' });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://mirror',
        expect.objectContaining({ headers: { authorization: 'Bearer sk-test' } }),
      );
    });

    it('throws on a failed request or an unexpected payload', async () => {
      await expect(
        fetchOpenRouterPricing({
          fetch: jest.fn().mockResolvedValue({ ok: false, status: 503 }),
        }),
      ).rejects.toThrow('HTTP 503');

      await expect(
        fetchOpenRouterPricing({ fetch: jest.fn().mockResolvedValue(okResponse({})) }),
      ).rejects.toThrow('unexpected payload');
    });
  });
});
