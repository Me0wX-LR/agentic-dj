import { MODULE_ID } from "../constants.js";
import { listCatalog } from "../rag/catalog.js";
import { buildCatalogTemplate } from "../rag/manual-catalog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AgenticDjManualCatalog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agentic-dj-manual-catalog",
    classes: ["agentic-dj", "agentic-dj-config"],
    tag: "div",
    window: {
      title: "AGENTICDJ.Manual.Title",
      icon: "fa-solid fa-list",
      resizable: true,
      contentClasses: ["standard-form", "agentic-dj-config-content"]
    },
    position: { width: 720, height: 720 },
    actions: {
      fill: AgenticDjManualCatalog.onFill,
      apply: AgenticDjManualCatalog.onApply,
      applySuggest: AgenticDjManualCatalog.onApplySuggest
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/manual-catalog.hbs`,
      scrollable: [".agentic-dj-settings"]
    }
  };

  constructor(orchestrator, options = {}) {
    super(options);
    this.orchestrator = orchestrator;
    this.progress = "";
    this.situationNote = "";
  }

  static open(orchestrator) {
    if (!this._instance) this._instance = new AgenticDjManualCatalog(orchestrator);
    this._instance.orchestrator = orchestrator;
    this._instance.render({ force: true });
    return this._instance;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const saved = game.settings.get(MODULE_ID, "manualCatalogDraft") || "";
    return {
      ...context,
      catalogText: saved || buildCatalogTemplate(listCatalog()),
      situationNote: this.situationNote ?? "",
      progress: this.progress || this.orchestrator.analysisProgress || ""
    };
  }

  static async onFill() {
    const text = buildCatalogTemplate(listCatalog());
    const box = this.element.querySelector('[name="catalogText"]');
    if (box) box.value = text;
    await game.settings.set(MODULE_ID, "manualCatalogDraft", text);
    ui.notifications.info(game.i18n.format("AGENTICDJ.Manual.Filled", { count: listCatalog().length }));
  }

  static async onApply() {
    await AgenticDjManualCatalog.#run.call(this, { suggestAfter: false });
  }

  static async onApplySuggest() {
    await AgenticDjManualCatalog.#run.call(this, { suggestAfter: true });
  }

  static async #run({ suggestAfter }) {
    const text = this.element.querySelector('[name="catalogText"]')?.value ?? "";
    const situationNote = this.element.querySelector('[name="situationNote"]')?.value?.trim?.() ?? "";
    this.situationNote = situationNote;
    const live = this.element.querySelector(".agentic-dj-progress");
    const setProgress = message => {
      this.progress = message;
      if (live) live.textContent = message;
    };
    setProgress(game.i18n.localize("AGENTICDJ.Analyzing"));
    try {
      await this.orchestrator.analyzeFromList(text, {
        suggestAfter,
        situationNote,
        onProgress: setProgress
      });
      this.close();
    } catch (err) {
      setProgress(err.message);
      ui.notifications.error(err.message);
    }
  }
}
