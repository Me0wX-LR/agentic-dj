import { playingSummary } from "./playlists.js";

export function foundryContext() {
  const combat = game.combat;
  const scene = game.scenes?.active;
  const chat = [...(game.messages?.contents ?? [])].slice(-8).map(msg => ({
    speaker: msg.speaker?.alias || msg.user?.name || "Unknown",
    content: htmlToText(msg.content ?? "")
  }));
  return {
    sceneName: scene?.name ?? "",
    sceneId: scene?.id ?? null,
    inCombat: Boolean(combat?.started),
    round: combat?.round ?? null,
    turn: combat?.turns?.[combat.turn]?.name ?? null,
    recentChat: chat.map(row => `${row.speaker}: ${row.content}`).join("\n"),
    playing: playingSummary()
  };
}

export function htmlToText(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || "").replace(/\s+/g, " ").trim();
}
