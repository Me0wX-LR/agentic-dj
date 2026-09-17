# Agentic DJ

A Foundry VTT **v14** module that acts as a GM-side multi-agent soundtrack director.

It does **not** auto-play. The Librarian tags your existing playlists from the audio itself, the Listener watches scene/combat/chat (and optionally the GM microphone), and the Director proposes 2–3 cues. You pick Play, Skip, or Never.

## Install from the manifest

In Foundry: **Install Module** → **Manifest URL**

```
https://raw.githubusercontent.com/Me0wX-LR/agentic-dj/main/module.json
```

Then enable **Agentic DJ** in the world. Open it from the **Playlists** directory header (headphones button) or the token scene controls.

Minimum core version: **14**.

## Why this exists

Familiar, FoundryAI, Video Game Music, Soundscape Adventure, and Audio Tagger cover generic AI GMs or rule-based mood switching. None of them combine **content-based tagging of your uploads**, **live situation listening**, and **suggest-and-confirm DJ** with BYOK models. Discord voice capture is out of v1 (browser modules cannot silently tap Discord). Use a virtual audio cable later if you want the mic to hear Discord.

## Setup (BYOK)

Configure keys under **Game Settings → Agentic DJ Providers**. Keys stay in this browser (`client` settings).

### LLM (OpenAI-compatible)

| Provider | Base URL | Notes |
| --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` | Best CORS story from a Foundry tab |
| Groq | `https://api.groq.com/openai/v1` | Fast, cheap |
| OpenAI | `https://api.openai.com/v1` | May be blocked by browser CORS; use OpenRouter or a local proxy |
| Ollama | `http://localhost:11434/v1` | Start Ollama with CORS enabled |
| Custom | any `/v1` endpoint | LM Studio, vLLM, LiteLLM |

Without an LLM key, local audio tags and the ranker still work. The Director LLM path adds planning, tool use, and verification.

### STT

- **Web Speech API** — no key, Chrome/Edge
- **Whisper-compatible HTTP** — OpenAI or Groq `/audio/transcriptions`
- **Deepgram** — REST listen

## 5-minute demo (agentic rubric)

1. Add at least four mixed tracks to Foundry playlists (calm tavern, dungeon drone, battle, travel).
2. Open Agentic DJ → **Analyze library**. The Librarian writes mood/intensity/tags from local audio features (and the LLM card if a key is set).
3. Load a tavern scene. Click **Suggest now**. You should see social/tavern-leaning cues, not autoplay.
4. Click **Listen** and say *the guards kick the door, roll initiative*, or start a combat.
5. **Skip** one suggestion. The Director recovers with a different track and remembers the skip.
6. **Play** a cue. Confirm the dialog. The table hears Foundry playlist playback.

That path is planning, tool selection (`search_catalog` / `verify_candidates` / `propose_cues`), multi-step execution, catalog verification, Foundry environment I/O, session memory, and skip recovery. Three agents: Librarian, Listener, Director.

## Optional: Audio Tagger

If [Audio Tagger](https://foundryvtt.com/packages/audio-tagger) is enabled, its tags are merged into the catalog. They are not required.

## Development

```bash
npm test
```

Retrieval ranking is covered by Node tests. Foundry UI has to be checked in a v14 world.

## License

MIT
