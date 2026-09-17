/** Mic lines expire so Listen cannot pin the Director on a stale utterance. */
export const MIC_TTL_MS = 45_000;
export const CHAT_TTL_MS = 180_000;
export const MANUAL_TTL_MS = 120_000;
export const MIC_STOP_GRACE_MS = 8_000;

export function ttlForSource(source) {
  if (source === "mic") return MIC_TTL_MS;
  if (source === "manual") return MANUAL_TTL_MS;
  return CHAT_TTL_MS;
}

export function pruneTranscript(entries = [], now = Date.now()) {
  return entries.filter(row => now - Number(row.at || 0) < ttlForSource(row.source));
}

export function similarUtterance(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.startsWith(right) || right.startsWith(left);
}

export function mergeUtterance(entries = [], text, source, at = Date.now()) {
  const clean = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return pruneTranscript(entries, at);
  const next = pruneTranscript(entries, at);
  const last = next.at(-1);
  if (last && last.source === source && similarUtterance(last.text, clean)) {
    next[next.length - 1] = {
      ...last,
      text: clean.length >= last.text.length ? clean : last.text,
      at
    };
    return next.slice(-40);
  }
  next.push({ text: clean, source, at });
  return next.slice(-40);
}

export function transcriptText(entries = [], limit = 6, now = Date.now()) {
  return pruneTranscript(entries, now).slice(-limit).map(row => row.text).join(" ");
}

export function dropSources(entries = [], sources = []) {
  const banned = new Set(sources);
  return entries.filter(row => !banned.has(row.source));
}

export function newestEntry(entries = []) {
  return entries.reduce((best, row) => (!best || row.at > best.at ? row : best), null);
}
