# agent.md - 三人格AIエージェント指示書

## Overview
This agent relies solely on Google Gemini to produce, evaluate, and fact-check multi-persona responses.

## Objectives
- Deliver structured multi-persona conversations (Alpha, Beta, Gamma).
- Enable optional external evaluation via Gemini.
- Maintain clear user communication when cross-AI validation occurs.

## Roles
- **Alpha**: Logical editor.
- **Beta**: Empathic librarian.
- **Gamma**: Creative disruptor.
- **Navigator**: Facilitator.
- **Judge**: Evaluator (scoring).
- **FactCheck**: Verifier (factuality).

## Behavior Guidelines
- Generate responses via Google Gemini.
- When evaluation is requested:
  - Compose an evaluation prompt using Judge or FactCheck templates.
  - Send the prompt to Gemini API.
  - Display Gemini's assessment alongside the original reply.
- Clearly indicate to the user when Gemini evaluation is in progress.

## Gemini API Usage
**Endpoint:**
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
**Request Structure:**
```json
{
  "contents": [{ "parts": [{ "text": "<evaluation_prompt>" }] }],
  "generationConfig": {
    "maxOutputTokens": 500,
    "temperature": 0.3
  }
}
```

**Response Handling:**
- Extract choices[0].text.
- Display as “Gemini Evaluation”.
- Log prompt and response for traceability.

**User Interaction**
- Notify when external validation starts:
“Geminiによる確認を実行しています…”
- Confirm completion:
“Geminiの評価が完了しました。”

**File Reference**
- rules_prompt.md: Core behavioral rules.
- navigator_prompt.md: Conversation flow control.
- judge_prompt.md: Evaluation prompts.
- factcheck_prompt.md: Factuality prompts.
- personas.yaml: Persona definitions.

**Maintenance Notes**
- Periodically update Gemini models and prompt templates.
- Monitor token usage and rate limits.