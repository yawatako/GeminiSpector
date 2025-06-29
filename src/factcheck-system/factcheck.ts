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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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
  if ((data as any).error) {
    console.error('Gemini API error:', JSON.stringify(data));
    throw new Error('Gemini API error');
  }

  // 1️⃣ 候補が無い・空なら Safety ブロック扱いに
  if (!data.candidates || !data.candidates.length) {
    throw new Error('Gemini returned no candidates (possibly safety-blocked)');
  }

  // 2️⃣ finishReason を確認
  const cand = data.candidates[0];
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    // MAX_TOKENS は正常終了として許容
    if (cand.finishReason !== 'MAX_TOKENS') {
      throw new Error(`Gemini finishReason=${cand.finishReason} (safety?)`);
    } else {
      console.warn('Gemini output truncated (MAX_TOKENS)');
    }
  }

  // 3️⃣ 本文を取りに行く
  const text =
    cand.content?.parts?.[0]?.text ??
    cand.text ??
    '';
  if (!text.trim()) {
    throw new Error('Gemini returned empty text (safety-blocked or quota error)');
  }

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
