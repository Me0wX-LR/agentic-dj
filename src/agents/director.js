import { DIRECTOR_TOOLS } from "../constants.js";
import { logInfo, logWarn } from "../debug/log.js";
import { listCatalog } from "../rag/catalog.js";
import { catalogMoodCounts, inferWantedIntensity, inferWantedMood, resolveCatalogId, retrieveTracks, verifyCandidates } from "../rag/retrieve.js";
import { hasLlmKey, setting } from "../settings.js";
import { chatComplete, extraSystem, parseJsonContent } from "../tools/llm.js";

export class Director {
  constructor(memory) {
    this.memory = memory;
  }

  async plan(situation, { recoverFrom = null, liveSituation = null, signal = null } = {}) {
    const catalog = listCatalog().filter(track => track.features || track.mood);
    const moods = catalogMoodCounts(catalog);
    const live = enrichSituation(liveSituation?.() || situation);
    logInfo("director.plan.start", {
      catalogWithCards: catalog.length,
      hasLlm: hasLlmKey(),
      recoverFrom,
      mood: live.wantedMood,
      intensity: live.intensity,
      transcript: String(live.transcript || "").slice(0, 160),
      catalogMoods: moods.moods,
      homogeneous: moods.homogeneous,
      skipped: this.memory.snapshot().skippedIds?.length ?? 0
    });
    if (!hasLlmKey() || catalog.length === 0) {
      const local = this.localPlan(live, catalog);
      logInfo("director.plan.local", { reason: !hasLlmKey() ? "no-llm-key" : "empty-catalog", cueCount: local.cues.length });
      return local;
    }
    try {
      const planned = await this.agentPlan(live, catalog, recoverFrom, { liveSituation, signal });
      logInfo("director.plan.llm", { cueCount: planned.cues.length, usedLlm: planned.usedLlm });
      return planned;
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") throw err;
      logWarn("director.plan.llm.failed", { error: err });
      return { ...this.localPlan(enrichSituation(liveSituation?.() || situation), catalog), fallback: String(err.message || err) };
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

  async agentPlan(situation, catalog, recoverFrom, { liveSituation, signal } = {}) {
    const memory = () => this.memory.snapshot();
    const live = () => enrichSituation(liveSituation?.() || situation);
    const tools = {
      get_foundry_context: () => live(),
      search_catalog: (args = {}) => {
        const sit = live();
        return retrieveTracks(catalog, sit, memory(), {
          ...args,
          query: args.query || sit.transcript || ""
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
        }));
      },
      verify_candidates: (args = {}) => {
        const sit = live();
        return verifyCandidates(
          catalog,
          args.soundIds ?? [],
          sit,
          memory(),
          args.intendedMood,
          args.intendedIntensity || sit.intensity
        );
      },
      propose_cues: args => args
    };

    const moods = catalogMoodCounts(catalog);
    const opening = live();
    const messages = [
      {
        role: "system",
        content: `You are the Director agent of Agentic DJ for Foundry VTT.
The mood field is a weak heuristic. Read transcript, GM typed notes, and chat in ANY language (Cantonese, Mandarin, Japanese, English) and infer the real table mood yourself.
Death, blood, and fighting (死、流血、打交) are combat/horror, never exploration beds.
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
          situation: opening,
          wantedMood: opening.wantedMood,
          recoverFrom,
          memory: memory(),
          catalogSize: catalog.length,
          catalogMoods: moods.moods,
          catalogHomogeneous: moods.homogeneous
        })
      }
    ];

    let proposal = null;
    for (let step = 0; step < 5; step++) {
      if (signal?.aborted) {
        const err = new Error("Plan aborted");
        err.name = "AbortError";
        throw err;
      }
      const message = await chatComplete({ messages, tools: DIRECTOR_TOOLS, timeoutMs: 18000, signal });
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

    if (!proposal?.cues?.length) return this.localPlan(live(), catalog);

    const verified = verifyCandidates(
      catalog,
      proposal.cues.map(cue => resolveCatalogId(catalog, cue.soundId) || cue.soundId),
      live(),
      this.memory.snapshot(),
      inferWantedMood(live()),
      live().intensity
    );
    const cues = verified.kept.slice(0, Number(setting("maxProposals") || 3)).map(row => {
      const llmWhy = proposal.cues.find(cue => {
        const id = resolveCatalogId(catalog, cue.soundId) || cue.soundId;
        return id === row.track.soundId;
      })?.why;
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
    if (!cues.length) return this.localPlan(live(), catalog);
    this.memory.noteProposed(cues.map(cue => cue.soundId));
    return {
      plan: proposal.plan || "LLM Director verified catalog matches.",
      cues,
      dropped: verified.dropped,
      usedLlm: true
    };
  }
}

function enrichSituation(situation = {}) {
  const wantedMood = inferWantedMood(situation);
  return {
    ...situation,
    wantedMood,
    mood: wantedMood,
    intensity: inferWantedIntensity({ ...situation, wantedMood })
  };
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
