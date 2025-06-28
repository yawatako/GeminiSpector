const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const conversationHistory = [];
const HISTORY_LIMIT = 10;

const loadPrompt = (filename) => {
  const filePath = path.join(process.cwd(), 'prompts', filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return '';
};

const personas = loadPrompt('personas.yaml');
const rulesPrompt = loadPrompt('rules_prompt.md');

app.post('/api/chat', async (req, res) => {
  const { message, evaluate } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message required' });
  }

  conversationHistory.push({ role: 'user', content: message });
  if (conversationHistory.length > HISTORY_LIMIT) {
    conversationHistory.shift();
  }

  const prompt = `${rulesPrompt}\n${personas}\nユーザー: ${message}`;

  let gptResponse;
  try {
    const geminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
    };
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    });
    const data = await geminiRes.json();
    gptResponse = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    conversationHistory.push({ role: 'assistant', content: gptResponse });
  } catch (err) {
    return res.status(500).json({ error: 'Gemini API error', details: err.message });
  }

  let evaluation = null;
  if (evaluate) {
    try {
      const judgePrompt = loadPrompt('judge_prompt.md');
      const geminiPayload = {
        contents: [{ parts: [{ text: `${judgePrompt}\n${gptResponse}` }] }],
        generationConfig: { temperature: 0.3 },
      };
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
      const geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload),
      });
      const data = await geminiRes.json();
      evaluation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch (err) {
      evaluation = `Gemini API error: ${err.message}`;
    }
  }

  res.json({ reply: gptResponse, evaluation });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

