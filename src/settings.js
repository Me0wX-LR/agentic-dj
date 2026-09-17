import { DEFAULTS, LLM_PRESETS, MODULE_ID, STT_PRESETS, normalizeLlmBaseUrl } from "./constants.js";
import { AgenticDjSettings } from "./ui/settings-app.js";

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function numericSetting(key, fallback) {
  const value = Number(setting(key));
  return Number.isFinite(value) ? value : fallback;
}

export function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "configMenu", {
    name: "AGENTICDJ.SettingsMenu",
    label: "AGENTICDJ.SettingsMenuLabel",
    hint: "AGENTICDJ.SettingsMenuHint",
    icon: "fa-solid fa-headphones",
    type: AgenticDjSettings,
    restricted: true
  });

  const client = { scope: "client", config: false };
  const world = { scope: "world", config: false };

  game.settings.register(MODULE_ID, "llmProvider", { ...client, type: String, default: DEFAULTS.llmProvider });
  game.settings.register(MODULE_ID, "llmBaseUrl", { ...client, type: String, default: DEFAULTS.llmBaseUrl });
  game.settings.register(MODULE_ID, "llmModel", { ...client, type: String, default: DEFAULTS.llmModel });
  game.settings.register(MODULE_ID, "llmApiKey", { ...client, type: String, default: "" });
  game.settings.register(MODULE_ID, "llmApiKeyHint", { ...client, type: String, default: "" });
  game.settings.register(MODULE_ID, "sttProvider", { ...client, type: String, default: DEFAULTS.sttProvider });
  game.settings.register(MODULE_ID, "sttBaseUrl", { ...client, type: String, default: DEFAULTS.sttBaseUrl });
  game.settings.register(MODULE_ID, "sttModel", { ...client, type: String, default: DEFAULTS.sttModel });
  game.settings.register(MODULE_ID, "sttApiKey", { ...client, type: String, default: "" });
  game.settings.register(MODULE_ID, "sttApiKeyHint", { ...client, type: String, default: "" });
  game.settings.register(MODULE_ID, "extraInstructions", { ...world, type: String, default: DEFAULTS.extraInstructions });
  game.settings.register(MODULE_ID, "llmTemperature", { ...client, type: Number, default: DEFAULTS.llmTemperature });
  game.settings.register(MODULE_ID, "llmMaxTokens", { ...client, type: Number, default: DEFAULTS.llmMaxTokens });
  game.settings.register(MODULE_ID, "llmTopP", { ...client, type: Number, default: DEFAULTS.llmTopP });
  game.settings.register(MODULE_ID, "autoAnalyze", { ...world, type: Boolean, default: DEFAULTS.autoAnalyze });
  game.settings.register(MODULE_ID, "cooldown", { ...world, type: Number, default: DEFAULTS.cooldown });
  game.settings.register(MODULE_ID, "maxProposals", { ...world, type: Number, default: DEFAULTS.maxProposals });
  game.settings.register(MODULE_ID, "learnedMemory", { ...world, type: Object, default: {} });
  game.settings.register(MODULE_ID, "manualCatalogDraft", { ...world, type: String, default: "" });
}

export function llmConfig() {
  const provider = setting("llmProvider");
  const preset = LLM_PRESETS[provider] ?? LLM_PRESETS.custom;
  return {
    provider,
    baseUrl: normalizeLlmBaseUrl(setting("llmBaseUrl") || preset.baseUrl || ""),
    model: setting("llmModel") || preset.model,
    apiKey: setting("llmApiKey") || "",
    extraInstructions: setting("extraInstructions") || "",
    temperature: clamp(numericSetting("llmTemperature", DEFAULTS.llmTemperature), 0, 2),
    maxTokens: Math.round(clamp(numericSetting("llmMaxTokens", DEFAULTS.llmMaxTokens), 64, 4000)),
    topP: clamp(numericSetting("llmTopP", DEFAULTS.llmTopP), 0, 1)
  };
}

export function sttConfig() {
  const provider = setting("sttProvider");
  const preset = STT_PRESETS[provider] ?? STT_PRESETS.webspeech;
  return {
    provider,
    baseUrl: (setting("sttBaseUrl") || preset.baseUrl || "").replace(/\/$/, ""),
    model: setting("sttModel") || preset.model || "",
    apiKey: setting("sttApiKey") || ""
  };
}

export function hasLlmKey() {
  const cfg = llmConfig();
  if (cfg.provider === "ollama") return Boolean(cfg.baseUrl);
  return Boolean(cfg.apiKey && cfg.baseUrl && cfg.model);
}

/** Redacted LLM config for F12 / debug.log. Never includes the raw key. */
export function publicLlmConfig() {
  const cfg = llmConfig();
  return {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasKey: Boolean(cfg.apiKey),
    keyHint: cfg.apiKey ? `••••${String(cfg.apiKey).slice(-4)}` : "",
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    topP: cfg.topP,
    extraInstructions: cfg.extraInstructions ? `${cfg.extraInstructions.length} chars` : ""
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
