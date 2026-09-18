import { MODULE_ID } from "../constants.js";
import { logInfo, logWarn } from "../debug/log.js";
import { AgenticDjApp } from "./dj-app.js";

let orchestrator = null;
let hooksRegistered = false;

function openDj() {
  const current = orchestrator || game.modules.get(MODULE_ID)?.api?.orchestrator;
  if (!current) {
    logWarn("controls.open.missing");
    return;
  }
  AgenticDjApp.open(current);
}

function asElement(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  return null;
}

function playlistApp(app) {
  if (app && (app.id === "playlists" || app.tabName === "playlists" || app.constructor?.name === "PlaylistDirectory")) {
    return app;
  }
  return ui?.playlists || ui?.sidebar?.tabs?.playlists || game?.playlists?.directory || null;
}

function playlistRoot(app, html) {
  const dir = playlistApp(app);
  return (
    asElement(dir?.element) ||
    asElement(html) ||
    document.querySelector("#playlists, .tab.playlists, [data-tab='playlists']")
  );
}

function buttonLabel() {
  return game.i18n?.localize?.("AGENTICDJ.Title") || "Agentic DJ";
}

function fillButton(button) {
  button.type = "button";
  button.className = "agentic-dj-open";
  button.innerHTML = `<i class="fa-solid fa-headphones"></i> <span>${buttonLabel()}</span>`;
}

export function injectPlaylistButton(app, html) {
  if (game.user && !game.user.isGM) return false;
  const root = playlistRoot(app, html);
  if (!root) {
    logWarn("controls.playlist.missingRoot");
    return false;
  }
  let wrap = root.querySelector(".agentic-dj-open-wrap");
  if (wrap) {
    const button = wrap.querySelector(".agentic-dj-open");
    if (button) fillButton(button);
    return true;
  }
  wrap = document.createElement("div");
  wrap.className = "agentic-dj-open-wrap";
  const button = document.createElement("button");
  fillButton(button);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openDj();
  });
  wrap.append(button);
  const header = root.querySelector("[data-application-part='header'], .directory-header");
  const directory = root.querySelector("[data-application-part='directory'], .directory-list, ol.directory-list");
  if (header) header.after(wrap);
  else if (directory) directory.before(wrap);
  else root.prepend(wrap);
  logInfo("controls.playlist.injected", { afterHeader: Boolean(header), beforeDirectory: !header && Boolean(directory) });
  return true;
}

function isPlaylistDirectory(app) {
  const id = app?.id || app?.tabName || app?.options?.id;
  return id === "playlists" || app?.constructor?.name === "PlaylistDirectory";
}

export function registerControlHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  Hooks.on("renderPlaylistDirectory", (app, html) => injectPlaylistButton(app, html));
  Hooks.on("renderApplicationV2", (app, html) => {
    if (isPlaylistDirectory(app)) injectPlaylistButton(app, html);
  });
  Hooks.on("renderSidebarTab", (app, html) => {
    if (isPlaylistDirectory(app)) injectPlaylistButton(app, html);
  });
  Hooks.on("changeSidebarTab", app => {
    if (isPlaylistDirectory(app)) injectPlaylistButton(app);
  });
  Hooks.on("getHeaderControlsPlaylistDirectory", (_app, controls) => {
    if (!game.user?.isGM || !Array.isArray(controls)) return;
    if (controls.some(row => row.action === "agenticDj")) return;
    controls.unshift({
      icon: "fa-solid fa-headphones",
      label: buttonLabel(),
      action: "agenticDj",
      onClick: () => openDj()
    });
  });
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user?.isGM) return;
    const tool = {
      name: MODULE_ID,
      title: game.i18n.localize("AGENTICDJ.ControlTitle"),
      icon: "fa-solid fa-headphones",
      button: true,
      onChange: () => openDj(),
      onClick: () => openDj()
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

export function bindControls(next) {
  orchestrator = next;
  injectPlaylistButton(ui.playlists);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => injectPlaylistButton(ui.playlists));
  }
  setTimeout(() => injectPlaylistButton(ui.playlists), 250);
}

/** @deprecated use registerControlHooks + bindControls */
export function attachControls(next) {
  registerControlHooks();
  bindControls(next);
}
