const MARK = "[Agentic DJ]";

export function searchBlob(card = {}) {
  return [
    card.name,
    card.mood,
    card.intensity ? `${card.intensity}/5` : "",
    ...(card.tags ?? []),
    ...(card.setting ?? []),
    card.useWhen,
    card.avoidWhen,
    card.playlistName
  ].filter(Boolean).join(" ").toLowerCase();
}

export function indexLine(card = {}) {
  const tags = (card.tags ?? []).join(", ");
  const mood = card.mood || "untagged";
  const intensity = card.intensity || "";
  const useWhen = card.useWhen || "";
  return `${MARK} ${mood}${intensity ? ` ${intensity}/5` : ""}${tags ? ` | ${tags}` : ""}${useWhen ? ` | ${useWhen}` : ""}`;
}

export function mergeSoundDescription(existing = "", card = {}) {
  const stripped = String(existing || "")
    .replace(new RegExp(`${escapeRegExp(MARK)}[^\\n]*\\n?`, "g"), "")
    .trim();
  const line = indexLine(card);
  return stripped ? `${stripped}\n${line}` : line;
}

export function documentMatchesSearch(haystack, query) {
  const terms = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return true;
  const hay = String(haystack || "").toLowerCase();
  return terms.every(term => hay.includes(term));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
