require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const { extractClaims, verifyClaim, generateReport } = require('./dist/factcheck-system/factcheck.js');

const app = express();
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

function loadPrompt(filename) {
  const file = path.join(__dirname, 'prompts', filename);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

const personas = loadPrompt('personas.yaml');
const rulesPrompt = loadPrompt('rules_prompt.md');
const judgePrompt = loadPrompt('judge_prompt.md');

app.post('/api/chat', async (req, res) => {
  const { message, evaluate } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const prompt = `${rulesPrompt}\n${personas}\nユーザー: ${message}`;
  try {
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const resp = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!evaluate) return res.json({ reply });

    const evalPayload = { contents: [{ parts: [{ text: `${judgePrompt}\n${reply}` }] }], generationConfig: { temperature: 0.3 } };
    const evalResp = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evalPayload) });
    const evalData = await evalResp.json();
    const evaluation = evalData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    res.json({ reply, evaluation });
  } catch (err) {
    res.status(500).json({ error: 'Gemini API error', details: err.message });
  }
});

app.post('/factcheck', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const claims = extractClaims(text);
    const verifications = await Promise.all(claims.map(c => verifyClaim(c)));
    const report = generateReport(verifications);
    res.json({ report, details: verifications });
  } catch (err) {
    res.status(500).json({ error: 'internal error' });
  }
});

app.post('/text/evaluate', async (req, res) => {
  const { text, criteria } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const list = Array.isArray(criteria) && criteria.length ? criteria.join(', ') : '総合';
  const prompt = `以下の文章を次の評価基準で10点満点で採点し、JSON形式で回答してください。\n評価基準: ${list}\n文章:\n${text}`;
  try {
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 }
    };
    const resp = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    const output = data.candidates?.[0]?.output || data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = output.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { summary: null, scores: [] };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Gemini API error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
