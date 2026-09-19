export const MODULE_ID = "agentic-dj";
export const VERSION = "0.1.18";
export const FLAG_SCOPE = "agentic-dj";
export const FLAG_CARD = "card";

/**
 * Shipped defaults. Sampling numbers are for a tool-using DJ, not a creative writer.
 * See README "Default values" for the engineering rationale.
 */
export const DEFAULTS = {
  llmProvider: "openrouter",
  llmBaseUrl: "https://openrouter.ai/api/v1",
  llmModel: "openai/gpt-4o-mini",
  llmTemperature: 0.4,
  llmMaxTokens: 900,
  llmTopP: 1,
  sttProvider: "webspeech",
  sttBaseUrl: "",
  sttModel: "whisper-1",
  extraInstructions: "",
  uiLanguage: "auto",
  autoAnalyze: true,
  cooldown: 20,
  maxProposals: 3
};

/** OpenAI-compatible hosts must end in /v1. ChatAnywhere users often paste the host only. */
export function normalizeLlmBaseUrl(url) {
  let value = String(url || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (!/\/v\d+$/i.test(value)) value += "/v1";
  return value;
}

export const LLM_PRESETS = {
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini"
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile"
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  },
  chatanywhere: {
    label: "ChatAnywhere",
    baseUrl: "https://api.chatanywhere.org/v1",
    model: "gpt-4o-mini"
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1"
  },
  custom: {
    label: "Custom OpenAI-compatible",
    baseUrl: "",
    model: ""
  }
};

export const STT_PRESETS = {
  webspeech: {
    label: "Web Speech API (browser, no key)"
  },
  whisper: {
    label: "Whisper-compatible HTTP",
    baseUrl: "https://api.openai.com/v1",
    model: "whisper-1"
  },
  groq: {
    label: "Groq Whisper",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo"
  },
  deepgram: {
    label: "Deepgram",
    baseUrl: "https://api.deepgram.com/v1/listen",
    model: "nova-2"
  }
};

export const MOODS = [
  "ambient",
  "exploration",
  "mystery",
  "tension",
  "combat",
  "epic",
  "social",
  "tavern",
  "sad",
  "horror",
  "victory",
  "travel"
];

export const DIRECTOR_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_foundry_context",
      description: "Read the current Foundry scene, combat state, recent chat, transcript, and currently playing music.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function",
    function: {
      name: "search_catalog",
      description: "Search the music catalog with BM25 then rerank by use-when, tags, mood, and intensity. Query in any language. Returns ranked track cards.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          mood: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          intensity: { type: "number", minimum: 1, maximum: 5 },
          limit: { type: "integer", minimum: 1, maximum: 12 }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "verify_candidates",
      description: "Check proposed tracks against catalog features and session memory. Drops banned, recently played, or contradictory cues.",
      parameters: {
        type: "object",
        properties: {
          soundIds: { type: "array", items: { type: "string" } },
          intendedMood: { type: "string" },
          intendedIntensity: { type: "number" }
        },
        required: ["soundIds"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "propose_cues",
      description: "Finish planning and present 2-3 cue suggestions to the GM. Never auto-plays.",
      parameters: {
        type: "object",
        properties: {
          cues: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                soundId: { type: "string" },
                why: { type: "string" }
              },
              required: ["soundId", "why"]
            }
          },
          plan: { type: "string" }
        },
        required: ["cues"],
        additionalProperties: false
      }
    }
  }
];
