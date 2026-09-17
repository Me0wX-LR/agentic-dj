import test from "node:test";
import assert from "node:assert/strict";
import { inferWantedMood, retrieveTracks, scoreTrack, verifyCandidates } from "../src/rag/retrieve.js";

const tavern = {
  soundId: "a",
  name: "Warm Hearth",
  mood: "tavern",
  intensity: 2,
  tags: ["tavern", "folk", "social"],
  useWhen: "Inns and drinking",
  features: { energy: 0.08 }
};
const battle = {
  soundId: "b",
  name: "Steel Clash",
  mood: "combat",
  intensity: 5,
  tags: ["battle", "combat", "percussion"],
  useWhen: "Fights",
  features: { energy: 0.6 }
};
const drone = {
  soundId: "c",
  name: "Cave Breath",
  mood: "ambient",
  intensity: 1,
  tags: ["ambient", "dungeon"],
  useWhen: "Quiet underscoring",
  features: { energy: 0.03 }
};

test("combat transcript prefers battle music", () => {
  const situation = { inCombat: true, transcript: "roll initiative the guards attack", sceneName: "Tavern" };
  const ranked = retrieveTracks([tavern, battle, drone], situation, {}, { limit: 3 });
  assert.equal(ranked[0].track.soundId, "b");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("exploration prefers calm tracks over combat", () => {
  const situation = { inCombat: false, transcript: "you walk the forest road", sceneName: "Greenwood" };
  const ranked = retrieveTracks([tavern, battle, drone], situation, {}, { limit: 3 });
  assert.notEqual(ranked[0].track.soundId, "b");
});

test("banned tracks are dropped", () => {
  const situation = { inCombat: true, transcript: "combat" };
  const ranked = retrieveTracks([tavern, battle, drone], situation, { bannedIds: ["b"] }, { limit: 3 });
  assert.ok(!ranked.some(row => row.track.soundId === "b"));
});

test("skipped tracks are dropped from the next plan", () => {
  const situation = { inCombat: true, transcript: "combat" };
  const ranked = retrieveTracks([tavern, battle, drone], situation, { skippedIds: ["b"] }, { limit: 3 });
  assert.ok(!ranked.some(row => row.track.soundId === "b"));
});

test("verifyCandidates rejects unknown ids", () => {
  const result = verifyCandidates([battle], ["missing", "b"], { inCombat: true }, {}, "combat", 5);
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped[0].soundId, "missing");
});

test("inferWantedMood reads tavern and combat language", () => {
  assert.equal(inferWantedMood({ transcript: "the innkeeper pours ale" }), "tavern");
  assert.equal(inferWantedMood({ inCombat: true }), "combat");
});

test("recent plays are penalized", () => {
  const situation = { inCombat: true, transcript: "battle" };
  const fresh = scoreTrack(battle, situation, {});
  const repeated = scoreTrack(battle, situation, { recentIds: ["b"] });
  assert.ok(repeated.score < fresh.score);
});

test("learned likes boost a track in that mood", () => {
  const situation = { inCombat: true, transcript: "combat" };
  const memory = { likes: { combat: { c: { name: "Cave Breath", count: 6 } } } };
  const ranked = retrieveTracks([tavern, battle, drone], situation, memory, { limit: 3 });
  assert.ok(ranked.find(row => row.track.soundId === "c").score > scoreTrack(drone, situation, {}).score);
});

test("cantonese death language infers combat not exploration", async () => {
  const { inferWantedMood, retrieveTracks } = await import("../src/rag/retrieve.js");
  assert.equal(inferWantedMood({ transcript: "餵點呀hello hello 死咗好多人" }), "combat");
  const calm = {
    soundId: "c",
    name: "Rain",
    mood: "exploration",
    intensity: 3,
    tags: ["rain"],
    features: { energy: 0.12, tempo: 90 }
  };
  const hot = {
    soundId: "h",
    name: "Blood Stain",
    mood: "exploration",
    intensity: 3,
    tags: ["blood"],
    features: { energy: 0.62, tempo: 140 }
  };
  const ranked = retrieveTracks([calm, hot], { transcript: "死咗好多人" }, {}, { limit: 2, mood: "exploration" });
  assert.equal(ranked[0].track.soundId, "h");
});

test("last proposed cards are rotated out of a tied catalog", () => {
  const a = { soundId: "a", name: "Asphodelus", mood: "exploration", intensity: 3, tags: [], features: { energy: 0.12 } };
  const b = { soundId: "b", name: "Crossandra", mood: "exploration", intensity: 3, tags: [], features: { energy: 0.12 } };
  const c = { soundId: "c", name: "Reflections", mood: "exploration", intensity: 3, tags: [], features: { energy: 0.12 } };
  const ranked = retrieveTracks([a, b, c], { transcript: "hello" }, { lastProposedIds: ["a", "b"] }, { limit: 1 });
  assert.equal(ranked[0].track.soundId, "c");
});

test("mic transcript lapses after TTL", async () => {
  const { pruneTranscript, mergeUtterance, MIC_TTL_MS, similarUtterance } = await import("../src/memory/transcript.js");
  const now = 2_000_000;
  const kept = pruneTranscript([
    { text: "hello", source: "mic", at: now - 1000 },
    { text: "old", source: "mic", at: now - MIC_TTL_MS - 50 }
  ], now);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].text, "hello");
  const merged = mergeUtterance([{ text: "hello", source: "mic", at: now - 10 }], "hello hello", "mic", now);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, "hello hello");
  assert.equal(similarUtterance("hello", "hello hello"), true);
});

test("manual table rows serialize and match by soundId", async () => {
  const {
    parseManualCatalog,
    matchRowToTrack,
    tableRowsFromCatalog,
    parseTableDraft,
    serializeTableDraft,
    normalizeManualRow
  } = await import("../src/rag/manual-catalog.js");
  const catalog = [
    { soundId: "a", name: "Warm Hearth", playlistName: "Town", path: "music/hearth.ogg", mood: "tavern", intensity: 2, tags: ["folk"] }
  ];
  const rows = tableRowsFromCatalog(catalog, { fill: true });
  assert.equal(rows[0].mood, "tavern");
  const empty = tableRowsFromCatalog(catalog, { fill: false });
  assert.equal(empty[0].mood, "");
  const parsed = parseTableDraft(serializeTableDraft(rows));
  assert.equal(parsed[0].soundId, "a");
  const normalized = normalizeManualRow({ soundId: "a", name: "Warm Hearth", tags: "folk, social", mood: "tavern" });
  assert.deepEqual(normalized.tags, ["folk", "social"]);
  assert.equal(matchRowToTrack(normalized, catalog).soundId, "a");
  assert.equal(parseManualCatalog("Steel Clash | combat | 5").length, 1);
});

test("ChatAnywhere host-only URLs get /v1", async () => {
  const { normalizeLlmBaseUrl } = await import("../src/constants.js");
  assert.equal(normalizeLlmBaseUrl("https://api.chatanywhere.org"), "https://api.chatanywhere.org/v1");
  assert.equal(normalizeLlmBaseUrl("https://api.chatanywhere.org/v1/"), "https://api.chatanywhere.org/v1");
});

test("shipped defaults match the documented DJ sampling", async () => {
  const { DEFAULTS } = await import("../src/constants.js");
  assert.equal(DEFAULTS.llmTemperature, 0.4);
  assert.equal(DEFAULTS.llmMaxTokens, 900);
  assert.equal(DEFAULTS.llmTopP, 1);
  assert.equal(DEFAULTS.cooldown, 20);
  assert.equal(DEFAULTS.maxProposals, 3);
  assert.equal(DEFAULTS.autoAnalyze, true);
  assert.equal(DEFAULTS.llmProvider, "openrouter");
});

test("engineer logs redact API keys", async () => {
  const { redact, maskSecret, logInfo, formatLogDump } = await import("../src/debug/log.js");
  const fake = "sk-abcdefghijklmnopqrstuvwxyz123456";
  assert.equal(maskSecret(fake).endsWith("3456"), true);
  const hidden = redact({
    apiKey: fake,
    text: `Authorization Bearer ${fake}`
  });
  assert.equal(hidden.apiKey.includes("sk-abcd"), false);
  assert.equal(String(hidden.text).includes("sk-abcd"), false);
  logInfo("test.event", { apiKey: fake });
  assert.match(formatLogDump(), /test\.event/);
  assert.doesNotMatch(formatLogDump(), /sk-abcdefghijklmnopqrstuvwxyz123456/);
});

test("manual catalog parser matches names and filled columns", async () => {
  const { parseManualCatalog, matchRowToTrack, heuristicCard, buildCatalogTemplate } = await import("../src/rag/manual-catalog.js");
  const rows = parseManualCatalog(`
# comment
Warm Hearth | tavern | 2 | folk, social | Inns
Steel Clash
`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].mood, "tavern");
  assert.equal(rows[0].intensity, 2);
  assert.deepEqual(rows[0].tags, ["folk", "social"]);
  assert.equal(rows[1].mood, "");
  const catalog = [
    { soundId: "a", name: "Warm Hearth", playlistName: "Town", path: "music/hearth.ogg" },
    { soundId: "b", name: "Steel Clash", playlistName: "Battle", path: "music/battle-steel.mp3" }
  ];
  assert.equal(matchRowToTrack(rows[0], catalog).soundId, "a");
  assert.equal(matchRowToTrack(rows[1], catalog).soundId, "b");
  const card = heuristicCard(rows[1], catalog[1]);
  assert.equal(card.mood, "combat");
  assert.match(buildCatalogTemplate(catalog), /Warm Hearth/);
});

test("memory markdown lists likes and bans", async () => {
  const { renderMemoryMarkdown } = await import("../src/memory/markdown.js");
  const md = renderMemoryMarkdown({
    worldName: "Test World",
    likes: { combat: { b: { name: "Steel Clash", count: 2 } } },
    banned: [{ soundId: "x", name: "Nope" }],
    events: [{ at: Date.now(), action: "play", name: "Steel Clash", mood: "combat", scene: "Gate", why: "fits" }],
    path: "worlds/test/agentic-dj/memory.md"
  });
  assert.match(md, /Steel Clash/);
  assert.match(md, /Nope/);
  assert.match(md, /memory\.md/);
});
