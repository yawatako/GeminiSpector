require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

/* ====== 1. 定数まわり ====== */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

// 使用するGeminiモデルを統一
const MODEL = "gemini-2.5-pro";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
  `?key=${GEMINI_API_KEY}`;

/* ====== 2. 共通呼び出し関数 ====== */
async function callGemini(prompt, { maxTokens, temperature } = {}) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {}
  };
  if (maxTokens !== undefined)  body.generationConfig.maxOutputTokens = maxTokens;
  if (temperature !== undefined) body.generationConfig.temperature   = temperature;

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  console.log("[Gemini] status =", res.status);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ====== 3. /generate エンドポイント ====== */
app.post("/generate", async (req, res) => {
  try {
    const { prompt, max_tokens, temperature } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const data  = await callGemini(prompt, {
      maxTokens:   max_tokens,
      temperature: temperature
    });
    const text  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return res.json({ text, raw: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

/* ====== 4. /text/evaluate（ダミーのまま） ====== */
app.post("/text/evaluate", (req, res) => {
  console.log("Received /text/evaluate:", req.body);
  res.json({
    id: "dummy-id",
    created: Math.floor(Date.now() / 1000),
    evaluation: {
      summary: "これはダミーの評価結果です。",
      scores: [
        { criterion: "logic",      score: 0.9, comment: "論理的です" },
        { criterion: "factuality", score: 0.8, comment: "おおむね正確です" }
      ]
    }
  });
});

/* ====== 5. 起動 ====== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));