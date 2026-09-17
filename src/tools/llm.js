import { logError, logInfo, logWarn } from "../debug/log.js";
import { llmConfig, publicLlmConfig } from "../settings.js";

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
  if (!cfg.baseUrl) {
    logError("llm.config.empty", publicLlmConfig());
    throw new Error("LLM base URL is empty");
  }
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

  const url = `${cfg.baseUrl}/chat/completions`;
  const started = Date.now();
  logInfo("llm.request", {
    url,
    jsonMode: json,
    toolCount: tools?.length ?? 0,
    messageCount: messages?.length ?? 0,
    ...publicLlmConfig()
  });
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
  } catch (err) {
    logError("llm.fetch.failed", { url, error: err, elapsedMs: Date.now() - started });
    throw err;
  }
  if (!response.ok) {
    const text = await response.text();
    logError("llm.response.error", {
      url,
      status: response.status,
      body: text.slice(0, 800),
      elapsedMs: Date.now() - started
    });
    throw new Error(`LLM ${response.status}: ${text.slice(0, 400)}`);
  }
  const data = await response.json();
  const message = data.choices?.[0]?.message ?? { role: "assistant", content: "" };
  logInfo("llm.response.ok", {
    url,
    status: response.status,
    elapsedMs: Date.now() - started,
    finish: data.choices?.[0]?.finish_reason,
    usage: data.usage,
    toolCalls: (message.tool_calls ?? []).map(call => call.function?.name).filter(Boolean),
    contentChars: String(message.content || "").length,
    contentPreview: String(message.content || "").slice(0, 240)
  });
  return message;
}

export async function chatJson(messages, schemaHint = "", { maxTokens } = {}) {
  const extra = schemaHint ? `\nReturn ONLY valid JSON. ${schemaHint}` : "\nReturn ONLY valid JSON.";
  const cloned = messages.map(msg => ({ ...msg }));
  cloned[cloned.length - 1] = {
    ...cloned[cloned.length - 1],
    content: `${cloned[cloned.length - 1].content}${extra}`
  };
  try {
    const message = await chatComplete({ messages: cloned, json: true, tools: undefined, maxTokens });
    return parseJsonContent(message.content);
  } catch (err) {
    logWarn("llm.json.retry", { error: err });
    const message = await chatComplete({ messages: cloned, json: false, tools: undefined, maxTokens });
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
    logWarn("llm.json.parse", { error: err, preview: String(content).slice(0, 240) });
    return {};
  }
}

export function extraSystem() {
  const extra = llmConfig().extraInstructions;
  return extra ? `\nGM extra instructions:\n${extra}` : "";
}
