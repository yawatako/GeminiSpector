require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

/* ====== 1. 定数まわり ====== */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

const MODEL = "gemini-2.5-flash";
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
    generationConfig: {
      thinkingConfig: { thinkingBudget: 0 }
    }
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
  const fin = data.candidates?.[0]?.finishReason;
  if (fin === "MAX_TOKENS") {
    console.warn(
      "[Gemini] response truncated by MAX_TOKENS; consider increasing maxTokens"
    );
  }
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

// 出力からJSON部分だけを抜き出すユーティリティ
function extractJsonChunk(raw) {
  // ```json などのフェンスを除去
  let s = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();

  // 最初の { の位置
  const start = s.indexOf("{");
  if (start < 0) return null;

  // 深さカウントで対応する } を探す
  let depth = 0,
    end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  // 閉じ括弧が不足している場合は補完
  if (end < 0) {
    end = s.length - 1;
    while (depth-- > 0) s += "}";
    end = s.length - 1;
  }

  let chunk = s.slice(start, end + 1);

  // 末尾の余分なカンマを除去
  chunk = chunk.replace(/,(\s*[}\]])/g, "$1");
  return chunk;
}

app.post("/text/evaluate", async (req, res) => {
  const { text, criteria = DEFAULT_CRITERIA } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  const prompt = buildEvalPrompt(text, criteria);
  try {
    // MAX_TOKENS で切られないように余裕を持って 800 トークンに
    const data = await callGemini(prompt, { maxTokens: 800, temperature: 0.3 });
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // JSON部分を抽出
    const jsonChunk = extractJsonChunk(rawText);
    if (!jsonChunk) {
      console.error("JSON chunk not found:", rawText);
      return res
        .status(500)
        .json({ error: "JSON 部分が見つかりませんでした", raw: rawText });
    }

    // パースして返却
    try {
      const result = JSON.parse(jsonChunk);
      return res.json(result);
    } catch (e) {
      console.error("JSON parse error:", e, "\nchunk:\n", jsonChunk);
      return res
        .status(500)
        .json({ error: "JSON parse error", details: e.message, raw: rawText });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ====== 5. 起動 ====== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));