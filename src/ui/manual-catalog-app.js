import { MOODS, MODULE_ID } from "../constants.js";
import { logInfo, logWarn } from "../debug/log.js";
import { listCatalog } from "../rag/catalog.js";
import { parseTableDraft, serializeTableDraft, tableRowsFromCatalog, applyImportedTracks, exportCatalogJson } from "../rag/manual-catalog.js";

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
    actions: {}
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
    this.busy = false;
    this._clickAbort = null;
  }

  static open(orchestrator) {
    if (!this._instance) this._instance = new AgenticDjManualCatalog(orchestrator);
    this._instance.orchestrator = orchestrator;
    this._instance.rows = null;
    this._instance.busy = false;
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
      progress: this.progress || this.orchestrator.analysisProgress || "",
      busy: this.busy
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._clickAbort?.abort();
    this._clickAbort = new AbortController();
    this.element.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (!button || !this.element.contains(button)) return;
      const action = button.dataset.action;
      const handler = {
        fillEmpty: AgenticDjManualCatalog.onFillEmpty,
        fillAnalyzed: AgenticDjManualCatalog.onFillAnalyzed,
        importJson: AgenticDjManualCatalog.onImportJson,
        pasteJson: AgenticDjManualCatalog.onPasteJson,
        exportJson: AgenticDjManualCatalog.onExportJson,
        applyTags: AgenticDjManualCatalog.onSave,
        saveLlm: AgenticDjManualCatalog.onSaveLlm,
        saveSuggest: AgenticDjManualCatalog.onSaveSuggest
      }[action];
      if (!handler) return;
      event.preventDefault();
      event.stopPropagation();
      logInfo("manual.action", { action });
      handler.call(this, event, button);
    }, { signal: this._clickAbort.signal });
    const file = this.element.querySelector('input[name="importJson"]');
    file?.addEventListener("change", event => {
      const picked = event.target.files?.[0];
      event.target.value = "";
      if (picked) AgenticDjManualCatalog.importFromFile.call(this, picked);
    }, { signal: this._clickAbort.signal });
  }

  readRowsFromDom() {
    if (!this.element) return this.rows || [];
    const previous = new Map((this.rows || []).map(row => [row.soundId, row]));
    const rows = [...this.element.querySelectorAll("tr[data-sound-id]")].map(tr => ({
      included: Boolean(tr.querySelector('[name="include"]')?.checked),
      soundId: tr.dataset.soundId,
      name: tr.dataset.name,
      playlistName: tr.querySelector(".agentic-dj-meta")?.textContent?.trim() || "",
      mood: tr.querySelector('[name="mood"]')?.value ?? "",
      intensity: tr.querySelector('[name="intensity"]')?.value ?? "",
      tags: tr.querySelector('[name="tags"]')?.value ?? "",
      useWhen: tr.querySelector('[name="useWhen"]')?.value ?? "",
      avoidWhen: previous.get(tr.dataset.soundId)?.avoidWhen || ""
    }));
    this.rows = rows;
    this.situationNote = this.element.querySelector('[name="situationNote"]')?.value?.trim?.() ?? "";
    return rows;
  }

  persistDraft(rows = this.rows) {
    if (!rows?.length) return;
    try {
      void game.settings.set(MODULE_ID, "manualCatalogDraft", serializeTableDraft(rows)).catch(err => {
        logWarn("manual.draft.failed", { error: err });
      });
    } catch (err) {
      logWarn("manual.draft.failed", { error: err });
    }
  }

  async close(options) {
    try {
      if (this.element?.querySelector?.("tr[data-sound-id]")) {
        this.persistDraft(this.readRowsFromDom());
      }
    } catch {
      // ignore draft save on close
    }
    this._clickAbort?.abort();
    this._clickAbort = null;
    return super.close(options);
  }

  static onFillEmpty() {
    this.rows = tableRowsFromCatalog(listCatalog(), { fill: false });
    this.persistDraft(this.rows);
    ui.notifications.info(game.i18n.format("AGENTICDJ.Manual.Filled", { count: this.rows.length }));
    this.render({ force: true });
  }

  static onFillAnalyzed() {
    this.rows = tableRowsFromCatalog(listCatalog(), { fill: true });
    this.persistDraft(this.rows);
    ui.notifications.info(game.i18n.format("AGENTICDJ.Manual.FilledAnalyzed", { count: this.rows.length }));
    this.render({ force: true });
  }

  static onImportJson() {
    this.element.querySelector('input[name="importJson"]')?.click();
  }

  static async importFromFile(file) {
    try {
      const text = await file.text();
      AgenticDjManualCatalog.applyImport.call(this, text, file.name);
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  static async onPasteJson() {
    try {
      const text = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("AGENTICDJ.Manual.PasteJson") },
        content: `<textarea name="json" rows="16" style="width:100%;font-family:ui-monospace,monospace"></textarea>`,
        ok: {
          label: game.i18n.localize("AGENTICDJ.Manual.ImportJson"),
          callback: (_event, button) => button.form.querySelector('[name="json"]')?.value ?? ""
        }
      });
      if (text) AgenticDjManualCatalog.applyImport.call(this, text, "paste");
    } catch {
      // dialog cancelled
    }
  }

  static applyImport(text, source = "json") {
    try {
      const catalog = listCatalog();
      const { rows, matched, unmatched, scanned } = applyImportedTracks(catalog, text);
      this.rows = rows;
      this.persistDraft(rows);
      logInfo("manual.import", { source, scanned, matched, unmatched: unmatched.length });
      if (!matched) {
        ui.notifications.error(game.i18n.format("AGENTICDJ.Manual.NoneMatched", {
          scanned,
          sample: unmatched[0] || catalog[0]?.name || ""
        }));
        return;
      }
      const extra = unmatched.length
        ? ` ${game.i18n.format("AGENTICDJ.Manual.Unmatched", { count: unmatched.length })}`
        : "";
      ui.notifications.info(`${game.i18n.format("AGENTICDJ.Manual.Imported", { count: matched })}${extra}`);
      this.render({ force: true });
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  static onExportJson() {
    const rows = this.readRowsFromDom();
    const payload = exportCatalogJson(rows);
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "agentic-dj-catalog.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logInfo("manual.export", { tracks: payload.tracks.length });
    ui.notifications.info(game.i18n.format("AGENTICDJ.Manual.Exported", { count: payload.tracks.length }));
  }

  static async onSave() {
    await AgenticDjManualCatalog.runSave.call(this, { llmFill: false, suggestAfter: false });
  }

  static async onSaveLlm() {
    await AgenticDjManualCatalog.runSave.call(this, { llmFill: true, suggestAfter: false });
  }

  static async onSaveSuggest() {
    await AgenticDjManualCatalog.runSave.call(this, { llmFill: true, suggestAfter: true });
  }

  static async runSave({ llmFill, suggestAfter }) {
    if (this.busy) return;
    this.busy = true;
    const rows = this.readRowsFromDom();
    this.persistDraft(rows);
    const live = this.element.querySelector(".agentic-dj-progress");
    const setProgress = message => {
      this.progress = message;
      if (live) live.textContent = message;
    };
    setProgress(game.i18n.localize("AGENTICDJ.Analyzing"));
    this.element.querySelectorAll("button[data-action]").forEach(btn => {
      btn.disabled = true;
    });
    try {
      await this.orchestrator.saveCatalogRows(rows, {
        llmFill,
        suggestAfter,
        situationNote: this.situationNote,
        onProgress: setProgress
      });
      this.busy = false;
      this.close();
    } catch (err) {
      this.busy = false;
      setProgress(err.message);
      this.element.querySelectorAll("button[data-action]").forEach(btn => {
        btn.disabled = false;
      });
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
