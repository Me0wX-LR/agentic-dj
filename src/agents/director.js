import { DIRECTOR_TOOLS } from "../constants.js";
import { logInfo, logWarn } from "../debug/log.js";
import { listCatalog } from "../rag/catalog.js";
import { catalogMoodCounts, inferWantedMood, retrieveTracks, verifyCandidates } from "../rag/retrieve.js";
import { hasLlmKey, setting } from "../settings.js";
import { chatComplete, extraSystem, parseJsonContent } from "../tools/llm.js";

export class Director {
  constructor(memory) {
    this.memory = memory;
  }

  async plan(situation, { recoverFrom = null } = {}) {
    const catalog = listCatalog().filter(track => track.features || track.mood);
    const moods = catalogMoodCounts(catalog);
    logInfo("director.plan.start", {
      catalogWithCards: catalog.length,
      hasLlm: hasLlmKey(),
      recoverFrom,
      mood: inferWantedMood(situation),
      intensity: situation.intensity,
      catalogMoods: moods.moods,
      homogeneous: moods.homogeneous,
      skipped: this.memory.snapshot().skippedIds?.length ?? 0
    });
    if (!hasLlmKey() || catalog.length === 0) {
      const local = this.localPlan(situation, catalog);
      logInfo("director.plan.local", { reason: !hasLlmKey() ? "no-llm-key" : "empty-catalog", cueCount: local.cues.length });
      return local;
    }
    try {
      const planned = await this.agentPlan(situation, catalog, recoverFrom);
      logInfo("director.plan.llm", { cueCount: planned.cues.length, usedLlm: planned.usedLlm });
      return planned;
    } catch (err) {
      logWarn("director.plan.llm.failed", { error: err });
      return { ...this.localPlan(situation, catalog), fallback: String(err.message || err) };
    }
  }

  localPlan(situation, catalog = listCatalog()) {
    const limit = Number(setting("maxProposals") || 3);
    const ranked = retrieveTracks(catalog, situation, this.memory.snapshot(), { limit });
    const cues = ranked.map(row => ({
      soundId: row.track.soundId,
      name: row.track.name,
      mood: row.track.mood,
      intensity: row.track.intensity,
      tags: row.track.tags,
      why: row.reasons.slice(0, 3).join("; ") || "Best local match",
      score: row.score,
      playlistName: row.track.playlistName
    }));
    this.memory.noteProposed(cues.map(cue => cue.soundId));
    return {
      plan: `Local ranker: mood ${inferWantedMood(situation)}, combat=${Boolean(situation.inCombat)}.`,
      cues,
      dropped: [],
      usedLlm: false
    };
  }

  async agentPlan(situation, catalog, recoverFrom) {
    const memory = () => this.memory.snapshot();
    const tools = {
      get_foundry_context: () => situation,
      search_catalog: (args = {}) => retrieveTracks(catalog, situation, memory(), {
        ...args,
        query: args.query || situation.transcript || ""
      }).map(row => ({
        soundId: row.track.soundId,
        name: row.track.name,
        mood: row.track.mood,
        intensity: row.track.intensity,
        tags: row.track.tags,
        useWhen: row.track.useWhen,
        avoidWhen: row.track.avoidWhen,
        score: row.score,
        reasons: row.reasons
      })),
      verify_candidates: (args = {}) => verifyCandidates(
        catalog,
        args.soundIds ?? [],
        situation,
        memory(),
        args.intendedMood || inferWantedMood(situation),
        args.intendedIntensity || situation.intensity
      ),
      propose_cues: args => args
    };

    const moods = catalogMoodCounts(catalog);
    const messages = [
      {
        role: "system",
        content: `You are the Director agent of Agentic DJ for Foundry VTT.
The mood field is a weak heuristic. Read transcript and chat in ANY language (Cantonese, Mandarin, Japanese, English) and infer the real table mood yourself.
Use tools to search and verify the music catalog. Never invent soundIds.
Search with the inferred mood AND a short query taken from the transcript. Do not blindly reuse mood=exploration.
If the catalog is mostly one stored mood, ignore those labels and rank by energy, tempo, intensity, and name.
Never propose the same three tracks twice in a row when alternatives exist.
If recovering from a GM skip/ban, verify search_catalog hits — never the skipped/banned id.
Finish by calling propose_cues with 2-3 options. Do not play audio.
Respect learned likes/avoids from memory.md.${extraSystem()}`
      },
      {
        role: "user",
        content: JSON.stringify({
          situation,
          recoverFrom,
          memory: memory(),
          catalogSize: catalog.length,
          catalogMoods: moods.moods,
          catalogHomogeneous: moods.homogeneous
        })
      }
    ];

    let proposal = null;
    for (let step = 0; step < 6; step++) {
      const message = await chatComplete({ messages, tools: DIRECTOR_TOOLS });
      messages.push(message);
      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        const parsed = parseJsonContent(message.content);
        if (parsed?.cues) {
          proposal = parsed;
          break;
        }
        messages.push({ role: "user", content: "Call propose_cues with verified soundIds." });
        continue;
      }
      for (const call of calls) {
        const name = call.function?.name;
        const args = safeParse(call.function?.arguments);
        const impl = tools[name];
        let result;
        if (!impl) result = { error: `unknown tool ${name}` };
        else result = await impl(args);
        if (name === "propose_cues") proposal = result;
        logInfo("director.tool", {
          step,
          name,
          args: name === "search_catalog" || name === "verify_candidates" ? args : undefined,
          resultPreview: summarizeToolResult(name, result)
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result ?? {})
        });
      }
      if (proposal?.cues) break;
    }

    if (!proposal?.cues?.length) return this.localPlan(situation, catalog);

    const verified = verifyCandidates(
      catalog,
      proposal.cues.map(cue => cue.soundId),
      situation,
      this.memory.snapshot(),
      inferWantedMood(situation),
      situation.intensity
    );
    const cues = verified.kept.slice(0, Number(setting("maxProposals") || 3)).map(row => {
      const llmWhy = proposal.cues.find(cue => cue.soundId === row.track.soundId)?.why;
      return {
        soundId: row.track.soundId,
        name: row.track.name,
        mood: row.track.mood,
        intensity: row.track.intensity,
        tags: row.track.tags,
        why: llmWhy || row.reasons.slice(0, 3).join("; "),
        score: row.score,
        playlistName: row.track.playlistName,
        verified: true
      };
    });
    if (!cues.length) return this.localPlan(situation, catalog);
    this.memory.noteProposed(cues.map(cue => cue.soundId));
    return {
      plan: proposal.plan || "LLM Director verified catalog matches.",
      cues,
      dropped: verified.dropped,
      usedLlm: true
    };
  }
}

function safeParse(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function summarizeToolResult(name, result) {
  if (!result) return null;
  if (name === "search_catalog" && Array.isArray(result)) {
    return result.slice(0, 6).map(row => ({ soundId: row.soundId, name: row.name, score: row.score }));
  }
  if (name === "verify_candidates") {
    return {
      kept: (result.kept ?? []).map(row => row.track?.soundId || row.soundId),
      dropped: result.dropped
    };
  }
  if (name === "propose_cues") {
    return { cues: (result.cues ?? []).map(cue => ({ soundId: cue.soundId, why: cue.why })) };
  }
  if (name === "get_foundry_context") {
    return { scene: result.sceneName, inCombat: result.inCombat, mood: result.mood };
  }
  return result;
}
