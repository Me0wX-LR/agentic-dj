/**
 * Two-stage catalog RAG: BM25 retrieve, then feature rerank.
 * Foundry is not required.
 */

import { expandQuery, tokenizeSearch } from "./synonyms.js";

const K1 = 1.4;
const B = 0.75;

export function fieldText(track = {}) {
  return [
    track.name,
    track.mood,
    ...(track.tags ?? []),
    ...(track.setting ?? []),
    track.useWhen,
    track.avoidWhen,
    track.playlistName
  ].filter(Boolean).join(" ");
}

export function weightedTokens(track = {}) {
  const bags = [
    ...repeat(tokenizeSearch(track.useWhen), 3),
    ...repeat(tokenizeSearch((track.tags ?? []).join(" ")), 3),
    ...repeat(tokenizeSearch(track.mood), 2),
    ...tokenizeSearch(track.name),
    ...tokenizeSearch(track.playlistName),
    ...tokenizeSearch(track.avoidWhen)
  ];
  return bags;
}

export function bm25Retrieve(catalog = [], queryTokens = [], limit = 32) {
  const docs = catalog.map(track => ({ track, tokens: weightedTokens(track) }));
  const df = new Map();
  for (const doc of docs) {
    for (const token of new Set(doc.tokens)) df.set(token, (df.get(token) || 0) + 1);
  }
  const n = Math.max(docs.length, 1);
  const avgdl = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / n;
  const scored = docs.map(doc => {
    const tf = new Map();
    for (const token of doc.tokens) tf.set(token, (tf.get(token) || 0) + 1);
    const dl = doc.tokens.length || 1;
    let score = 0;
    for (const token of queryTokens) {
      const freq = tf.get(token) || 0;
      if (!freq) continue;
      const idf = Math.log(((n - (df.get(token) || 0) + 0.5) / ((df.get(token) || 0) + 0.5)) + 1);
      score += idf * ((freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (dl / (avgdl || 1)))));
    }
    return { track: doc.track, bm25: score };
  });
  scored.sort((a, b) => b.bm25 - a.bm25);
  return scored.slice(0, Math.max(limit, 1));
}

export function useWhenOverlap(track, queryTokens = []) {
  const tokens = new Set(tokenizeSearch(track.useWhen || ""));
  if (!tokens.size) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (tokens.has(token)) hits += 1;
  }
  return hits / Math.max(queryTokens.length, 1);
}

export function rerankHits(hits, { wantedMood, intensity, inCombat, memory = {}, limit = 8, queryTokens = [], featureScore } = {}) {
  const banned = new Set(memory.bannedIds ?? []);
  const skipped = new Set(memory.skippedIds ?? []);
  const proposed = memory.lastProposedIds ?? [];
  const maxBm25 = Math.max(...hits.map(row => row.bm25), 0.0001);
  const query = queryTokens.length ? queryTokens : expandQuery(wantedMood || "", wantedMood);
  const ranked = hits
    .filter(row => !banned.has(row.track.soundId) && !skipped.has(row.track.soundId))
    .map(row => {
      const features = featureScore?.(row.track) || { score: 0, reasons: [] };
      const useWhen = useWhenOverlap(row.track, query);
      let score = (row.bm25 / maxBm25) * 8 + Number(features.score || 0) + useWhen * 8;
      const reasons = [...(features.reasons ?? [])];
      if (row.bm25 > 0) reasons.push(`bm25 ${row.bm25.toFixed(2)}`);
      if (useWhen) reasons.push(`useWhen ${useWhen.toFixed(2)}`);
      if (proposed.includes(row.track.soundId)) {
        score -= 5;
        reasons.push("on the last suggestion card");
      }
      if (inCombat && row.track.mood === "combat") score += 1;
      if (intensity && row.track.intensity) {
        score += 2 - Math.abs(Number(row.track.intensity) - Number(intensity));
      }
      return { track: row.track, score, reasons, bm25: row.bm25 };
    })
    .filter(row => Number.isFinite(row.score))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.track.name || "").localeCompare(String(b.track.name || ""));
    });
  return ranked.slice(0, limit);
}

function repeat(list, times) {
  const out = [];
  for (let i = 0; i < times; i++) out.push(...list);
  return out;
}
