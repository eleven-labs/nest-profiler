import {
  AI_CAPTURE_FIELDS,
  aiCaptureLevels,
  boundText,
  captureDiagnostic,
  captureLevelOf,
  captureSchema,
  captureText,
  captureUrl,
  captureValue,
  configureAiCapture,
  maxCapturedMessages,
  resetAiCapture,
} from './ai-capture';

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r';

describe('ai capture levels', () => {
  beforeEach(() => resetAiCapture());

  afterAll(() => resetAiCapture());

  it('records content masked by default', () => {
    expect(aiCaptureLevels()).toEqual({
      instructions: 'redacted',
      messages: 'redacted',
      completion: 'redacted',
      reasoning: 'redacted',
      toolDefinitions: 'redacted',
      toolArguments: 'redacted',
      toolResults: 'redacted',
      output: 'redacted',
      // The application's own runtime state is never pulled in by a blanket level.
      runtimeContext: 'none',
      // Nor are the raw provider bodies, which restate the whole prompt at every step.
      providerPayload: 'none',
    });
  });

  it('applies one level to every field, the opt-in fields aside', () => {
    configureAiCapture({ capture: 'metadata' });

    for (const field of AI_CAPTURE_FIELDS) {
      const optIn = field === 'runtimeContext' || field === 'providerPayload';
      expect(captureLevelOf(field)).toBe(optIn ? 'none' : 'metadata');
    }
  });

  it('records the runtime context only when it is named', () => {
    configureAiCapture({ capture: 'full' });
    expect(captureLevelOf('runtimeContext')).toBe('none');

    configureAiCapture({ capture: { default: 'none', runtimeContext: 'redacted' } });
    expect(captureLevelOf('runtimeContext')).toBe('redacted');
  });

  it('reads a group as the level of every field under it', () => {
    configureAiCapture({ capture: { default: 'full', prompt: 'metadata', tools: 'none' } });

    expect(captureLevelOf('instructions')).toBe('metadata');
    expect(captureLevelOf('messages')).toBe('metadata');
    expect(captureLevelOf('toolDefinitions')).toBe('none');
    expect(captureLevelOf('toolArguments')).toBe('none');
    expect(captureLevelOf('toolResults')).toBe('none');
    expect(captureLevelOf('completion')).toBe('full');
  });

  it('lets a field win over the group it belongs to', () => {
    configureAiCapture({ capture: { tools: 'none', toolResults: 'metadata' } });

    expect(captureLevelOf('toolArguments')).toBe('none');
    expect(captureLevelOf('toolResults')).toBe('metadata');
  });

  it('applies a level per field, falling back to the default', () => {
    configureAiCapture({ capture: { default: 'metadata', messages: 'none', completion: 'full' } });

    expect(captureLevelOf('messages')).toBe('none');
    expect(captureLevelOf('completion')).toBe('full');
    expect(captureLevelOf('reasoning')).toBe('metadata');
  });

  it('reads the deprecated boolean as a level', () => {
    configureAiCapture({ captureContent: false });
    expect(captureLevelOf('messages')).toBe('none');

    configureAiCapture({ captureContent: true });
    expect(captureLevelOf('messages')).toBe('redacted');
  });

  it('lets capture win over the deprecated boolean', () => {
    configureAiCapture({ captureContent: false, capture: 'full' });

    expect(captureLevelOf('messages')).toBe('full');
  });

  it('keeps the bounds it was configured with', () => {
    configureAiCapture({ maxTextLength: 5, maxMessages: 3 });

    expect(boundText('abcdefgh')).toBe('abcde…');
    expect(maxCapturedMessages()).toBe(3);
  });
});

describe('captureText', () => {
  beforeEach(() => resetAiCapture());
  afterAll(() => resetAiCapture());

  it('drops the text at none and describes it at metadata', () => {
    configureAiCapture({ capture: 'none' });
    expect(captureText('hello', 'messages')).toBeUndefined();

    configureAiCapture({ capture: 'metadata' });
    expect(captureText('hello', 'messages')).toBe('[text omitted · 5 chars]');
  });

  it('masks credentials and personal data at redacted', () => {
    const text = `token ${JWT} for alice.dupont@example.com on +33 6 12 34 56 78`;

    const captured = captureText(text, 'messages', { role: 'user' });

    expect(captured).not.toContain('eyJ');
    expect(captured).not.toContain('example.com');
    expect(captured).not.toContain('12 34 56');
    expect(captured).toContain('[REDACTED]');
  });

  it('keeps the text verbatim at full', () => {
    configureAiCapture({ capture: 'full' });

    expect(captureText(`hi ${JWT}`, 'completion')).toBe(`hi ${JWT}`);
  });

  it('masks before truncating, so a credential cannot survive the cut', () => {
    configureAiCapture({ maxTextLength: 40 });

    const captured = captureText(`please use ${JWT} now`, 'instructions');

    expect(captured).not.toContain('eyJ');
  });

  it('leaves personal data alone when pii detection is off', () => {
    configureAiCapture({ redaction: { pii: false } });

    expect(captureText('write to alice@example.com', 'messages')).toBe(
      'write to alice@example.com',
    );
  });

  it('applies the extra patterns it was given', () => {
    configureAiCapture({ redaction: { patterns: [/ORD-\d{4}/], replacement: '***' } });

    expect(captureText('order ORD-1234 shipped', 'completion')).toBe('order *** shipped');
  });

  it('runs the host sanitizer over every kept text, with its context', () => {
    const seen: string[] = [];
    configureAiCapture({
      capture: 'full',
      redaction: {
        sanitize: (text, context) => {
          seen.push(`${context.field}:${context.role ?? context.tool ?? '-'}`);
          return text.replace('Ada Lovelace', '[NAME]');
        },
      },
    });

    expect(captureText('hello Ada Lovelace', 'messages', { role: 'user' })).toBe('hello [NAME]');
    expect(captureText('hi', 'completion')).toBe('hi');
    expect(seen).toEqual(['messages:user', 'completion:-']);
  });

  it('masks what it keeps of a text far larger than the bound, and scans no further', () => {
    configureAiCapture({ maxTextLength: 20 });

    const captured = captureText(`${JWT} ${'x'.repeat(200_000)}`, 'messages');

    expect(captured).toBe('[REDACTED] xxxxxxxxx…');
  });

  it('ignores an empty or absent text', () => {
    expect(captureText(undefined, 'messages')).toBeUndefined();
    expect(captureText('', 'messages')).toBeUndefined();
  });
});

describe('captureValue', () => {
  beforeEach(() => resetAiCapture());
  afterAll(() => resetAiCapture());

  it('masks the values of keys that name a secret', () => {
    const captured = captureValue({ apiKey: 'abc', city: 'Paris' }, 'toolArguments', {
      tool: 'search',
    });

    expect(captured).toEqual({ apiKey: '[REDACTED]', city: 'Paris' });
  });

  it('masks the extra keys it was given', () => {
    configureAiCapture({ redaction: { keys: ['patientId'] } });

    expect(captureValue({ patientId: 'p-1', page: 2 }, 'toolArguments')).toEqual({
      patientId: '[REDACTED]',
      page: 2,
    });
  });

  it('describes the shape at metadata', () => {
    configureAiCapture({ capture: 'metadata' });

    expect(captureValue({ query: 'x', limit: 2 }, 'toolArguments')).toBe(
      '[object omitted · keys: query, limit]',
    );
    expect(captureValue([1, 2, 3], 'toolArguments')).toBe('[array omitted · 3 items]');
    expect(captureValue('secret answer', 'toolArguments')).toBe('[text omitted · 13 chars]');
    expect(captureValue(42, 'toolArguments')).toBe('[number omitted]');
    expect(captureValue({}, 'toolArguments')).toBe('[object omitted · no keys]');
  });

  it('drops the payload at none and keeps it whole at full', () => {
    configureAiCapture({ capture: 'none' });
    expect(captureValue({ apiKey: 'abc' }, 'toolArguments')).toBeUndefined();

    configureAiCapture({ capture: 'full' });
    expect(captureValue({ apiKey: 'abc' }, 'toolArguments')).toEqual({ apiKey: 'abc' });
  });

  it('treats a lone string payload as a text', () => {
    configureAiCapture({ maxTextLength: 12 });

    expect(captureValue(`answer ${JWT}`, 'toolArguments')).toBe('answer [REDA…');
    expect(captureValue('', 'toolArguments')).toBe('');
  });

  it('passes null and undefined through untouched', () => {
    expect(captureValue(null, 'toolArguments')).toBeNull();
    expect(captureValue(undefined, 'toolArguments')).toBeUndefined();
  });

  it('runs the host sanitizer over the strings of a payload', () => {
    configureAiCapture({
      redaction: { sanitize: (text) => text.replace('Ada', '[NAME]') },
    });

    expect(
      captureValue({ who: 'Ada', age: 36, nested: { list: ['Ada'] } }, 'toolArguments'),
    ).toEqual({
      who: '[NAME]',
      age: 36,
      nested: { list: ['[NAME]'] },
    });
  });

  it('keeps the built-in key list off when useDefaults is false', () => {
    configureAiCapture({ redaction: { useDefaults: false, keys: ['ticket'] } });

    expect(captureValue({ password: 'hunter2', ticket: 'T-1' }, 'toolArguments')).toEqual({
      password: 'hunter2',
      ticket: '[REDACTED]',
    });
  });
});

describe('captureSchema', () => {
  beforeEach(() => resetAiCapture());
  afterAll(() => resetAiCapture());

  it('keeps a schema readable: its keys are field names, not data', () => {
    const schema = {
      type: 'object',
      properties: { password: { type: 'string' }, token: { type: 'string' } },
    };

    expect(captureSchema(schema, 'toolDefinitions')).toEqual(schema);
  });

  it('still masks a credential left in the schema itself', () => {
    const captured = captureSchema(
      { type: 'string', examples: [`Bearer ${JWT}`] },
      'toolDefinitions',
    ) as { examples: string[] };

    expect(captured.examples[0]).toBe('Bearer [REDACTED]');
  });

  it('is dropped at metadata and at none', () => {
    configureAiCapture({ capture: 'metadata' });
    expect(captureSchema({ type: 'object' }, 'output')).toBeUndefined();

    configureAiCapture({ capture: 'none' });
    expect(captureSchema({ type: 'object' }, 'output')).toBeUndefined();
  });
});

describe('captureUrl', () => {
  beforeEach(() => resetAiCapture());
  afterAll(() => resetAiCapture());

  it('masks the credential a signed url carries in its query string', () => {
    const captured = captureUrl(
      'https://files.example.com/report.pdf?signature=abc123&page=2',
      'messages',
    );

    // Percent-encoded because the query is re-serialized, exactly as a captured request URL is.
    expect(captured).toBe('https://files.example.com/report.pdf?signature=%5BREDACTED%5D&page=2');
  });

  it('drops it at none and places it without the address at metadata', () => {
    configureAiCapture({ capture: 'none' });
    expect(captureUrl('https://example.com/a.pdf', 'messages')).toBeUndefined();

    configureAiCapture({ capture: 'metadata' });
    expect(captureUrl('https://example.com/a.pdf', 'messages')).toBe('[url omitted]');
  });

  it('keeps it whole at full', () => {
    configureAiCapture({ capture: 'full' });

    expect(captureUrl('https://example.com/a.pdf?token=abc', 'messages')).toBe(
      'https://example.com/a.pdf?token=abc',
    );
  });
});

describe('captureDiagnostic', () => {
  beforeEach(() => resetAiCapture());
  afterAll(() => resetAiCapture());

  it('keeps a provider error but masks what it quotes back', () => {
    const captured = captureDiagnostic(`rejected prompt: contact alice@example.com with ${JWT}`);

    expect(captured).toContain('rejected prompt');
    expect(captured).not.toContain('alice@example.com');
    expect(captured).not.toContain('eyJ');
  });

  it('is left alone when nothing is masked anywhere', () => {
    configureAiCapture({ capture: 'full' });

    expect(captureDiagnostic('failed on alice@example.com')).toBe('failed on alice@example.com');
  });

  it('is still masked when a single field asks for masking', () => {
    configureAiCapture({ capture: { default: 'full', messages: 'redacted' } });

    expect(captureDiagnostic('failed on alice@example.com')).toContain('[REDACTED]');
  });
});
