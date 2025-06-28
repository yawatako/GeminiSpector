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
  const judge = `システムトーン: analytic_brief\n評価プロファイル:\n  - logic\n  - factuality\n  - creativity\n  - empathy\n  - brevity\n総合点を0〜10で出し、各軸にコメントをつける。`;
  const fact = `この文章の事実性を検証し、根拠を提示する。\n根拠が無い場合は「要出典」と答える。`;
  const criteriaList = criteria.join(', ');
  return `${judge}\n${fact}\n評価基準: ${criteriaList}\n\n評価対象:\n${text}\n\n以下のJSON形式で回答してください。\n{\n  \"summary\": \"string\",\n  \"scores\": [{ \"criterion\": \"logic\", \"score\": 0, \"comment\": \"\" }]
}`;
};

app.post('/text/evaluate', async (req, res) => {
  const { text, criteria = ['logic', 'factuality', 'creativity'], model = 'gemini-2.5-pro' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const prompt = buildPrompt(text, criteria);
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
  };

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    const textResp = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = textResp.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid Gemini response');
    const result = JSON.parse(match[0]);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to evaluate text' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
