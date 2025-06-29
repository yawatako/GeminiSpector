require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Helper to build prompt

const buildPrompt = (text, criteria) => {
  const judge =
    "システムトーン: analytic_brief\n" +
    "評価プロファイル:\n  - logic\n  - factuality\n  - creativity\n  - empathy\n  - brevity\n" +
    "総合点を0〜10で出し、各軸にコメントをつける。";
  const fact =
    "この文章の事実性を検証し、根拠を提示する。\n" +
    "根拠が無い場合は『要出典』と答える。";
  const revise =
    "上記で誤りを指摘したあと、" +
    "「正しい所要時間」「正しい運賃」を反映したルート案内を、" +
    "同じ JSON フォーマットで再出力してください。";
  const list = criteria.join(', ');
  return (
    `${judge}\n${fact}\n評価基準: ${list}\n\n評価対象:\n${text}\n\n` +
    `以下のJSON形式で回答してください。\n{\n  \"summary\": \"string\",\n  \"scores\": [{ \"criterion\": \"logic\", \"score\": 0, \"comment\": \"\" }]\n}` +
    `\n\n${revise}`
  );
};
// Geminiの返答からJSON部分だけ抽出するユーティリティ
function extractJsonChunk(raw) {
  let s = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
  const start = s.indexOf('{');
  if (start < 0) return null;

  let depth = 0, end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end < 0) {
    end = s.length - 1;
    while (depth-- > 0) s += '}';
    end = s.length - 1;
  }

  let chunk = s.slice(start, end + 1);
  chunk = chunk.replace(/,(\s*[}\]])/g, '$1');
  return chunk;
}

function sanitizeJson(chunk) {
  let s = chunk;
  const qc = (s.match(/"/g) || []).length;
  if (qc % 2 !== 0) s += '"';
  const ob = (s.match(/\{/g) || []).length;
  const cb = (s.match(/\}/g) || []).length;
  if (ob > cb) s += '}'.repeat(ob - cb);
  return s;
}
app.post('/text/evaluate', async (req, res) => {
  const { text, criteria = ['logic', 'factuality', 'creativity'], model = 'gemini-2.5-flash' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const prompt = buildPrompt(text, criteria);
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 800,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    const textResp = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let jsonChunk = extractJsonChunk(textResp);
    if (!jsonChunk) {
      console.error('Gemini response parse failed:', textResp);
      return res.status(500).json({
        error: 'JSON 部分が見つかりませんでした',
        raw: textResp,
      });
    }
    jsonChunk = sanitizeJson(jsonChunk);

    try {
      const result = JSON.parse(jsonChunk);
      res.json(result);
    } catch (e) {
      console.error('JSON parse error:', e, '\nchunk:\n', jsonChunk);
      return res.status(500).json({
        error: 'JSON parse error',
        details: e.message,
        raw: textResp,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to evaluate text' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
