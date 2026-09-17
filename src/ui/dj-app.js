import { MODULE_ID } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AgenticDjApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agentic-dj-app",
    classes: ["agentic-dj", "standard-form"],
    window: {
      title: "AGENTICDJ.Title",
      icon: "fa-solid fa-headphones",
      resizable: true
    },
    position: { width: 560, height: 760 },
    actions: {
      listen: AgenticDjApp.#onListen,
      suggest: AgenticDjApp.#onSuggest,
      analyze: AgenticDjApp.#onAnalyze,
      stop: AgenticDjApp.#onStop,
      play: AgenticDjApp.#onPlay,
      skip: AgenticDjApp.#onSkip,
      ban: AgenticDjApp.#onBan,
      preview: AgenticDjApp.#onPreview
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

  async _prepareContext() {
    const snap = this.orchestrator.snapshot();
    return {
      ...snap,
      statusLabel: snap.status,
      hasCues: snap.proposal.cues.length > 0,
      transcript: snap.situation.transcript || "No transcript yet.",
      playing: (snap.situation.playing ?? []).map(row => `${row.playlist}: ${row.tracks.join(", ")}`).join(" · ") || "Silent"
    };
  }

  static async #onListen(_event, _target) {
    await this.orchestrator.toggleListen();
  }

  static async #onSuggest() {
    await this.orchestrator.suggestNow();
  }

  static async #onAnalyze() {
    await this.orchestrator.analyzeLibrary(true);
  }

  static async #onStop() {
    await this.orchestrator.stopMusic();
  }

  static async #onPlay(_event, target) {
    const id = target.dataset.soundId;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("AGENTICDJ.Title") },
      content: `<p>${game.i18n.localize("AGENTICDJ.PlayConfirm")}</p>`
    });
    if (ok) await this.orchestrator.playCue(id);
  }

  static async #onSkip(_event, target) {
    await this.orchestrator.skipCue(target.dataset.soundId);
  }

  static async #onBan(_event, target) {
    await this.orchestrator.banCue(target.dataset.soundId);
  }

  static async #onPreview(_event, target) {
    await this.orchestrator.previewCue(target.dataset.soundId);
  }
}
