import { MODULE_ID } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AgenticDjTextViewer extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["agentic-dj", "agentic-dj-config"],
    tag: "div",
    window: {
      icon: "fa-solid fa-file-lines",
      resizable: true,
      contentClasses: ["standard-form", "agentic-dj-config-content"]
    },
    position: { width: 760, height: 640 },
    actions: {
      copy: AgenticDjTextViewer.onCopy,
      download: AgenticDjTextViewer.onDownload
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/text-viewer.hbs`,
      scrollable: [".agentic-dj-viewer-body"]
    }
  };

  constructor({ title, filename, text, path, hint } = {}, options = {}) {
    super(options);
    this.viewerTitle = title || filename || "Agentic DJ";
    this.filename = filename || "file.txt";
    this.text = String(text || "");
    this.path = path || "";
    this.hint = hint || "";
  }

  get title() {
    return this.viewerTitle;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      text: this.text,
      path: this.path,
      hint: this.hint
    };
  }

  static async onCopy() {
    const text = this.text || "";
    if (game?.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
    else if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else throw new Error("Clipboard is not available");
    ui.notifications.info(game.i18n.localize("AGENTICDJ.Viewer.Copied"));
  }

  static onDownload() {
    const blob = new Blob([this.text || ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = this.filename || "agentic-dj.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function openTextViewer(options) {
  const app = new AgenticDjTextViewer(options);
  app.render({ force: true });
  return app;
}
