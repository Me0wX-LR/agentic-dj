import { MODULE_ID } from "../constants.js";
import { AgenticDjManualCatalog } from "./manual-catalog-app.js";
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
      promptFromGm: AgenticDjApp.onPromptFromGm,
      analyze: AgenticDjApp.onAnalyze,
      stop: AgenticDjApp.onStop,
      play: AgenticDjApp.onPlay,
      skip: AgenticDjApp.onSkip,
      ban: AgenticDjApp.onBan,
      preview: AgenticDjApp.onPreview,
      openSettings: AgenticDjApp.onOpenSettings,
      openManual: AgenticDjApp.onOpenManual,
      openMemory: AgenticDjApp.onOpenMemory,
      forgetMemory: AgenticDjApp.onForgetMemory,
      copyLogs: AgenticDjApp.onCopyLogs,
      openLogs: AgenticDjApp.onOpenLogs,
      clearTranscript: AgenticDjApp.onClearTranscript
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
    const ageMs = snap.situation.transcriptAgeMs;
    const transcriptAge = snap.situation.transcript
      ? (Number.isFinite(ageMs) ? game.i18n.format("AGENTICDJ.TranscriptAge", { seconds: Math.max(0, Math.round(ageMs / 1000)) }) : "")
      : game.i18n.localize("AGENTICDJ.TranscriptLapsed");
    return {
      ...context,
      ...snap,
      statusLabel: snap.status,
      planning: snap.status === "planning" || snap.status === "analyzing",
      analyzing: snap.status === "analyzing",
      gmPrompt: snap.gmPrompt || "",
      hasCues: snap.proposal.cues.length > 0,
      hasLlmKey: Boolean(llmKey),
      llmKeyHint: game.settings.get(MODULE_ID, "llmApiKeyHint") || "",
      transcript: snap.situation.transcript || game.i18n.localize("AGENTICDJ.TranscriptEmpty"),
      transcriptAge,
      playing: (snap.situation.playing ?? []).map(row => `${row.playlist}: ${row.tracks.join(", ")}`).join(" · ") || "Silent"
    };
  }

  static async onListen() {
    await this.orchestrator.toggleListen();
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const field = this.element.querySelector('[name="gmPrompt"]');
    if (!field || field.dataset.bound) return;
    field.dataset.bound = "1";
    field.addEventListener("input", event => {
      this.orchestrator.gmPrompt = event.target.value;
    });
    field.addEventListener("keydown", event => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        AgenticDjApp.onPromptFromGm.call(this, event);
      }
    });
  }

  static async onSuggest() {
    await this.orchestrator.suggestNow();
  }

  static async onPromptFromGm() {
    const text = this.element.querySelector('[name="gmPrompt"]')?.value ?? this.orchestrator.gmPrompt ?? "";
    this.orchestrator.gmPrompt = text;
    await this.orchestrator.promptFromGm(text);
  }

  static async onAnalyze() {
    if (this.orchestrator.status === "analyzing") return;
    await this.orchestrator.analyzeLibrary(true);
  }

  static async onStop() {
    await this.orchestrator.stopMusic();
  }

  static onOpenSettings() {
    new AgenticDjSettings().render({ force: true });
  }

  static onOpenManual() {
    AgenticDjManualCatalog.open(this.orchestrator);
  }

  static onClearTranscript() {
    this.orchestrator.clearTranscript();
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

  static async onCopyLogs() {
    try {
      await this.orchestrator.copyLogs();
      ui.notifications.info(game.i18n.localize("AGENTICDJ.LogsCopied"));
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  static async onOpenLogs() {
    await this.orchestrator.openLogs();
  }
}
