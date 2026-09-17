import { MODULE_ID } from "../constants.js";
import { llmConfig } from "../settings.js";

function headers(cfg) {
  const h = { "Content-Type": "application/json" };
  if (cfg.apiKey) h.Authorization = `Bearer ${cfg.apiKey}`;
  if (cfg.provider === "openrouter") {
    h["HTTP-Referer"] = "https://github.com/Me0wX-LR/agentic-dj";
    h["X-Title"] = "Agentic DJ";
  }
  return h;
}

export async function chatComplete({ messages, tools, toolChoice = "auto", temperature, maxTokens, topP, json = false }) {
  const cfg = llmConfig();
  if (!cfg.baseUrl) throw new Error("LLM base URL is empty");
  const body = {
    model: cfg.model,
    messages,
    temperature: temperature ?? cfg.temperature
  };
  const tokenLimit = maxTokens ?? cfg.maxTokens;
  if (tokenLimit) body.max_tokens = tokenLimit;
  const nucleus = topP ?? cfg.topP;
  if (nucleus !== undefined && nucleus !== null && Number(nucleus) < 1) body.top_p = Number(nucleus);
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }
  if (json) body.response_format = { type: "json_object" };

  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM ${response.status}: ${text.slice(0, 400)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message ?? { role: "assistant", content: "" };
}

export async function chatJson(messages, schemaHint = "") {
  const extra = schemaHint ? `\nReturn ONLY valid JSON. ${schemaHint}` : "\nReturn ONLY valid JSON.";
  const cloned = messages.map(msg => ({ ...msg }));
  cloned[cloned.length - 1] = {
    ...cloned[cloned.length - 1],
    content: `${cloned[cloned.length - 1].content}${extra}`
  };
  try {
    const message = await chatComplete({ messages: cloned, json: true, tools: undefined });
    return parseJsonContent(message.content);
  } catch (err) {
    console.warn(`${MODULE_ID} | JSON mode unsupported, retrying plain chat`, err);
    const message = await chatComplete({ messages: cloned, json: false, tools: undefined });
    return parseJsonContent(message.content);
  }
}

export function parseJsonContent(content) {
  if (!content) return {};
  if (typeof content !== "string") return content;
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    console.warn(`${MODULE_ID} | JSON parse failed`, err);
    return {};
  }
}

export function extraSystem() {
  const extra = llmConfig().extraInstructions;
  return extra ? `\nGM extra instructions:\n${extra}` : "";
}
