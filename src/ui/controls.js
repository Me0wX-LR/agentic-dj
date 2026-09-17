import { MODULE_ID } from "../constants.js";
import { AgenticDjApp } from "./dj-app.js";

export function attachControls(orchestrator) {
  Hooks.on("renderPlaylistDirectory", (app, html) => {
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root || !game.user.isGM) return;
    if (root.querySelector(".agentic-dj-open")) return;
    const header = root.querySelector(".directory-header .header-actions, .directory-header, header");
    if (!header) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "agentic-dj-open";
    button.innerHTML = `<i class="fa-solid fa-headphones"></i> ${game.i18n.localize("AGENTICDJ.Title")}`;
    button.addEventListener("click", () => AgenticDjApp.open(orchestrator));
    header.prepend(button);
  });

  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user.isGM) return;
    const tool = {
      name: MODULE_ID,
      title: game.i18n.localize("AGENTICDJ.ControlTitle"),
      icon: "fa-solid fa-headphones",
      button: true,
      onChange: () => AgenticDjApp.open(orchestrator),
      onClick: () => AgenticDjApp.open(orchestrator)
    };
    if (Array.isArray(controls)) {
      const token = controls.find(c => c.name === "token") ?? controls[0];
      token?.tools?.push?.(tool);
      return;
    }
    const group = controls.tokens ?? controls.token;
    if (!group) return;
    if (Array.isArray(group.tools)) {
      if (!group.tools.some(entry => entry.name === MODULE_ID)) group.tools.push(tool);
    } else if (group.tools && typeof group.tools === "object") {
      group.tools[MODULE_ID] = tool;
    }
  });
}
