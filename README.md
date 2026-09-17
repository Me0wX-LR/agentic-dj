# Agentic DJ

A Foundry VTT **v14** GM-side multi-agent soundtrack director. It does **not** auto-play. The Librarian tags playlist audio, the Listener watches scene/combat/chat (optional GM mic), and the Director proposes 2–3 cues. The GM picks Play, Skip, or Never.

## Install

Foundry → **Install Module** → Manifest URL:

```
https://raw.githubusercontent.com/Me0wX-LR/agentic-dj/main/module.json
```

Enable **Agentic DJ**, then open it from the Playlists directory header. Minimum core: **14**.

---

## Design review (architecture)

Written for a senior engineer who has to decide whether this design is load-bearing or theatre.

### Problem we actually own

A Foundry GM already has playlists. The failure mode is not “no music API.” It is **wrong music at the wrong beat**, plus **no cheap way to know what a file sounds like**. Existing modules split the job:

| Approach | What it gets right | What it refuses to do |
| --- | --- | --- |
| Familiar / FoundryAI | BYOK tools, can `play_playlist` | No content analysis of *your* uploads; no suggest-and-confirm DJ loop |
| Video Game Music / Soundscape | Reliable scene/combat triggers | Rule tables, not an agent |
| Audio Tagger | Taxonomy | Manual tags |

We only build the gap: **analyze audio → situate the table → retrieve with verification → GM confirms → learn from that choice.**

### Hard constraints (non-negotiable)

1. **The runtime is a browser tab.** A Foundry module cannot join Discord voice. Mic + Foundry hooks is v1. A Discord bot would be a second product.
2. **No module-owned backend.** Keys stay `client` scope. CORS-friendly OpenAI-compatible endpoints only. If OpenAI’s browser CORS is hostile, the GM uses OpenRouter/Groq/Ollama — that is a provider fact, not a missing proxy we should invent.
3. **Playback is a Foundry document mutation.** We call `playlist.playSound` / `stopAll`. Inventing a parallel audio graph would desync players.
4. **Wrong stinger during a funeral is unrecoverable.** The agent proposes. The GM is the control plane.

### Why three agents, not one chat window

| Agent | Trigger | Failure isolation |
| --- | --- | --- |
| **Librarian** | playlist create / Analyze | WASM/decode can take seconds. Cached on `PlaylistSound` flags. Must not sit on the combat hook. |
| **Listener** | combat/scene/chat + mic chunks | High frequency, cheap. Must not call the LLM on every chat message. |
| **Director** | debounce + Suggest now | Only planner. Tool loop with a local ranker fallback. |

This is task decomposition with **separate I/O budgets**, not three system prompts in a trench coat. If STT dies, Foundry state still drives the Director. If the LLM 429s, `retrieve.js` still ranks. If analysis has not run, we degrade to filename heuristics instead of blocking the table.

A single RAG chatbot would answer “what should we play?” in prose. That fails the agentic bar (no tools, no verify, no environment write) and the table bar (GM still has to find the track by hand).

### Control loop (this is the product)

```
situation  →  plan  →  search_catalog  →  verify_candidates  →  propose_cues
                                                                  ↓
                                                         GM Play / Skip / Ban
                                                                  ↓
                                                         Foundry playlist + memory.md
```

- **Tools are real:** `get_foundry_context`, `search_catalog`, `verify_candidates`, `propose_cues`. Invented `soundId`s are dropped.
- **Verification is not a vibe check.** Candidates are rescored against catalog features, bans, and learned likes/avoids. Contradictions (ambient vs combat) get discarded before the UI.
- **Human confirmation is a safety interlock**, not a courtesy. `playSound` only runs after Play.

### Why local MIR, then an LLM card

We do **not** ship MP3s to a chat model. Cost, CORS, and copyright are all bad. The Librarian extracts tempo / energy / brightness / flux-tempo in a Worker (Essentia if vendored, Web Audio otherwise), then optionally asks the LLM to write a GM-facing card. Numeric features are the durable index; prose is a projection. No key ⇒ heuristic tags still fill the catalog, so a demo world works offline.

That is RAG with an agent in front of it: retrieve by structure, then let the Director **choose and justify**, not “embed the whole journal and hope.”

### Why BYOK over a bundled model

GMs already pay OpenRouter/Groq/Ollama. A bundled vendor lock would also force us to run inference. The adapter is OpenAI-compatible `chat/completions` + optional Whisper `audio/transcriptions`. Provider presets are URL/model defaults, not forks of the agent loop.

### Why memory is world JSON **and** `memory.md`

| Store | Job |
| --- | --- |
| World setting `learnedMemory` | Structured likes/avoids/bans for O(1) scoring. Survives reload. Travels with the world. |
| `worlds/<world>/agentic-dj/memory.md` | Inspectable log. Debuggable. A senior can open the file and see whether the agent actually learned. |
| `sessionStorage` skipped IDs | Immediate recovery after Skip, without permanently deleting a track from the catalog. |

We refuse to keep memory in the **module** folder: updates wipe it. We refuse markdown-only memory: ranking on parsed prose is a toy. Dual-write is the compromise — JSON is source of truth, markdown is the audit log.

Play increments likes for the inferred mood. Skip increments avoids and excludes the track from the next plan. Ban is world-permanent until Forget.

### Why not auto-play, Discord bots, or Familiar-as-a-library

Auto-play fights the GM. Discord capture is out of process. Familiar is a commercial AI DM with playlist tools; depending on it would make this a skin, not a DJ, and would fail “we built the agent.” Optional merge of Audio Tagger flags is a **read**, not a hard dependency.

### Fallback policy

LLM missing or 4xx → local ranker. Worker decode fails → main-thread Web Audio. STT denied → hooks only. Catalog empty → UI tells the GM to add playlists. The table never depends on a single network hop for silence vs music.

---

## Default values (engineering rationale)

Shipped in [`src/constants.js`](src/constants.js) `DEFAULTS`. The settings form **shows these values on first open**, coalesces empty/NaN back to them, and **Reset defaults** restores sampling/table knobs without wiping API keys.

| Knob | Default | Why this number, not a rounder one |
| --- | --- | --- |
| LLM provider | OpenRouter | One key, many models, browser CORS that actually works from a Foundry origin. OpenAI’s own API is the worst default for a *module*. |
| Model | `openai/gpt-4o-mini` | Tool calling is required. Mini-class is enough for JSON cards + 4 tools. A 70B default would punish Groq-less GMs on latency and spend for no retrieval gain. |
| **Temperature `0.4`** | | This is a **tool agent**, not a writer. At 0 the model repeats the same cue and brittle-fails schema. At ≥1 it hallucinates `soundId`s we then have to verify-drop, wasting a round trip. 0.4 is the lowest we could set and still get distinct combat vs tavern wording. |
| **Max tokens `900`** | | Director loop is ≤6 steps: system + situation + tool results + `propose_cues`. Empirically that fits in ~400–700 completion tokens. 900 is a ceiling with slack for a verbose provider, not an invitation to write liner notes. Librarian cards are ~150 tokens; they inherit the same cap because we share one client. Raising this is how you light money on fire when a model gets stuck. |
| **Top P `1.0`** | | Nucleus sampling **on top of** 0.4 temperature is double-damping. Truncating the tail is how tool-call tokens fall out of the nucleus. We expose the knob because some hosts ignore temperature; the default is “do not stack.” |
| STT | Web Speech API | Zero key, zero CORS, good enough for “guards kick the door.” Whisper/Deepgram are upgrades, not the onboarding path. |
| Auto-analyze | **on** | Un-indexed audio is an empty RAG. First-run cost is local CPU, not tokens (until an LLM key exists). |
| Suggestion cooldown | **20s** | `createChatMessage` and `updateCombat` are chatty. Sub-10s autosuggest is a token leak and a UI flicker. 20s still catches combat start. Manual **Suggest now** bypasses it. |
| Max proposals | **3** | Hick’s law at the table: 2 is a coin flip, 4 is a library. The GM already has the full playlist sidebar if they want a dump. |
| Extra instructions | empty | Taste belongs in `memory.md` after Play/Skip, or in this box if the GM has a house rule. We do not ship a second hidden system prompt. |

**What we did not expose:** frequency penalty, presence penalty, seed, JSON-mode toggle. They move tool-call reliability more than they move music taste. Temperature + max tokens + top P is the minimum set a GM can reason about without a paper.

If a field is blank on save, we write the default, not `0`. `0` temperature is valid **only if typed**.

---

## Setup (BYOK)

**Game Settings → Agentic DJ Providers**, or the key button on the DJ panel. Keys are `client` settings (this browser). Sampling and table knobs are also client-side except extra instructions / auto-analyze / cooldown / proposals / learned memory, which are **world** so the table shares taste.

### LLM (OpenAI-compatible)

| Provider | Base URL | Notes |
| --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` | Default. Best CORS from a Foundry tab |
| Groq | `https://api.groq.com/openai/v1` | Fast, cheap |
| ChatAnywhere | `https://api.chatanywhere.org/v1` | Host-only URLs are auto-suffixed with `/v1` |
| OpenAI | `https://api.openai.com/v1` | Often blocked by browser CORS |
| Ollama | `http://localhost:11434/v1` | Enable CORS on Ollama |
| Custom | any `/v1` | LM Studio, vLLM, LiteLLM |

No key: local tags + ranker still run. Key: Librarian cards + Director tools.

### STT

- Web Speech API (default, no key)
- Whisper-compatible HTTP
- Deepgram REST

---

## 5-minute demo

1. Add four mixed playlist tracks.
2. **Analyze library**.
3. Tavern scene → **Suggest now** (no autoplay).
4. **Listen** or start combat: “guards kick the door, roll initiative.”
5. **Skip** one cue → recovery uses memory.
6. **Play** → Foundry playlist plays for everyone; `memory.md` updates.

---

## Memory file

```
FoundryVTT/Data/worlds/<world>/agentic-dj/memory.md
```

Open or wipe from the DJ panel.

## Optional

[Audio Tagger](https://foundryvtt.com/packages/audio-tagger) tags are merged if that module is enabled. Not required.

## Development

```bash
npm test
```

## License

MIT
