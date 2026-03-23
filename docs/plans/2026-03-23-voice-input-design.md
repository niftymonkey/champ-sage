# Voice Input Design — Issue #4

Branch: `feat/4-voice-input` (off main)

## Data Flow

```
Hold hotkey → Rust: cpal starts recording mic to buffer
Release hotkey → Rust: stop recording, encode WAV, return bytes via IPC
Frontend → receives WAV blob, assembles vocab hints from LiveGameState + hard word lists
Frontend → calls OpenAI Whisper API with audio + glossary prompt
Frontend → gets transcript, pushes { type: "query", text } into playerIntent$
Existing coaching pipeline → handles it like typed text
```

## Components

### 1. Rust: Audio Capture (`src-tauri/src/lib.rs`)

Two Tauri commands with shared `RecordingState` (Arc<Mutex<Option<AudioRecorder>>>):

- `start_recording` — opens default input device via cpal, starts stream, buffers PCM samples
- `stop_recording` — stops stream, encodes buffered PCM to WAV via hound, returns `Vec<u8>`

Audio format: 16-bit PCM, mono, 16kHz. A 10-second clip is ~320KB.

New Cargo deps: `cpal` (mic access), `hound` (WAV encoding).

### 2. STT Provider (`src/lib/voice/stt-provider.ts`)

```typescript
interface SttProvider {
  transcribe(audio: Blob, vocabHints: string[]): Promise<SttResult>;
}

interface SttResult {
  transcript: string;
  latencyMs: number;
}
```

Whisper implementation:

- Joins vocabHints into glossary string: `"Glossary: Rabadon's, Zhonya's, Hextech, ..."`
- Calls `openai.audio.transcriptions.create({ file, model: "whisper-1", prompt: glossary })`
- Measures and returns latency

### 3. Vocab Hints (`src/lib/voice/vocab-hints.ts`)

Builds the vocabulary hint list sent with each STT request.

Two sources combined:

- **Static:** Hard item words (55) + hard augment words (~37 after dedup). Built from curated lists of fantasy/invented words that STT engines mangle.
- **Dynamic:** Hard champion words for the 10 match champions, filtered against a set of 89 known hard champion names. Common English names (Annie, Diana) excluded.

Combined, deduplicated output is ~188 tokens — fits Whisper's 224-token limit.

### 4. Voice Input Hook (`src/hooks/useVoiceInput.ts`)

Orchestrates the full pipeline:

- Registers global hotkey via `@tauri-apps/plugin-global-shortcut`
- Keydown: `invoke("start_recording")`, sets `isRecording: true`
- Keyup: `invoke("stop_recording")` → build vocab hints → call STT → push transcript into `playerIntent$`
- Emits debug events to `debugInput$` at each stage
- Exposes: `{ isRecording, lastTranscript, latencyMs, error }`

### 5. Debug Panel Updates (`src/components/DebugPanel.tsx`)

- New "voice" input source color in debug stream
- Events: `recording-start`, `recording-stop` (with duration), `transcript` (with text + latency), `vocab-hints` (glossary sent), `error`
- Voice status card in status grid: recording state, last transcript, latency

### 6. Minimal Game Tab Change

Recording indicator only — small visual signal that the hotkey is active. Full coaching UI integration deferred to the engine branch.

## Testing Strategy

**TDD (tests first):**

- `vocab-hints.test.ts` — hard word extraction, champion filtering, dedup, token budget
- `stt-provider.test.ts` — glossary prompt assembly, mocked OpenAI client, latency measurement, error handling
- `useVoiceInput.test.ts` — recording state transitions, transcript flow to playerIntent$, debug events

**Manual (debug panel):**

- Rust audio capture (hardware-dependent)
- Global hotkey registration (platform-dependent)
- End-to-end Whisper accuracy (requires real speech)

## Implementation Order

1. Rust audio capture (start/stop commands, cpal + hound)
2. `vocab-hints.ts` + tests (pure logic, no dependencies)
3. `stt-provider.ts` + tests (Whisper implementation)
4. `useVoiceInput.ts` + tests (orchestration hook)
5. Debug panel updates (wire voice events into existing UI)
6. Manual end-to-end testing
