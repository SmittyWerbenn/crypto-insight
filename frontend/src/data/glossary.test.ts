import { describe, expect, it } from 'vitest';
import { GLOSSARY, findTerm, getTerm } from './glossary';

describe('glossary', () => {
  it('has unique ids and complete entries', () => {
    const ids = GLOSSARY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of GLOSSARY) {
      expect(t.short.length).toBeGreaterThan(10);
      expect(t.long.length).toBeGreaterThan(10);
    }
  });
  it('matches UI labels case-insensitively', () => {
    expect(findTerm('RSI (14)')?.id).toBe('rsi');
    expect(findTerm('max drawdown')?.id).toBe('drawdown');
    expect(findTerm('Cut loss di')?.id).toBe('stop-loss');
    expect(findTerm('Koin')).toBeUndefined();
    expect(getTerm('macd')?.term).toMatch(/MACD/);
  });
});
