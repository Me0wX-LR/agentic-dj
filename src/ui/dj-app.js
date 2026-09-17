import { MODULE_ID } from "../constants.js";
import { AgenticDjSettings } from "./settings-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AgenticDjApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agentic-dj-app",
    classes: ["agentic-dj"],
    window: {
      title: "AGENTICDJ.Title",
      icon: "fa-solid fa-headphones",
      resizable: true
    },
    position: { width: 560, height: 760 },
    actions: {
      listen: AgenticDjApp.onListen,
      suggest: AgenticDjApp.onSuggest,
      analyze: AgenticDjApp.onAnalyze,
      stop: AgenticDjApp.onStop,
      play: AgenticDjApp.onPlay,
      skip: AgenticDjApp.onSkip,
      ban: AgenticDjApp.onBan,
      preview: AgenticDjApp.onPreview,
      openSettings: AgenticDjApp.onOpenSettings,
      openMemory: AgenticDjApp.onOpenMemory,
      forgetMemory: AgenticDjApp.onForgetMemory
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/dj-app.hbs`, scrollable: [".agentic-dj-body"] }
  };

  constructor(orchestrator, options = {}) {
    super(options);
    this.orchestrator = orchestrator;
  }

  static open(orchestrator) {
    if (!this._instance) this._instance = new AgenticDjApp(orchestrator);
    this._instance.orchestrator = orchestrator;
    orchestrator.bind(this._instance);
    this._instance.render({ force: true });
    return this._instance;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const snap = this.orchestrator.snapshot();
    const llmKey = game.settings.get(MODULE_ID, "llmApiKey") || "";
    return {
      ...context,
      ...snap,
      statusLabel: snap.status,
      hasCues: snap.proposal.cues.length > 0,
      hasLlmKey: Boolean(llmKey),
      llmKeyHint: game.settings.get(MODULE_ID, "llmApiKeyHint") || "",
      transcript: snap.situation.transcript || "No transcript yet.",
      playing: (snap.situation.playing ?? []).map(row => `${row.playlist}: ${row.tracks.join(", ")}`).join(" · ") || "Silent"
    };
  }

  static async onListen() {
    await this.orchestrator.toggleListen();
  }

  static async onSuggest() {
    await this.orchestrator.suggestNow();
  }

  static async onAnalyze() {
    await this.orchestrator.analyzeLibrary(true);
  }

  static async onStop() {
    await this.orchestrator.stopMusic();
  }

  static onOpenSettings() {
    new AgenticDjSettings().render({ force: true });
  }

  static async onPlay(_event, target) {
    const id = target.dataset.soundId;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("AGENTICDJ.Title") },
      content: `<p>${game.i18n.localize("AGENTICDJ.PlayConfirm")}</p>`
    });
    if (ok) await this.orchestrator.playCue(id);
  }

  static async onSkip(_event, target) {
    await this.orchestrator.skipCue(target.dataset.soundId);
  }

  static async onBan(_event, target) {
    await this.orchestrator.banCue(target.dataset.soundId);
  }

  static async onPreview(_event, target) {
    await this.orchestrator.previewCue(target.dataset.soundId);
  }

  static async onOpenMemory() {
    await this.orchestrator.openMemory();
  }

  static async onForgetMemory() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("AGENTICDJ.Title") },
      content: `<p>${game.i18n.localize("AGENTICDJ.MemoryClearConfirm")}</p>`
    });
    if (ok) await this.orchestrator.forgetMemory();
  }
}
