import { MOODS, MODULE_ID } from "../constants.js";
import { logInfo, logWarn } from "../debug/log.js";
import { t } from "../i18n.js";
import { listCatalog } from "../rag/catalog.js";
import { parseTableDraft, serializeTableDraft, tableRowsFromCatalog, applyImportedTracks, exportCatalogJson } from "../rag/manual-catalog.js";
import { pauseAllMusic, playIncludedSounds, playSoundById } from "../tools/playlists.js";

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
      applyJson: AgenticDjManualCatalog.onApplyJson,
      exportJson: AgenticDjManualCatalog.onExportJson,
      playIncluded: AgenticDjManualCatalog.onPlayIncluded,
      pausePlayback: AgenticDjManualCatalog.onPausePlayback,
      shuffleIncluded: AgenticDjManualCatalog.onShuffleIncluded,
      playRow: AgenticDjManualCatalog.onPlayRow,
      applyTags: AgenticDjManualCatalog.onSave,
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
    this.jsonPaste = "";
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
      jsonPaste: this.jsonPaste ?? "",
      progress: this.progress || this.orchestrator.analysisProgress || "",
      busy: this.busy,
      l: {
        hint: t("AGENTICDJ.Manual.Hint", "Load a catalog JSON, check moods, then Save tags."),
        jsonFile: t("AGENTICDJ.Manual.JsonFile", "JSON file"),
        jsonPaste: t("AGENTICDJ.Manual.JsonPaste", "Paste JSON"),
        jsonPastePlaceholder: t("AGENTICDJ.Manual.JsonPastePlaceholder", "{ \"module\": \"agentic-dj\", \"tracks\": [] }"),
        applyJson: t("AGENTICDJ.Manual.ApplyJson", "Apply JSON"),
        exportJson: t("AGENTICDJ.Manual.ExportJson", "Download JSON"),
        situation: t("AGENTICDJ.Manual.Situation", "Note for Save and suggest"),
        situationPlaceholder: t("AGENTICDJ.Manual.SituationPlaceholder", "optional"),
        situationHint: t("AGENTICDJ.Manual.SituationHint", "Leave blank unless you want Save and suggest to cue from this text."),
        fillEmpty: t("AGENTICDJ.Manual.FillEmpty", "Blank rows"),
        fillAnalyzed: t("AGENTICDJ.Manual.FillAnalyzed", "Reload catalog"),
        save: t("AGENTICDJ.Manual.Save", "Save tags"),
        saveLlm: t("AGENTICDJ.Manual.SaveLlm", "Fill blanks with LLM"),
        saveSuggest: t("AGENTICDJ.Manual.ApplySuggest", "Save and suggest"),
        play: t("AGENTICDJ.Manual.Play", "Play"),
        pause: t("AGENTICDJ.Manual.Pause", "Pause"),
        shuffle: t("AGENTICDJ.Manual.Shuffle", "Shuffle")
      }
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._clickAbort?.abort();
    this._clickAbort = new AbortController();
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
    this.jsonPaste = this.element.querySelector('[name="jsonPaste"]')?.value ?? this.jsonPaste ?? "";
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

  includedSoundIds() {
    return this.readRowsFromDom().filter(row => row.included !== false).map(row => row.soundId).filter(Boolean);
  }

  static async onPlayIncluded() {
    try {
      const ids = this.includedSoundIds();
      if (!ids.length) {
        ui.notifications.warn(t("AGENTICDJ.Manual.NoIncluded", "Check at least one track to play."));
        return;
      }
      const result = await playIncludedSounds(ids, { shuffle: false });
      logInfo("manual.play", result);
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  static async onPausePlayback() {
    try {
      await pauseAllMusic();
      logInfo("manual.pause");
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  static async onShuffleIncluded() {
    try {
      const ids = this.includedSoundIds();
      if (!ids.length) {
        ui.notifications.warn(t("AGENTICDJ.Manual.NoIncluded", "Check at least one track to play."));
        return;
      }
      const result = await playIncludedSounds(ids, { shuffle: true });
      logInfo("manual.shuffle", result);
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  static async onPlayRow(_event, target) {
    const id = target?.dataset?.soundId || target?.closest?.("[data-sound-id]")?.dataset?.soundId;
    if (!id) return;
    try {
      await playSoundById(id);
      logInfo("manual.playRow", { soundId: id });
    } catch (err) {
      ui.notifications.error(err.message);
    }
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

  static onApplyJson() {
    this.readRowsFromDom();
    const text = String(this.jsonPaste || "").trim();
    if (!text) {
      ui.notifications.warn(t("AGENTICDJ.Manual.JsonPaste", "Paste JSON above, or pick a JSON file."));
      return;
    }
    AgenticDjManualCatalog.applyImport.call(this, text, "paste");
  }

  static async importFromFile(file) {
    try {
      const text = await file.text();
      AgenticDjManualCatalog.applyImport.call(this, text, file.name);
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  static applyImport(text, source = "json") {
    try {
      const catalog = listCatalog();
      const { rows, matched, unmatched, scanned } = applyImportedTracks(catalog, text);
      this.rows = rows;
      this.jsonPaste = "";
      this.persistDraft(rows);
      logInfo("manual.import", { source, scanned, matched, unmatched: unmatched.length });
      if (!matched) {
        ui.notifications.error(game.i18n.format("AGENTICDJ.Manual.NoneMatched", {
          scanned,
          sample: unmatched[0] || catalog[0]?.name || ""
        }));
        this.render({ force: true });
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
