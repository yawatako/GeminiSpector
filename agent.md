# agent.md - 三人格AIエージェント指示書

## Overview
This agent integrates OpenAI GPT-4.1 (primary generator) and Gemini (auxiliary evaluator) to produce, evaluate, and fact-check multi-persona responses.

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
- Generate responses primarily via GPT-4.1.
- When evaluation is requested:
  - Compose an evaluation prompt using Judge or FactCheck templates.
  - Send the prompt to Gemini API.
  - Display Gemini's assessment alongside the original reply.
- Clearly indicate to the user when Gemini evaluation is in progress.

## Gemini API Usage
**Endpoint:**
POST https://api.gemini.google.com/v1/text/generate

**Request Structure:**
```json
{
  "model": "gemini-2.5-pro",
  "prompt": "<evaluation_prompt>",
  "max_tokens": 500,
  "temperature": 0.3
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