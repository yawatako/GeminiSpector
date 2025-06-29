import fetch from 'node-fetch';
import { Claim, Verification } from './types';

/**
 * 任意テキストから主張を抽出する簡易実装
 */
export function extractClaims(text: string): Claim[] {
  const sentences = text.split(/[。!\?\n]/).map(s => s.trim()).filter(Boolean);
  const claims: Claim[] = [];
  for (const s of sentences) {
    const m = s.match(/^(.*?)は(.+)$/);
    if (m) {
      claims.push({ subject: m[1].trim(), predicate: m[2].trim() });
    } else {
      const [subject, ...rest] = s.split(/\s+/);
      claims.push({ subject, predicate: rest.join(' ') });
    }
  }
  return claims;
}

/**
 * Gemini API を用いて主張を検証
 */
export async function verifyClaim(claim: Claim): Promise<Verification> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

  const prompt = `以下の主張が正しいか調べ、JSONで回答してください。公式サイトや複数ソースを優先して検索し、根拠となるURLと抜粋を示してください。\n主張: ${claim.subject} ${claim.predicate}${claim.object ? ' ' + claim.object : ''}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  } as any;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  const text =
    data.candidates?.[0]?.content?.parts?.[0]?.text ??
    data.candidates?.[0]?.text ??
    '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON found in Gemini response');
  const result = JSON.parse(m[0]) as Verification;
  result.claim = claim;
  return result;
}

/**
 * 検証結果からレポート生成
 */
export function generateReport(results: Verification[]): string {
  const lines = ['### FactCheck レポート'];
  for (const r of results) {
    const claimText = `${r.claim.subject} ${r.claim.predicate}${r.claim.object ? ' ' + r.claim.object : ''}`.trim();
    lines.push(`- **Claim:** ${claimText}`);
    lines.push(`  - ${r.isCorrect ? '✅ 正しい' : '❌ 誤り'}`);
    if (r.evidence && r.evidence.length) {
      lines.push('  - 根拠:');
      r.evidence.forEach((e, idx) => {
        lines.push(`    ${idx + 1}. ${e.url} … "${e.snippet}"`);
      });
    }
  }
  return lines.join('\n');
}
