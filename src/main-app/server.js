const express = require('express');
const dotenv = require('dotenv');
const { OpenAI } = require("openai");
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
    const completion = await openai.createChatCompletion({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: prompt }],
    });
    gptResponse = completion.data.choices[0].message.content.trim();
    conversationHistory.push({ role: 'assistant', content: gptResponse });
  } catch (err) {
    return res.status(500).json({ error: 'OpenAI API error', details: err.message });
  }

  let evaluation = null;
  if (evaluate) {
    try {
      const judgePrompt = loadPrompt('judge_prompt.md');
      const geminiPayload = {
        model: 'gemini-2.5-pro',
        prompt: `${judgePrompt}\n${gptResponse}`,
        temperature: 0.3,
      };
      const geminiRes = await fetch('https://api.gemini.google.com/v1/text/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GEMINI_API_KEY}`,
        },
        body: JSON.stringify(geminiPayload),
      });
      const data = await geminiRes.json();
      evaluation = data.choices?.[0]?.text?.trim() || null;
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

