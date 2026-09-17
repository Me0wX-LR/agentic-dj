import { LLM_PRESETS, MODULE_ID, STT_PRESETS } from "./constants.js";
import { AgenticDjSettings } from "./ui/settings-app.js";

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
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

  game.settings.register(MODULE_ID, "llmProvider", { ...client, type: String, default: "openrouter" });
  game.settings.register(MODULE_ID, "llmBaseUrl", { ...client, type: String, default: LLM_PRESETS.openrouter.baseUrl });
  game.settings.register(MODULE_ID, "llmModel", { ...client, type: String, default: LLM_PRESETS.openrouter.model });
  game.settings.register(MODULE_ID, "llmApiKey", { ...client, type: String, default: "" });
  game.settings.register(MODULE_ID, "llmApiKeyHint", { ...client, type: String, default: "" });
  game.settings.register(MODULE_ID, "sttProvider", { ...client, type: String, default: "webspeech" });
  game.settings.register(MODULE_ID, "sttBaseUrl", { ...client, type: String, default: "" });
  game.settings.register(MODULE_ID, "sttModel", { ...client, type: String, default: STT_PRESETS.whisper.model });
  game.settings.register(MODULE_ID, "sttApiKey", { ...client, type: String, default: "" });
  game.settings.register(MODULE_ID, "sttApiKeyHint", { ...client, type: String, default: "" });
  game.settings.register(MODULE_ID, "extraInstructions", { ...world, type: String, default: "" });
  game.settings.register(MODULE_ID, "autoAnalyze", { ...world, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "cooldown", { ...world, type: Number, default: 20 });
  game.settings.register(MODULE_ID, "maxProposals", { ...world, type: Number, default: 3 });
}

export function llmConfig() {
  const provider = setting("llmProvider");
  const preset = LLM_PRESETS[provider] ?? LLM_PRESETS.custom;
  return {
    provider,
    baseUrl: (setting("llmBaseUrl") || preset.baseUrl || "").replace(/\/$/, ""),
    model: setting("llmModel") || preset.model,
    apiKey: setting("llmApiKey") || "",
    extraInstructions: setting("extraInstructions") || ""
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
