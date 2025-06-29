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
    const payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } };
    const resp = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!evaluate) return res.json({ reply });

    const evalPayload = { contents: [{ parts: [{ text: `${judgePrompt}\n${reply}` }] }], generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } } };
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
