import { extractClaims } from '../src/factcheck-system/factcheck';

describe('extractClaims', () => {
  it('extracts claims from Japanese text', () => {
    const text = '宇佐八幡から大分空港まで直通バスがある。所要時間は66分です。';
    const claims = extractClaims(text);
    expect(claims.length).toBeGreaterThan(0);
  });
});
