# Voice Input Research — Issue #4

Research conducted 2026-03-23 for STT engine selection, audio capture architecture, and custom vocabulary strategy.

## Audio Capture: Rust (cpal), Not WebView

**Decision: Capture audio in the Rust backend, not the Tauri webview.**

The Web Audio API (`getUserMedia` / `MediaRecorder`) in a Tauri webview has serious problems for our use case:

- **macOS:** Multiple open Tauri/Wry issues. `getUserMedia` throws `NotAllowedError` in production builds. Permission prompt reappears every launch (Wry #1195, Tauri #8979). Root cause is WKWebView's fragile `requestMediaCapturePermissionForOrigin` delegation.
- **Linux (WebKitGTK):** `getUserMedia` denied by default; requires explicit permission handler wiring.
- **Global hotkey trigger:** Browser security requires user gesture for `getUserMedia`. When the game is fullscreen and the hotkey fires from Rust, the webview may not honor a programmatic recording start — especially on macOS.
- **Precedent:** MumbleFlow (production Tauri 2.0 app) uses exactly our target architecture: global hotkey → cpal audio capture in Rust → STT. Works reliably while other apps are in the foreground.

**Architecture:**

```
Hold hotkey → Rust: cpal starts mic capture
Release hotkey → Rust: stop capture, encode WAV, return bytes to frontend via IPC
Frontend → receives audio blob, assembles vocab hints from game state
Frontend → calls OpenAI Whisper API with audio + prompt glossary
Frontend → gets transcript, pushes into playerIntent$ as { type: "query", text }
Existing coaching pipeline → handles it like typed text
```

**Rust-side implementation:**

- `cpal` for cross-platform mic access, `hound` for WAV encoding
- Two Tauri commands: `start_recording` and `stop_recording` (returns WAV bytes)
- Audio format: 16-bit PCM, mono, 16kHz (speech-optimized, what Whisper expects)
- A 10-second clip at this rate is ~320KB — well within Tauri IPC limits

**Options for Rust-side capture:**

- `tauri-plugin-mic-recorder` (v2.0.0, uses cpal + hound, cross-platform, start/stop API)
- `cpal` directly for more control
- Both produce PCM/WAV audio that STT APIs accept natively

## STT Engine: OpenAI Whisper API (Swappable)

**Decision: Start with OpenAI Whisper API, design a provider interface for swappability.**

Whisper was chosen for the POC because it uses the same OpenAI API key we already have for the coaching LLM (GPT-5.4 mini) — no new credentials needed. We also have prior experience with the API. The provider interface allows swapping to Deepgram or local whisper.cpp later.

### Provider Comparison

| Factor                | OpenAI Whisper API              | Deepgram (Nova-3)                | Local whisper.cpp         |
| --------------------- | ------------------------------- | -------------------------------- | ------------------------- |
| Vocab mechanism       | `prompt` param (glossary-style) | `keyterm` param (per-word boost) | `--prompt` flag           |
| Vocab token limit     | **224 tokens**                  | 500 tokens, 100 keyterms         | ~224 tokens (~20 optimal) |
| Latency (short clips) | ~1-2s                           | ~200-500ms                       | ~1-2s (GPU), ~3-5s (CPU)  |
| Cost                  | $0.006/min                      | $0.0043/min, $200 free credit    | Free                      |
| Runs locally          | No                              | No                               | Yes                       |
| Audio formats         | WAV, MP3, WebM                  | 100+ formats incl. raw PCM       | WAV, MP3                  |

### How Whisper Prompt Hinting Works

The `prompt` parameter accepts a text string (max 224 tokens, silently truncates beyond that). Whisper uses it as style/vocabulary context for decoding. The recommended approach for custom vocabulary is a glossary format:

```
"Glossary: Rabadon's, Zhonya's, Fimbulwinter, Aatrox, Vel'Koz, Morellonomicon"
```

From OpenAI's Whisper prompting guide:

- Short prompts are less reliable than longer ones
- Prompts steer style and spelling, not comprehension
- Works well for proper nouns, product names, and unusual spellings
- Formatting is preserved — if you send `Zhonya's`, that's how it appears in output

### How Deepgram Keyterm Prompting Works

Deepgram's `keyterm` parameter (Nova-3/Flux only) takes individual words or phrases and biases the model toward recognizing them. Key characteristics:

- Each keyterm is a separate query parameter: `keyterm=Rabadon's&keyterm=Zhonya's`
- Supports multi-word phrases: `keyterm=Infinity%20Edge`
- Preserves formatting/casing in output
- Limited to 500 tokens and 100 keyterms per request
- Best practice: focus on 20-50 most important terms
- Deepgram recommends: industry-specific terminology, product/company names, proper nouns
- Avoid: generic common words, overly broad terms

### Why Deepgram Remains the Swap Target

Deepgram has a larger vocabulary budget (500 vs 224 tokens), faster latency (~200-500ms vs ~1-2s), and per-word boosting rather than glossary-style hinting. If Whisper accuracy or latency becomes a problem during testing, Deepgram is the upgrade path. The provider interface makes this a config change, not a rewrite.

With Deepgram's larger budget, we could send all 89 hard champion words (~170 tokens) plus all items and augments (~180 tokens deduped) for ~350 tokens total, removing the need to scope champions to the current match.

### Provider Interface Concept

```typescript
interface SttProvider {
  transcribe(audio: Blob, vocabHints: string[]): Promise<string>;
}
```

Whisper provider builds a glossary prompt string from `vocabHints`. Deepgram provider maps them to `keyterm` query params. Local whisper.cpp provider passes them as `--prompt`. The STT call happens in the frontend (TypeScript), not Rust — the OpenAI SDK is already configured for the coaching LLM.

## Custom Vocabulary Strategy

### The Problem

League of Legends has ~991 unique entity names across champions (172), items (423), and augments (396). Sending all full names would require ~3,400 tokens — far beyond any STT provider's vocabulary limit.

### The Solution: Hard Words Only, Scoped to Match

Two key optimizations stack to make the vocabulary fit:

**1. Send only the hard _words_, not full names.**

Most multi-word names contain common English words that STT handles fine. Only send the invented/fantasy words:

- "Rabadon's Deathcap" → send only `Rabadon's` ("Deathcap" is two common English words)
- "Zhonya's Hourglass" → send only `Zhonya's`
- "Fimbulwinter" → send `Fimbulwinter` (single invented word)
- "Chain Vest" → don't send at all (both words are common English)
- "Witchful Thinking" → send only `Witchful` ("Thinking" is fine)
- "Hextech Soul" → send only `Hextech`

**2. Champions scoped to current match only.**

With 89 hard champion words consuming ~170 tokens, sending all of them leaves no room for items and augments under Whisper's 224-token limit. Since players almost exclusively discuss champions in their current match, we send only the 10 match champions' hard words (~18 tokens) and use the remaining budget for items and augments.

### Token Budget (Whisper-Compatible)

| Category                                          | Hard words   | Est. tokens | Notes                         |
| ------------------------------------------------- | ------------ | ----------- | ----------------------------- |
| Match champions (10 in game)                      | ~8-10        | ~18         | Dynamic, from LiveGameState   |
| Items (ARAM-purchasable, hard words, deduped)     | 55           | ~100        | Static list                   |
| Augments (Mayhem, hard words, deduped with items) | ~37          | ~67         | Static list, after item dedup |
| Glossary overhead ("Glossary: " prefix)           | —            | ~3          |                               |
| **Total**                                         | **~100-102** | **~188**    |                               |

**~188 tokens — fits within Whisper's 224-token limit** with some room to spare. Also fits comfortably within Deepgram's 500-token limit if we swap later.

Note: The augment hard word count before dedup with items is 44. After removing words already in the items list (Hextech, Zhonya's, Wooglet's, Witchcap, Thornmail, Sheen, Mikael's), ~37 unique augment-only hard words remain.

### Hard Word Reference Lists

**Items (55):** Actualizer, Anathema's, Atma's, Bami's, Bandleglass, Bandlepipes, Battlesong, Cappa, Caulfield's, Chempunk, Chemtech, Cryptbloom, Dawncore, Fiendhunter, Fimbulwinter, Guinsoo's, Heartsteel, Helia, Hexdrinker, Hexoptics, Hexplate, Hextech, Jak'Sho, Kaenic, Kalista's, Kindlegem, Liandry's, Luden's, Malmortius, Manamune, Morellonomicon, Muramana, Nashor's, Navori, Phreakish, Poro-Snax, Rabadon's, Rageblade, Randuin's, Riftmaker, Rookern, Runaan's, Rylai's, Serylda's, Shojin, Shurelya's, Solari, Statikk, Sterak's, Tal, Witchcap, Wooglet's, Youmuu's, Yun, Zhonya's

**Augments (44 before dedup, ~37 after removing overlap with items):** ADAPt, Brutalizer, Buff, Colossus, Crit, Dawnbringer's, Dropkick, Droppybara, Earthwake, Empyrean, EscAPADe, Fey, Firebrand, Flashbang, Goldrend, Goredrink, Hextech*, Homeguard, Icathia's, Immolate, Keystone, Marksmage, Mikael's*, Minionmancer, Nightstalking, Omni, Popoffs, Poro, ReEnergize, Repulsor, Scopier, Scopiest, Sheen*, Sneakerhead, Snowball, Thornmail*, Transmute, Trueshot, Urf's, Windspeaker's, Witchcap*, Witchful, Wooglet's*, Zhonya's\*

(\*) = overlaps with items list, deduped in combined set

**Champions (89 hard words — full list for Deepgram; match-filter to ~10 for Whisper):** Aatrox, Ahri, Akali, Akshan, Alistar, Ambessa, Amumu, Anivia, Aphelios, Aurelion, Azir, Bel'Veth, Blitzcrank, Cassiopeia, Cho'Gath, Corki, Ezreal, Fiddlesticks, Fizz, Gangplank, Gnar, Gragas, Hecarim, Heimerdinger, Hwei, Illaoi, Jarvan, Jhin, K'Sante, Kai'Sa, Kalista, Karthus, Kassadin, Katarina, Kayn, Kennen, Kha'Zix, Kled, Kog'Maw, LeBlanc, Lillia, Lissandra, Malphite, Malzahar, Maokai, Milio, Mordekaiser, Mundo, Naafiri, Nidalee, Nilah, Orianna, Qiyana, Rakan, Rammus, Rek'Sai, Renekton, Rengar, Ryze, Sejuani, Seraphine, Shaco, Shyvana, Singed, Skarner, Soraka, Sylas, Tahm, Taliyah, Tristana, Tryndamere, Urgot, Veigar, Vel'Koz, Viego, Vladimir, Volibear, Wukong, Xayah, Xerath, Xin, Yasuo, Yone, Yunara, Yuumi, Zaahen, Ziggs, Zilean, Zyra

### Post-Transcription Fuzzy Matching

The vocabulary hints don't need to be perfect. After transcription, we run fuzzy matching against the full entity dictionary to normalize output:

- "rabadons deathcap" → "Rabadon's Deathcap"
- "fim bull winter" → "Fimbulwinter"
- "zhonyas" → "Zhonya's Hourglass"
- "witchful thinking" → "Witchful Thinking" (augment name)

This fuzzy matching infrastructure already exists in the coaching engine's augment name matching code (`CoachingInput.tsx`).

**Real-world testing results (2026-03-23):**

Vocab hints handle most hard words correctly. The expected failure mode is phonetically close but misspelled results — words where Whisper hears the sounds right but picks a different spelling:

- "Naafiri" → transcribed as "Neferi" (despite being in the hint list)
- "Morellonomicon" → transcribed as "Morelonomicon" (one 'l' off)
- "Morello" (common abbreviation) → transcribed correctly as-is

These are exactly the cases fuzzy matching is designed to recover. The phonetic similarity is high enough that a reasonable edit-distance or phonetic matching algorithm should map them back to the correct entity names.

## Interaction Model

**Push-to-talk (hold-to-talk):** Hold a global hotkey while speaking, release to send. Simplest model, natural for short game queries. Future iteration could explore toggle or wake-word approaches.

## Implementation Architecture

### Rust Side (Audio Capture Only)

Two Tauri commands with shared recording state:

```rust
#[tauri::command]
async fn start_recording(state: State<'_, RecordingState>) -> Result<(), String>
// Opens default input device, starts cpal stream, stores PCM samples in buffer

#[tauri::command]
async fn stop_recording(state: State<'_, RecordingState>) -> Result<Vec<u8>, String>
// Stops cpal stream, encodes buffered PCM to WAV via hound, returns WAV bytes
```

New Cargo dependencies: `cpal` for mic access, `hound` for WAV encoding.

### TypeScript Side (STT + Integration)

Three new modules:

1. **`src/lib/voice/stt-provider.ts`** — Provider interface + Whisper implementation. Uses OpenAI SDK to call transcriptions endpoint with glossary prompt built from vocab hints.

2. **`src/lib/voice/vocab-hints.ts`** — Builds the hint word list. Static item/augment hard words (built once from data pipeline) + dynamic match champion hard words (from `liveGameState$`). Deduplicates and formats as glossary string.

3. **`src/hooks/useVoiceInput.ts`** — Orchestrates the pipeline. Registers global hotkey, calls Rust commands on keydown/keyup, calls STT provider, pushes transcript into `playerIntent$`. Emits debug events to `debugInput$`.

### Frontend Debug UI

New "voice" input source in debug panel showing: recording start/stop events, raw audio duration, transcript text, Whisper latency, and the vocab hints sent with each request.

## Platform Notes

### WSL2 Limitations

Audio capture and global hotkeys do not work in WSL2:

- **Audio:** ALSA fails with "No such file or directory" — WSL2 doesn't expose host audio devices to the Linux kernel. cpal can't find a microphone.
- **Global hotkeys:** Tauri's global shortcut plugin registers with the Linux display server, but WSL2 keyboard events go through a different path. Hotkeys register successfully but never fire.
- **Conclusion:** A native Windows build is required for end-to-end testing of voice input. The Rust audio capture, global hotkey, and Whisper API call have all been verified to compile and wire up correctly — they just need real hardware access.

### Hotkey

Push-to-talk is currently bound to **F8** (configurable in `useVoiceInput.ts`). A "Hold to Talk" button in the UI header provides a fallback for environments where global hotkeys don't work.

## Open Questions

- **Windows build:** Need to set up cross-compilation or a Windows-side build environment for Tauri. The lockfile path logic in `resolve_lockfile_path()` already handles Windows native vs WSL2.
- **Whisper model version:** API currently uses `whisper-1`. Confirm if newer models are available with better accuracy.
