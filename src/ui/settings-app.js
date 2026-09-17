import { LLM_PRESETS, MODULE_ID, STT_PRESETS } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function keyHint(value) {
  const text = String(value || "");
  if (!text) return "";
  return text.length <= 4 ? "••••" : `•••• ${text.slice(-4)}`;
}

function readValue(root, name) {
  return root.querySelector(`[name="${name}"]`)?.value?.trim?.() ?? "";
}

export class AgenticDjSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agentic-dj-settings",
    classes: ["agentic-dj"],
    tag: "div",
    window: {
      title: "AGENTICDJ.SettingsMenu",
      icon: "fa-solid fa-key",
      contentClasses: ["standard-form"]
    },
    position: { width: 560 },
    actions: {
      save: AgenticDjSettings.onSave,
      clearKeys: AgenticDjSettings.onClearKeys
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/settings.hbs` }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const llmProvider = game.settings.get(MODULE_ID, "llmProvider");
    const sttProvider = game.settings.get(MODULE_ID, "sttProvider");
    const llmApiKey = game.settings.get(MODULE_ID, "llmApiKey") || "";
    const sttApiKey = game.settings.get(MODULE_ID, "sttApiKey") || "";
    return {
      ...context,
      llmProvider,
      llmProviders: Object.entries(LLM_PRESETS).map(([id, preset]) => ({
        id,
        label: preset.label,
        selected: id === llmProvider
      })),
      sttProviders: Object.entries(STT_PRESETS).map(([id, preset]) => ({
        id,
        label: preset.label,
        selected: id === sttProvider
      })),
      llmBaseUrl: game.settings.get(MODULE_ID, "llmBaseUrl"),
      llmModel: game.settings.get(MODULE_ID, "llmModel"),
      sttProvider,
      sttBaseUrl: game.settings.get(MODULE_ID, "sttBaseUrl"),
      sttModel: game.settings.get(MODULE_ID, "sttModel"),
      extraInstructions: game.settings.get(MODULE_ID, "extraInstructions"),
      autoAnalyze: game.settings.get(MODULE_ID, "autoAnalyze"),
      cooldown: game.settings.get(MODULE_ID, "cooldown"),
      maxProposals: game.settings.get(MODULE_ID, "maxProposals"),
      hasLlmKey: Boolean(llmApiKey),
      hasSttKey: Boolean(sttApiKey),
      llmKeyHint: game.settings.get(MODULE_ID, "llmApiKeyHint") || keyHint(llmApiKey),
      sttKeyHint: game.settings.get(MODULE_ID, "sttApiKeyHint") || keyHint(sttApiKey),
      llmKeyPlaceholder: llmApiKey
        ? game.i18n.localize("AGENTICDJ.Settings.KeyPlaceholderSaved")
        : game.i18n.localize("AGENTICDJ.Settings.KeyPlaceholderNew"),
      sttKeyPlaceholder: sttApiKey
        ? game.i18n.localize("AGENTICDJ.Settings.KeyPlaceholderSaved")
        : game.i18n.localize("AGENTICDJ.Settings.KeyPlaceholderNew")
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this._djSettingsBound) return;
    this._djSettingsBound = true;
    const root = this.element;
    root.addEventListener("submit", event => {
      event.preventDefault();
      event.stopPropagation();
    });
    root.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      if (event.target?.tagName === "TEXTAREA") return;
      event.preventDefault();
      event.stopPropagation();
      AgenticDjSettings.onSave.call(this, event);
    });
    root.addEventListener("change", event => {
      const name = event.target?.name;
      if (name === "llmProvider") {
        const preset = LLM_PRESETS[event.target.value];
        if (!preset) return;
        const url = root.querySelector('[name="llmBaseUrl"]');
        const model = root.querySelector('[name="llmModel"]');
        if (preset.baseUrl && url) url.value = preset.baseUrl;
        if (preset.model && model) model.value = preset.model;
      }
      if (name === "sttProvider") {
        const preset = STT_PRESETS[event.target.value];
        if (!preset) return;
        const url = root.querySelector('[name="sttBaseUrl"]');
        const model = root.querySelector('[name="sttModel"]');
        if (preset.baseUrl && url) url.value = preset.baseUrl;
        if (preset.model && model) model.value = preset.model;
      }
    });
  }

  static async onSave(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const root = this.element;
    const llmKey = readValue(root, "llmApiKey");
    const sttKey = readValue(root, "sttApiKey");
    const autoAnalyze = Boolean(root.querySelector('[name="autoAnalyze"]')?.checked);
    const cooldown = Number(readValue(root, "cooldown") || 20);
    const maxProposals = Number(readValue(root, "maxProposals") || 3);

    await game.settings.set(MODULE_ID, "llmProvider", readValue(root, "llmProvider") || "openrouter");
    await game.settings.set(MODULE_ID, "llmBaseUrl", readValue(root, "llmBaseUrl"));
    await game.settings.set(MODULE_ID, "llmModel", readValue(root, "llmModel"));
    await game.settings.set(MODULE_ID, "sttProvider", readValue(root, "sttProvider") || "webspeech");
    await game.settings.set(MODULE_ID, "sttBaseUrl", readValue(root, "sttBaseUrl"));
    await game.settings.set(MODULE_ID, "sttModel", readValue(root, "sttModel"));
    await game.settings.set(MODULE_ID, "extraInstructions", root.querySelector('[name="extraInstructions"]')?.value ?? "");
    await game.settings.set(MODULE_ID, "autoAnalyze", autoAnalyze);
    await game.settings.set(MODULE_ID, "cooldown", Number.isFinite(cooldown) ? cooldown : 20);
    await game.settings.set(MODULE_ID, "maxProposals", Number.isFinite(maxProposals) ? maxProposals : 3);

    if (llmKey) {
      await game.settings.set(MODULE_ID, "llmApiKey", llmKey);
      await game.settings.set(MODULE_ID, "llmApiKeyHint", keyHint(llmKey));
    }
    if (sttKey) {
      await game.settings.set(MODULE_ID, "sttApiKey", sttKey);
      await game.settings.set(MODULE_ID, "sttApiKeyHint", keyHint(sttKey));
    }

    const stored = game.settings.get(MODULE_ID, "llmApiKey");
    ui.notifications.info(stored
      ? game.i18n.localize("AGENTICDJ.Settings.SaveOk")
      : game.i18n.localize("AGENTICDJ.Settings.SaveOkNoKey"));
    this.close();
  }

  static async onClearKeys(event) {
    event?.preventDefault?.();
    await game.settings.set(MODULE_ID, "llmApiKey", "");
    await game.settings.set(MODULE_ID, "sttApiKey", "");
    await game.settings.set(MODULE_ID, "llmApiKeyHint", "");
    await game.settings.set(MODULE_ID, "sttApiKeyHint", "");
    ui.notifications.info(game.i18n.localize("AGENTICDJ.Settings.KeysCleared"));
    this.render();
  }
}
