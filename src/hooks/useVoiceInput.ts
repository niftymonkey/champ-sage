/**
 * Voice input hook — orchestrates the push-to-talk pipeline.
 *
 * Wires together: global hotkey registration, Rust audio capture (via Tauri
 * commands), vocabulary hint assembly, and STT transcription. The resulting
 * transcript is pushed into the coaching pipeline as a query event.
 *
 * Flow:
 * 1. On mount, registers a global hotkey for push-to-talk
 * 2. Keydown → calls Rust `start_recording` command
 * 3. Keyup → calls Rust `stop_recording` to get WAV bytes
 * 4. Assembles vocab hints from current game state (match champions + static hard words)
 * 5. Sends audio + hints to STT provider (Whisper API)
 * 6. Pushes transcript into playerIntent$ as { type: "query", text }
 * 7. Emits debug events at each stage for the debug panel
 *
 * Audio capture happens in Rust (via cpal) rather than the webview because:
 * - It works regardless of window focus (game can be fullscreen)
 * - No webview permission issues (macOS/Linux getUserMedia bugs)
 * - Global hotkey fires from Rust, keeping the pipeline in one process
 *
 * See docs/voice-input-research.md for the full architecture rationale.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SttProvider, SttResult } from "../lib/voice/stt-provider";
import { buildVocabHints } from "../lib/voice/vocab-hints";
import { playerIntent$, debugInput$, liveGameState$ } from "../lib/reactive";

/** Default hotkey for push-to-talk.
 *
 * Numpad minus: easy to reach with the right hand, not used by League.
 * Note: This only works on native Windows — WSL2 global hotkeys don't fire.
 */
const PUSH_TO_TALK_HOTKEY = "NumpadSubtract";

export interface VoiceInputState {
  isRecording: boolean;
  isTranscribing: boolean;
  lastTranscript: string | null;
  lastLatencyMs: number | null;
  error: string | null;
}

export interface UseVoiceInputResult extends VoiceInputState {
  startRecording: () => Promise<void>;
  stopAndTranscribe: () => Promise<void>;
}

export function useVoiceInput(
  provider: SttProvider | null
): UseVoiceInputResult {
  const [state, setState] = useState<VoiceInputState>({
    isRecording: false,
    isTranscribing: false,
    lastTranscript: null,
    lastLatencyMs: null,
    error: null,
  });

  const providerRef = useRef(provider);
  providerRef.current = provider;

  // Track recording state in a ref so the hotkey callback always sees current value.
  // React state updates are async, but the hotkey handler fires synchronously
  // from the Tauri plugin — without a ref we'd get stale closure values.
  const isRecordingRef = useRef(false);

  const stopAndTranscribe = useCallback(async () => {
    try {
      isRecordingRef.current = false;
      setState((s) => ({ ...s, isRecording: false, isTranscribing: true }));

      debugInput$.next({
        source: "voice",
        summary: "Recording stopped, transcribing...",
      });

      // Get WAV bytes from Rust
      const wavBytes: number[] = await invoke("stop_recording");
      const blob = new Blob([new Uint8Array(wavBytes)], { type: "audio/wav" });

      // Parse the WAV header to get the actual sample rate and channel count.
      // The device may record at 48kHz stereo (Windows default) rather than
      // 16kHz mono, so we can't hardcode the bytes-per-second calculation.
      // WAV header layout: bytes 24-27 = sample rate (u32 LE), 22-23 = channels (u16 LE)
      const wavData = new Uint8Array(wavBytes);
      const view = new DataView(wavData.buffer);
      const sampleRate = view.getUint32(24, true);
      const channels = view.getUint16(22, true);
      const bitsPerSample = view.getUint16(34, true);
      const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
      const pcmBytes = Math.max(0, wavBytes.length - 44);
      const audioDurationSec =
        bytesPerSecond > 0 ? pcmBytes / bytesPerSecond : 0;
      debugInput$.next({
        source: "voice",
        summary: `Audio captured: ${audioDurationSec.toFixed(1)}s`,
      });

      if (!providerRef.current) {
        throw new Error("No STT provider configured");
      }

      // Build vocab hints from current game state
      const gameState = liveGameState$.getValue();
      const championNames = gameState.players.map((p) => p.championName);
      const hints = buildVocabHints(championNames);

      debugInput$.next({
        source: "voice",
        summary: `Vocab hints: ${hints.length} words`,
        detail: hints.join(", "),
      });

      // Transcribe
      const result: SttResult = await providerRef.current.transcribe(
        blob,
        hints
      );

      debugInput$.next({
        source: "voice",
        summary: `Transcript (${result.latencyMs}ms): ${result.transcript}`,
        detail: result.transcript,
      });

      setState((s) => ({
        ...s,
        isTranscribing: false,
        lastTranscript: result.transcript,
        lastLatencyMs: result.latencyMs,
        error: null,
      }));

      // Feed transcript into the coaching pipeline
      if (result.transcript.trim()) {
        playerIntent$.next({ type: "query", text: result.transcript });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      debugInput$.next({
        source: "voice",
        summary: `Error: ${message}`,
      });
      setState((s) => ({
        ...s,
        isRecording: false,
        isTranscribing: false,
        error: message,
      }));
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      isRecordingRef.current = true;
      setState((s) => ({ ...s, isRecording: true, error: null }));
      debugInput$.next({
        source: "voice",
        summary: "Recording started (hotkey held)",
      });
      await invoke("start_recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      isRecordingRef.current = false;
      debugInput$.next({
        source: "voice",
        summary: `Recording error: ${message}`,
      });
      setState((s) => ({ ...s, isRecording: false, error: message }));
    }
  }, []);

  // Stable refs for the hotkey handler — avoids re-registering on every render
  const startRef = useRef(startRecording);
  const stopRef = useRef(stopAndTranscribe);
  startRef.current = startRecording;
  stopRef.current = stopAndTranscribe;

  useEffect(() => {
    let cancelled = false;

    async function registerHotkey() {
      try {
        // Dynamic import — the global-shortcut plugin is only available in
        // the Tauri runtime, not in tests or browser dev mode
        const { register, unregister, isRegistered } =
          await import("@tauri-apps/plugin-global-shortcut");

        // Guard against React strict mode double-mount: if the hotkey is
        // already registered (from a previous mount that hasn't cleaned up
        // yet), unregister it first before re-registering.
        if (await isRegistered(PUSH_TO_TALK_HOTKEY)) {
          await unregister(PUSH_TO_TALK_HOTKEY);
        }

        if (cancelled) return;

        await register(PUSH_TO_TALK_HOTKEY, (event) => {
          if (event.state === "Pressed" && !isRecordingRef.current) {
            startRef.current();
          } else if (event.state === "Released" && isRecordingRef.current) {
            stopRef.current();
          }
        });

        debugInput$.next({
          source: "voice",
          summary: `Push-to-talk registered: ${PUSH_TO_TALK_HOTKEY}`,
        });
      } catch (err) {
        // Expected to fail in non-Tauri environments (tests, browser dev)
        console.warn("Global shortcut registration failed:", err);
        debugInput$.next({
          source: "voice",
          summary: `Hotkey registration failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    registerHotkey();

    return () => {
      cancelled = true;
      import("@tauri-apps/plugin-global-shortcut")
        .then(({ unregister }) => unregister(PUSH_TO_TALK_HOTKEY))
        .catch(() => {});
    };
  }, []);

  return { ...state, startRecording, stopAndTranscribe };
}

export { type SttProvider } from "../lib/voice/stt-provider";
