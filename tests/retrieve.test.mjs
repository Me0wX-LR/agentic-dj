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
