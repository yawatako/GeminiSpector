require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// Simple CORS support
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.post('/generate', async (req, res) => {
  const { prompt, max_tokens, temperature } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'prompt required' });
  }

  const body = { prompt };
  if (max_tokens !== undefined) body.max_tokens = max_tokens;
  if (temperature !== undefined) body.temperature = temperature;

  try {
    const response = await fetch('https://api.gemini.google.com/v1/text/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GEMINI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    const text = data.text || data.choices?.[0]?.text || '';
    return res.json({ text });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to generate text' });
  }
});

// Dummy evaluation endpoint
app.post('/text/evaluate', (req, res) => {
  // Log incoming JSON
  console.log('Received /text/evaluate:', req.body);

  const dummyResponse = {
    id: 'dummy-id',
    created: Math.floor(Date.now() / 1000),
    evaluation: {
      summary: 'これはダミーの評価結果です。',
      scores: [
        { criterion: 'logic', score: 0.9, comment: '論理的です' },
        { criterion: 'factuality', score: 0.8, comment: 'おおむね正確です' }
      ]
    }
  };

  res.setHeader('Content-Type', 'application/json');
  res.json(dummyResponse);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
