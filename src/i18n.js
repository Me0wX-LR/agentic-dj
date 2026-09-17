import { MODULE_ID } from "./constants.js";

/** English strings Foundry may not have loaded yet (stale lang cache / mixed module files). */
const FALLBACK = {
  AGENTICDJ: {
    Suggesting: "Suggesting…",
    AnalyzeBusy: "Library analysis is already running. Wait for it to finish.",
    GmPrompt: "What is happening",
    GmPromptPlaceholder: "Type the scene in any language, then Cue from this",
    GmPromptHint: "Suggest now also reads this note. Ctrl+Enter cues immediately.",
    GmPromptSubmit: "Cue from this",
    GmPromptEmpty: "Type what is happening first.",
    TranscriptEmpty: "No live transcript.",
    TranscriptLapsed: "Speech lapsed",
    TranscriptAge: "Heard {seconds}s ago",
    CatalogHomogeneous: "Catalog is almost all one mood:",
    CatalogHomogeneousHint: "Load JSON in Manual list and Save tags — do not Analyze library after that.",
    Manual: {
      Hint: "Load a catalog JSON (file or paste), check the mood column, then Save tags. Do not Analyze library after a JSON import.",
      ImportJson: "Load JSON file",
      PasteJson: "Apply pasted JSON",
      ExportJson: "Download JSON",
      ApplyJson: "Apply JSON",
      JsonFile: "JSON file",
      JsonPaste: "Paste JSON",
      JsonPastePlaceholder: "{ \"module\": \"agentic-dj\", \"format\": 1, \"tracks\": [] }",
      FillEmpty: "Blank rows",
      FillAnalyzed: "Reload catalog",
      Save: "Save tags",
      SaveLlm: "Fill blanks with LLM",
      ApplySuggest: "Save and suggest",
      Imported: "Imported tags for {count} playlist sounds.",
      Exported: "Downloaded JSON for {count} tracks.",
      NoneMatched: "None of {scanned} JSON tracks matched a playlist sound. Example: {sample}",
      Unmatched: "{count} names did not match a playlist sound.",
      Situation: "Note for Save and suggest",
      SituationPlaceholder: "optional — or use the GM note on the main panel",
      SituationHint: "Leave blank unless you want Save and suggest to cue from this text."
    }
  }
};

export function t(key, fallback = "") {
  const value = game.i18n?.localize?.(key);
  if (!value || value === key) return fallback || key;
  return value;
}

export function hydrateTranslations() {
  try {
    foundry.utils.mergeObject(game.i18n.translations, FALLBACK, {
      inplace: true,
      insertKeys: true,
      insertValues: true,
      overwrite: false
    });
  } catch (err) {
    console.warn("agentic-dj i18n merge failed", err);
  }
}

export async function reloadEnglishFile() {
  try {
    const data = await foundry.utils.fetchJsonWithTimeout(`modules/${MODULE_ID}/lang/en.json`);
    if (data && typeof data === "object") {
      foundry.utils.mergeObject(game.i18n.translations, data, {
        inplace: true,
        insertKeys: true,
        insertValues: true,
        overwrite: true
      });
    }
  } catch {
    // Forge or cached zip without a reachable lang file; FALLBACK still applies.
  }
  hydrateTranslations();
}
