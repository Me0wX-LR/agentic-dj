import { DIRECTOR_TOOLS, MODULE_ID } from "../constants.js";
import { listCatalog } from "../rag/catalog.js";
import { inferWantedMood, retrieveTracks, verifyCandidates } from "../rag/retrieve.js";
import { hasLlmKey, setting } from "../settings.js";
import { chatComplete, extraSystem, parseJsonContent } from "../tools/llm.js";

export class Director {
  constructor(memory) {
    this.memory = memory;
  }

  async plan(situation, { recoverFrom = null } = {}) {
    const catalog = listCatalog().filter(track => track.features || track.mood);
    const local = this.localPlan(situation, catalog);
    if (!hasLlmKey() || catalog.length === 0) return local;
    try {
      return await this.agentPlan(situation, catalog, recoverFrom);
    } catch (err) {
      console.warn(`${MODULE_ID} | director LLM failed, using local ranker`, err);
      return { ...local, fallback: String(err.message || err) };
    }
  }

  localPlan(situation, catalog = listCatalog()) {
    const limit = Number(setting("maxProposals") || 3);
    const ranked = retrieveTracks(catalog, situation, this.memory.snapshot(), { limit });
    return {
      plan: `Local ranker: mood ${inferWantedMood(situation)}, combat=${Boolean(situation.inCombat)}.`,
      cues: ranked.map(row => ({
        soundId: row.track.soundId,
        name: row.track.name,
        mood: row.track.mood,
        intensity: row.track.intensity,
        tags: row.track.tags,
        why: row.reasons.slice(0, 3).join("; ") || "Best local match",
        score: row.score,
        playlistName: row.track.playlistName
      })),
      dropped: [],
      usedLlm: false
    };
  }

  async agentPlan(situation, catalog, recoverFrom) {
    const tools = {
      get_foundry_context: () => situation,
      search_catalog: (args = {}) => retrieveTracks(catalog, situation, this.memory.snapshot(), args).map(row => ({
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
        this.memory.snapshot(),
        args.intendedMood || situation.mood,
        args.intendedIntensity || situation.intensity
      ),
      propose_cues: args => args
    };

    const messages = [
      {
        role: "system",
        content: `You are the Director agent of Agentic DJ for Foundry VTT.
Decompose the live situation into mood, intensity, and constraints.
Use tools to search and verify the music catalog. Never invent soundIds.
        Finish by calling propose_cues with 2-3 options. Do not play audio.
If recovering from a GM skip/ban, do not reuse those tracks.
Respect learned likes/avoids from memory.md.${extraSystem()}`
      },
      {
        role: "user",
        content: JSON.stringify({
          situation,
          recoverFrom,
          memory: this.memory.snapshot(),
          catalogSize: catalog.length
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
      situation.mood,
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
