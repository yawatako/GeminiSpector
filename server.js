require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const { extractClaims, verifyClaim, generateReport } = require('./dist/factcheck-system/factcheck.js');

const app = express();
app.use(express.json());

function logRequest(req, _res, next) {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, req.body);
  next();
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// ---- Gemini models & threshold ----
const GEMINI_MODEL_SCORE = 'gemini-2.5-flash';
const GEMINI_MODEL_FIX = 'gemini-2.5-flash';
const SCORE_THRESHOLD = 8;
const MAX_TOKENS_SCORE = 512;
const MAX_TOKENS_FIX = 2048;

function loadPrompt(filename) {
  const file = path.join(__dirname, 'prompts', filename);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

// ---- Prompt builders ----
function buildScorePrompt(text) {
  return `採点基準: correctness, sources\nコメント一切禁止。JSONのみ: {"correctness":<0-10>,"sources":[<URL>…]}\n---\n${text}`;
}

function buildFixPrompt(text, scoreJson) {
  return `次の文章は correctness ${scoreJson.correctness}/10 点でした。\nsources: ${scoreJson.sources.join(', ')}\n誤りを指摘し、正しい情報を盛り込んだ訂正文を作成してください。\nコメント一切禁止。JSONのみ:\n{"correctness":${scoreJson.correctness},"sources":[…],\n "correction":"…","explanation":"…"}\n---\n${text}`;
}

// ---- Common Gemini fetcher ----
async function fetchGemini(model, prompt, maxTokens = 512) {
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: maxTokens,
      candidateCount: 1,
      // stopSequences は一時的に解除
    }
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);

  // 1️⃣ 候補が無い・空なら Safety ブロック扱いに
  if (!data.candidates || !data.candidates.length) {
    throw new Error('Gemini returned no candidates (possibly safety-blocked)');
  }

  // 2️⃣ finishReason を確認
  const cand = data.candidates[0];
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    // MAX_TOKENS は正常終了扱いにする
    if (cand.finishReason !== 'MAX_TOKENS') {
      throw new Error(`Gemini finishReason=${cand.finishReason} (safety?)`);
    } else {
      console.warn('Gemini output truncated (MAX_TOKENS)');
    }
  }

  // 3️⃣ 本文を取りに行く
  const rawText = cand.content?.parts?.[0]?.text ?? '';
  if (!rawText.trim()) {
    throw new Error('Gemini returned empty text (safety-blocked or quota error)');
  }

  const jsonLike = rawText.replace(/^```json\n?|\n?```$/g, '');
  console.log('▼RAW', rawText.slice(0,300));
  let json;
  try {
    json = JSON.parse(jsonLike);
  } catch (e) {
    console.error('JSON parse fail', e.message);
    console.error('BODY', jsonLike.slice(0,500));
    throw e;
  }
  return json;
}

const personas = loadPrompt('personas.yaml');
const rulesPrompt = loadPrompt('rules_prompt.md');
const judgePrompt = loadPrompt('judge_prompt.md');

app.post('/api/chat', logRequest, async (req, res) => {
  const { message, evaluate } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const prompt = `${rulesPrompt}\n${personas}\nユーザー: ${message}`;
  try {
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const resp = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    if (data.error) {
      console.error('Gemini API error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Gemini API error' });
    }
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!evaluate) return res.json({ reply });

    const evalPayload = { contents: [{ parts: [{ text: `${judgePrompt}\n${reply}` }] }], generationConfig: { temperature: 0.3 } };
    const evalResp = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evalPayload) });
    const evalData = await evalResp.json();
    if (evalData.error) {
      console.error('Gemini API error:', JSON.stringify(evalData));
      return res.status(500).json({ error: 'Gemini API error' });
    }
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

app.post('/text/evaluate', logRequest, async (req, res) => {
  const { text, criteria } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    // ① 採点モード
    const scoreJson = await fetchGemini(
      GEMINI_MODEL_SCORE,
      buildScorePrompt(text),
      MAX_TOKENS_SCORE
    );
    // ② 判定
    if (scoreJson.correctness >= SCORE_THRESHOLD) {
      return res.json(scoreJson);
    }
    // ③ 訂正文モード
    const fixJson = await fetchGemini(
      GEMINI_MODEL_FIX,
      buildFixPrompt(text, scoreJson),
      MAX_TOKENS_FIX
    );
    const merged = { ...scoreJson, ...fixJson };
    res.json(merged);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gemini API error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
