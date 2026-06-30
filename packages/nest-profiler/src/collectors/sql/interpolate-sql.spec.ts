import { interpolateSql } from './interpolate-sql';

describe('interpolateSql', () => {
  it('returns the sql untouched when there are no parameters', () => {
    expect(interpolateSql('SELECT 1')).toBe('SELECT 1');
    expect(interpolateSql('SELECT 1', [])).toBe('SELECT 1');
  });

  it('replaces positional ? placeholders in order (MySQL/MikroORM)', () => {
    expect(interpolateSql('SELECT * FROM users WHERE name = ? AND age > ?', ['John', 30])).toBe(
      "SELECT * FROM users WHERE name = 'John' AND age > 30",
    );
  });

  it('replaces indexed $N placeholders by position (Postgres/TypeORM)', () => {
    expect(
      interpolateSql('SELECT * FROM users WHERE id = $1 AND id <> $1 AND name = $2', [1, 'Jane']),
    ).toBe("SELECT * FROM users WHERE id = 1 AND id <> 1 AND name = 'Jane'");
  });

  it('formats every value type', () => {
    expect(interpolateSql('VALUES (?, ?, ?, ?, ?)', [null, true, false, "O'Brien", { a: 1 }])).toBe(
      `VALUES (NULL, TRUE, FALSE, 'O''Brien', '{"a":1}')`,
    );
  });

  it('formats Date and Buffer values', () => {
    const date = new Date('2026-06-21T00:00:00.000Z');
    expect(interpolateSql('SET t = ?', [date])).toBe("SET t = '2026-06-21T00:00:00.000Z'");
    expect(interpolateSql('SET b = ?', [Buffer.from([0xde, 0xad])])).toBe("SET b = X'dead'");
  });

  it('leaves placeholders without a matching parameter intact', () => {
    expect(interpolateSql('SELECT ?, ?', ['only'])).toBe("SELECT 'only', ?");
    expect(interpolateSql('SELECT $1, $2', ['only'])).toBe("SELECT 'only', $2");
  });
});
