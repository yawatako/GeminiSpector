require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

/* ====== 1. 定数まわり ====== */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

const MODEL = "gemini-2.5-pro";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
  `?key=${GEMINI_API_KEY}`;

/* ====== 2. 共通呼び出し関数 ====== */
async function callGemini(prompt, { maxTokens, temperature } = {}) {
  const body = {
    contents: [
      {
        role: "user",            // ← 追加
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {}
  };
  if (maxTokens   !== undefined) body.generationConfig.maxOutputTokens = maxTokens;
  if (temperature !== undefined) body.generationConfig.temperature     = temperature;

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  console.log("[Gemini] status =", res.status);
  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();
  console.log("[Gemini] raw response =", JSON.stringify(data, null, 2));
  return data;
}

/* ====== 3. /generate エンドポイント ====== */
app.post("/generate", async (req, res) => {
  try {
    const { prompt, max_tokens, temperature } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const data = await callGemini(prompt, {
      maxTokens:   max_tokens,
      temperature: temperature
    });

    // candidates がなければエラー
    if (!data.candidates?.length) {
      console.error("Invalid Gemini response:", data);
      return res
        .status(500)
        .json({ error: "Invalid Gemini response: no candidates", raw: data });
    }

    // parts のテキストを結合
    const text = data.candidates
      .map(c => c.content.parts.map(p => p.text).join(""))
      .join("\n");

    res.json({ text, raw: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ====== 4. /text/evaluate ====== */
const DEFAULT_CRITERIA = ["logic", "factuality", "creativity"];

function buildEvalPrompt(text, criteria) {
  const judge =
    "システムトーン: analytic_brief\n" +
    "評価プロファイル:\n  - logic\n  - factuality\n  - creativity\n  - empathy\n  - brevity\n" +
    "総合点を0〜10で出し、各軸にコメントをつける。";
  const fact =
    "この文章の事実性を検証し、根拠を提示する。\n" +
    "根拠が無い場合は『要出典』と答える。";
  const list = criteria.join(", ");
  return `${judge}\n${fact}\n評価基準: ${list}\n\n評価対象:\n${text}\n\n` +
    `以下のJSON形式で回答してください。\n{\n  "summary": "string",\n  "scores": [{ "criterion": "logic", "score": 0, "comment": "" }]\n}`;
}

app.post("/text/evaluate", async (req, res) => {
  const { text, criteria = DEFAULT_CRITERIA } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  const prompt = buildEvalPrompt(text, criteria);
  try {
    const data = await callGemini(prompt, { maxTokens: 500, temperature: 0.3 });
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("Gemini response parse failed:", rawText);
      return res
        .status(500)
        .json({ error: "Geminiの応答が解析できませんでした", raw: rawText });
    }
    const result = JSON.parse(match[0]);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ====== 5. 起動 ====== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));