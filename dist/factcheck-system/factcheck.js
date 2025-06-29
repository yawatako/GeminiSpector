"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractClaims = extractClaims;
exports.verifyClaim = verifyClaim;
exports.generateReport = generateReport;
const node_fetch_1 = __importDefault(require("node-fetch"));
/**
 * 任意テキストから主張を抽出する簡易実装
 */
function extractClaims(text) {
    const sentences = text.split(/[。!\?\n]/).map(s => s.trim()).filter(Boolean);
    const claims = [];
    for (const s of sentences) {
        const m = s.match(/^(.*?)は(.+)$/);
        if (m) {
            claims.push({ subject: m[1].trim(), predicate: m[2].trim() });
        }
        else {
            const [subject, ...rest] = s.split(/\s+/);
            claims.push({ subject, predicate: rest.join(' ') });
        }
    }
    return claims;
}
/**
 * Gemini API を用いて主張を検証
 */
async function verifyClaim(claim) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
        throw new Error('GEMINI_API_KEY is not set');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const prompt = `以下の主張が正しいか調べ、JSONで回答してください。公式サイトや複数ソースを優先して検索し、根拠となるURLと抜粋を示してください。\n主張: ${claim.subject} ${claim.predicate}${claim.object ? ' ' + claim.object : ''}`;
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
    };
    const res = await (0, node_fetch_1.default)(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok)
        throw new Error(`Gemini API error: ${res.status}`);
    const data = await res.json();
    if (data.error) {
        console.error('Gemini API error:', JSON.stringify(data));
        throw new Error('Gemini API error');
    }
    const text = (_j = (_f = (_e = (_d = (_c = (_b = (_a = data.candidates) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.text) !== null && _f !== void 0 ? _f : (_h = (_g = data.candidates) === null || _g === void 0 ? void 0 : _g[0]) === null || _h === void 0 ? void 0 : _h.text) !== null && _j !== void 0 ? _j : '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m)
        throw new Error('No JSON found in Gemini response');
    const result = JSON.parse(m[0]);
    result.claim = claim;
    return result;
}
/**
 * 検証結果からレポート生成
 */
function generateReport(results) {
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
