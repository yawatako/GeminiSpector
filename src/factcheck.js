const fetch = require('node-fetch');

/**
 * Claim type
 * @typedef {Object} Claim
 * @property {string} from - 出発地
 * @property {string} to - 到着地
 * @property {string} duration - 所要時間 (例 "66分")
 * @property {string} fare - 運賃 (例 "¥1,550")
 */

/**
 * Verification type
 * @typedef {Object} Verification
 * @property {Claim}  claim
 * @property {boolean} isDurationCorrect
 * @property {boolean} isFareCorrect
 * @property {string} officialDuration
 * @property {string} officialFare
 * @property {string} sourceUrl
 */

const NAVITIME_API_KEY = process.env.NAVITIME_API_KEY || '';

/**
 * Geminiからの応答テキストからClaimを抽出
 * @param {string} geminiResponse
 * @returns {Claim[]}
 */
function extractClaims(geminiResponse) {
  const results = [];
  const regex = /([\w\p{sc=Han}]+)→([\w\p{sc=Han}]+).*?所要時間[:：]?\s*([0-9]+分).*?運賃[:：]?\s*(¥?\d+(?:,\d+)?)/gu;
  let m;
  while ((m = regex.exec(geminiResponse)) !== null) {
    results.push({
      from: m[1],
      to: m[2],
      duration: m[3],
      fare: m[4]
    });
  }
  return results;
}

/**
 * 公式APIを使ってClaimを検証
 * @param {Claim} claim
 * @returns {Promise<Verification>}
 */
async function verifyClaim(claim) {
  const params = new URLSearchParams({
    from: claim.from,
    to: claim.to,
    key: NAVITIME_API_KEY
  });
  const url = `https://api.navitime.co.jp/route/v1/bus?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Navitime API error: ${res.status}`);
  const data = await res.json();

  const officialDuration = data.result?.duration || data.duration || '';
  const officialFare = data.result?.fare || data.fare || '';

  return {
    claim,
    isDurationCorrect: claim.duration === officialDuration,
    isFareCorrect: claim.fare === officialFare,
    officialDuration,
    officialFare,
    sourceUrl: url
  };
}

/**
 * Verification配列からMarkdownレポート生成
 * @param {Verification[]} results
 * @returns {string}
 */
function generateReport(results) {
  const lines = ['◆FactCheck結果'];
  for (const r of results) {
    lines.push(`– Claim: “${r.claim.from}→${r.claim.to}”`);
    lines.push(
      `  → 所要時間: ${r.isDurationCorrect ? `✔︎ (${r.claim.duration})` : `✖︎ (公式: ${r.officialDuration})`}`
    );
    lines.push(
      `  → 運賃: ${r.isFareCorrect ? `✔︎ (${r.claim.fare})` : `✖︎ (公式: ${r.officialFare})`}`
    );
    if (r.sourceUrl) lines.push(`  → 根拠: ${r.sourceUrl}`);
  }
  return lines.join('\n');
}

module.exports = { extractClaims, verifyClaim, generateReport };
