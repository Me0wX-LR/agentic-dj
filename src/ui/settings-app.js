import { LLM_PRESETS, MODULE_ID, STT_PRESETS } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AgenticDjSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agentic-dj-settings",
    tag: "form",
    classes: ["agentic-dj", "standard-form"],
    window: {
      title: "AGENTICDJ.SettingsMenu",
      icon: "fa-solid fa-key",
      contentClasses: ["standard-form"]
    },
    position: { width: 560 },
    form: {
      handler: AgenticDjSettings.#onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/settings.hbs` }
  };

  async _prepareContext() {
    const llmProvider = game.settings.get(MODULE_ID, "llmProvider");
    const sttProvider = game.settings.get(MODULE_ID, "sttProvider");
    return {
      llmProvider,
      llmProviders: Object.entries(LLM_PRESETS).map(([id, preset]) => ({ id, label: preset.label, selected: id === llmProvider })),
      sttProviders: Object.entries(STT_PRESETS).map(([id, preset]) => ({ id, label: preset.label, selected: id === sttProvider })),
      llmBaseUrl: game.settings.get(MODULE_ID, "llmBaseUrl"),
      llmModel: game.settings.get(MODULE_ID, "llmModel"),
      llmApiKey: game.settings.get(MODULE_ID, "llmApiKey"),
      sttProvider,
      sttBaseUrl: game.settings.get(MODULE_ID, "sttBaseUrl"),
      sttModel: game.settings.get(MODULE_ID, "sttModel"),
      sttApiKey: game.settings.get(MODULE_ID, "sttApiKey"),
      extraInstructions: game.settings.get(MODULE_ID, "extraInstructions"),
      autoAnalyze: game.settings.get(MODULE_ID, "autoAnalyze"),
      cooldown: game.settings.get(MODULE_ID, "cooldown"),
      maxProposals: game.settings.get(MODULE_ID, "maxProposals"),
      presets: LLM_PRESETS
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector('[name="llmProvider"]')?.addEventListener("change", event => {
      const preset = LLM_PRESETS[event.currentTarget.value];
      if (!preset) return;
      const url = this.element.querySelector('[name="llmBaseUrl"]');
      const model = this.element.querySelector('[name="llmModel"]');
      if (preset.baseUrl && url) url.value = preset.baseUrl;
      if (preset.model && model) model.value = preset.model;
    });
    this.element.querySelector('[name="sttProvider"]')?.addEventListener("change", event => {
      const preset = STT_PRESETS[event.currentTarget.value];
      if (!preset) return;
      const url = this.element.querySelector('[name="sttBaseUrl"]');
      const model = this.element.querySelector('[name="sttModel"]');
      if (preset.baseUrl && url) url.value = preset.baseUrl;
      if (preset.model && model) model.value = preset.model;
    });
  }

  static async #onSubmit(_event, form, formData) {
    const data = formData.object;
    const keys = [
      "llmProvider", "llmBaseUrl", "llmModel", "llmApiKey",
      "sttProvider", "sttBaseUrl", "sttModel", "sttApiKey",
      "extraInstructions", "autoAnalyze", "cooldown", "maxProposals"
    ];
    for (const key of keys) {
      let value = data[key];
      if (key === "autoAnalyze") value = value === true || value === "true" || value === "on";
      if (key === "cooldown" || key === "maxProposals") value = Number(value);
      await game.settings.set(MODULE_ID, key, value ?? (key === "autoAnalyze" ? false : ""));
    }
  }
}
