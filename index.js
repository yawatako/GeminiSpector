require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const { createLogger, format, transports } = require("winston");
const { v4: uuid } = require("uuid");
const { extractClaims, verifyClaim, generateReport } = require("./src/factcheck");

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console(), new transports.File({ filename: "app.log" })]
});

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  req.id = uuid();
  req.logger = logger.child({ reqId: req.id });
  next();
});

/* ====== 1. 定数まわり ====== */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

const MODEL = "gemini-2.5-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
  `?key=${GEMINI_API_KEY}`;

/* ====== 2. 共通呼び出し関数 ====== */
async function callGemini(req, prompt, { maxTokens, temperature } = {}) {
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

  req.logger.info("Gemini request", { model: MODEL, promptLen: prompt.length });
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  req.logger.info("Gemini response status", { status: res.status });
  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();
  req.logger.info("Gemini response", {
    status: res.status,
    finishReason: data.candidates?.[0]?.finishReason,
    usage: data.usageMetadata
  });
  const fin = data.candidates?.[0]?.finishReason;
  if (fin === "MAX_TOKENS") {
    req.logger.warn("Response truncated", { maxTokens });
  }
  return data;
}

// callGemini をラップして、MAX_TOKENS に達したら段階的に再試行
async function callGeminiWithRetry(req, prompt, opts = {}) {
  let { maxTokens = 800, temperature } = opts;
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    data = await callGemini(req, prompt, { maxTokens, temperature });
    const reason = data.candidates?.[0]?.finishReason;
    if (reason !== "MAX_TOKENS") {
      return data;
    }
    req.logger.warn("Response truncated, retrying with more tokens", {
      attempt: attempt + 1,
      prevMaxTokens: maxTokens,
    });
    maxTokens = Math.min(maxTokens * 2, 4096);
  }
  return data;
}

/* ====== 3. /generate エンドポイント ====== */
app.post("/generate", async (req, res, next) => {
  try {
    const { prompt, max_tokens, temperature } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const data = await callGemini(req, prompt, {
      maxTokens:   max_tokens,
      temperature: temperature
    });

    // candidates がなければエラー
    if (!data.candidates?.length) {
      req.logger.error("Invalid Gemini response", { raw: data });
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
    next(err);
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
  const revise =
    "上記で誤りを指摘したあと、" +
    "「正しい所要時間」「正しい運賃」を反映したルート案内を、" +
    "同じ JSON フォーマットで再出力してください。";
  const list = criteria.join(", ");
  return (
    `${judge}\n${fact}\n評価基準: ${list}\n\n評価対象:\n${text}\n\n` +
    `以下のJSON形式で回答してください。\n{\n  "summary": "string",\n  "scores": [{ "criterion": "logic", "score": 0, "comment": "" }]\n}` +
    `\n\n${revise}`
  );
}

// 出力からJSON部分だけを抜き出すユーティリティ
function extractJsonChunk(raw) {
  let s = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  if (start < 0) return null;
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
  if (end < 0) return null;
  // 末尾カンマ削除
  return s.slice(start, end + 1).replace(/,(\s*[}\]])/g, "$1");
}

function sanitizeJson(chunk) {
  let s = chunk;
  const qc = (s.match(/"/g) || []).length;
  if (qc % 2 !== 0) s += `"`;
  const ob = (s.match(/\{/g) || []).length;
  const cb = (s.match(/\}/g) || []).length;
  if (ob > cb) s += "}".repeat(ob - cb);
  return s;
}

app.post("/text/evaluate", async (req, res, next) => {
  const { text, criteria = DEFAULT_CRITERIA } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  const prompt = buildEvalPrompt(text, criteria);
  try {
    // MAX_TOKENS で切られた場合は自動でトークン数を増やして再試行
    const data = await callGeminiWithRetry(req, prompt, {
      maxTokens: 800,
      temperature: 0.3
    });
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // JSON部分を抽出
    let jsonChunk = extractJsonChunk(rawText);
    if (!jsonChunk) {
      req.logger.error("JSON chunk not found", { raw: rawText });
      return res
        .status(500)
        .json({ error: "JSON 部分が見つかりませんでした", raw: rawText });
    }

    jsonChunk = sanitizeJson(jsonChunk);

    // パースして返却
    try {
      const result = JSON.parse(jsonChunk);
      return res.json(result);
    } catch (e) {
      req.logger.error("JSON parse error", { err: e.message, chunk: jsonChunk });
      return res
        .status(500)
        .json({ error: "JSON parse error", details: e.message, raw: rawText });
    }
  } catch (err) {
    next(err);
  }
});

app.post("/factcheck", async (req, res, next) => {
  const { routeText } = req.body;
  if (!routeText) return res.status(400).json({ error: "routeText required" });

  const prompt = buildEvalPrompt(routeText, DEFAULT_CRITERIA);
  try {
    const data = await callGemini(req, prompt, { maxTokens: 800, temperature: 0.3 });
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let jsonChunk = extractJsonChunk(rawText);
    if (!jsonChunk) {
      return res.status(500).json({ error: "JSON 部分が見つかりません", raw: rawText });
    }
    jsonChunk = sanitizeJson(jsonChunk);
    const result = JSON.parse(jsonChunk);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/revise-route", async (req, res, next) => {
  const { routeText, factcheck } = req.body;
  if (!routeText || !factcheck) {
    return res.status(400).json({ error: "routeText and factcheck required" });
  }
  const revisePrompt = `\n以下はルート説明と、その事実チェック結果です：\n---\nルート説明：\n${routeText}\n\nチェック結果：\n${JSON.stringify(factcheck, null, 2)}\n\n指摘された箇所を必ず正しい値で修正しつつ、全体を同じフォーマットのJSONで再生成してください。`;
  try {
    const data = await callGemini(req, revisePrompt, { maxTokens: 800, temperature: 0.3 });
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let jsonChunk = extractJsonChunk(rawText);
    if (!jsonChunk) {
      return res.status(500).json({ error: "JSON 部分が見つかりません", raw: rawText });
    }
    jsonChunk = sanitizeJson(jsonChunk);
    const result = JSON.parse(jsonChunk);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get("/factcheck", async (req, res, next) => {
  const { date, time } = req.query;
  if (!date || !time) {
    return res.status(400).json({ error: "date and time required" });
  }
  try {
    const prompt = `宇佐八幡から大分空港までのバス情報を教えてください。日付:${date} 時刻:${time}`;
    const data = await callGemini(req, prompt, { maxTokens: 800, temperature: 0.3 });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    const claims = extractClaims(text);
    const verifications = await Promise.all(claims.map(c => verifyClaim(c)));
    const report = generateReport(verifications);
    res.json({ report, verifications });
  } catch (err) {
    next(err);
  }
});

// エラーハンドリング
app.use((err, req, res, next) => {
  req.logger.error("Unhandled error", { stack: err.stack });
  res.status(500).json({ error: "Internal server error", reqId: req.id });
});

/* ====== 5. 起動 ====== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => logger.info("Server running", { port: PORT }));
