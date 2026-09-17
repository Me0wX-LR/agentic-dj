import { MOODS, MODULE_ID } from "../constants.js";
import { listCatalog } from "../rag/catalog.js";
import { parseTableDraft, serializeTableDraft, tableRowsFromCatalog } from "../rag/manual-catalog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AgenticDjManualCatalog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agentic-dj-manual-catalog",
    classes: ["agentic-dj", "agentic-dj-config"],
    tag: "div",
    window: {
      title: "AGENTICDJ.Manual.Title",
      icon: "fa-solid fa-table",
      resizable: true,
      contentClasses: ["standard-form", "agentic-dj-config-content"]
    },
    position: { width: 980, height: 760 },
    actions: {
      fillEmpty: AgenticDjManualCatalog.onFillEmpty,
      fillAnalyzed: AgenticDjManualCatalog.onFillAnalyzed,
      save: AgenticDjManualCatalog.onSave,
      saveLlm: AgenticDjManualCatalog.onSaveLlm,
      saveSuggest: AgenticDjManualCatalog.onSaveSuggest
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
    this.rows = null;
  }

  static open(orchestrator) {
    if (!this._instance) this._instance = new AgenticDjManualCatalog(orchestrator);
    this._instance.orchestrator = orchestrator;
    this._instance.rows = null;
    this._instance.render({ force: true });
    return this._instance;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const catalog = listCatalog();
    if (!this.rows) this.rows = loadRows(catalog);
    return {
      ...context,
      rows: decorateRows(this.rows),
      situationNote: this.situationNote ?? "",
      progress: this.progress || this.orchestrator.analysisProgress || ""
    };
  }

  readRowsFromDom() {
    const rows = [...this.element.querySelectorAll("tr[data-sound-id]")].map(tr => ({
      included: Boolean(tr.querySelector('[name="include"]')?.checked),
      soundId: tr.dataset.soundId,
      name: tr.dataset.name,
      playlistName: tr.querySelector(".agentic-dj-meta")?.textContent?.trim() || "",
      mood: tr.querySelector('[name="mood"]')?.value ?? "",
      intensity: tr.querySelector('[name="intensity"]')?.value ?? "",
      tags: tr.querySelector('[name="tags"]')?.value ?? "",
      useWhen: tr.querySelector('[name="useWhen"]')?.value ?? ""
    }));
    this.rows = rows;
    this.situationNote = this.element.querySelector('[name="situationNote"]')?.value?.trim?.() ?? "";
    return rows;
  }

  async close(options) {
    try {
      if (this.element?.querySelector?.("tr[data-sound-id]")) {
        const rows = this.readRowsFromDom();
        await game.settings.set(MODULE_ID, "manualCatalogDraft", serializeTableDraft(rows));
      }
    } catch {
      // ignore draft save on close
    }
    return super.close(options);
  }

  static async onFillEmpty() {
    this.rows = tableRowsFromCatalog(listCatalog(), { fill: false });
    await game.settings.set(MODULE_ID, "manualCatalogDraft", serializeTableDraft(this.rows));
    ui.notifications.info(game.i18n.format("AGENTICDJ.Manual.Filled", { count: this.rows.length }));
    this.render({ force: true });
  }

  static async onFillAnalyzed() {
    this.rows = tableRowsFromCatalog(listCatalog(), { fill: true });
    await game.settings.set(MODULE_ID, "manualCatalogDraft", serializeTableDraft(this.rows));
    ui.notifications.info(game.i18n.format("AGENTICDJ.Manual.FilledAnalyzed", { count: this.rows.length }));
    this.render({ force: true });
  }

  static async onSave() {
    await AgenticDjManualCatalog.#run.call(this, { llmFill: false, suggestAfter: false });
  }

  static async onSaveLlm() {
    await AgenticDjManualCatalog.#run.call(this, { llmFill: true, suggestAfter: false });
  }

  static async onSaveSuggest() {
    await AgenticDjManualCatalog.#run.call(this, { llmFill: true, suggestAfter: true });
  }

  static async #run({ llmFill, suggestAfter }) {
    const rows = this.readRowsFromDom();
    const live = this.element.querySelector(".agentic-dj-progress");
    const setProgress = message => {
      this.progress = message;
      if (live) live.textContent = message;
    };
    setProgress(game.i18n.localize("AGENTICDJ.Analyzing"));
    try {
      await this.orchestrator.saveCatalogRows(rows, {
        llmFill,
        suggestAfter,
        situationNote: this.situationNote,
        onProgress: setProgress
      });
      this.close();
    } catch (err) {
      setProgress(err.message);
      ui.notifications.error(err.message);
    }
  }
}

function loadRows(catalog) {
  const saved = game.settings.get(MODULE_ID, "manualCatalogDraft") || "";
  const parsed = parseTableDraft(saved);
  if (!parsed.length) return tableRowsFromCatalog(catalog, { fill: true });
  const byId = new Map(parsed.filter(row => row.soundId).map(row => [row.soundId, row]));
  const byName = new Map(parsed.filter(row => row.name).map(row => [String(row.name).toLowerCase(), row]));
  return catalog.map(track => {
    const hit = byId.get(track.soundId) || byName.get(String(track.name).toLowerCase());
    if (!hit) return tableRowsFromCatalog([track], { fill: true })[0];
    return {
      included: hit.included !== false,
      soundId: track.soundId,
      name: track.name,
      playlistName: track.playlistName || "",
      mood: hit.mood || "",
      intensity: hit.intensity || "",
      tags: Array.isArray(hit.tags) ? hit.tags.join(", ") : (hit.tags || ""),
      useWhen: hit.useWhen || "",
      analyzed: Boolean(track.mood || track.features)
    };
  });
}

function decorateRows(rows) {
  return rows.map(row => ({
    ...row,
    intensityValue: row.intensity || "",
    moodOptions: [
      { id: "", label: "—", selected: !row.mood },
      ...MOODS.map(mood => ({
        id: mood,
        label: mood,
        selected: row.mood === mood
      }))
    ]
  }));
}
