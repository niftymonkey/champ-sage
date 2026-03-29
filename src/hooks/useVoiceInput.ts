/**
 * Voice input hook — orchestrates the push-to-talk pipeline.
 *
 * Wires together: global hotkey registration, audio capture (via Electron
 * IPC to main process), vocabulary hint assembly, and STT transcription.
 * The resulting transcript is pushed into the coaching pipeline as a query event.
 *
 * Flow:
 * 1. On mount, listens for hotkey-event from Electron main process
 * 2. Keydown → calls main process `start_recording` command
 * 3. Keyup → calls main process `stop_recording` to get WAV bytes
 * 4. Assembles vocab hints from current game state (match champions + static hard words)
 * 5. Sends audio + hints to STT provider (Whisper API)
 * 6. Pushes transcript into playerIntent$ as { type: "query", text }
 * 7. Emits debug events at each stage for the debug panel
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { SttProvider, SttResult } from "../lib/voice/stt-provider";
import { buildVocabHints } from "../lib/voice/vocab-hints";
import { playerIntent$, debugInput$, liveGameState$ } from "../lib/reactive";
import {
  startRecording as startAudioCapture,
  stopRecording as stopAudioCapture,
} from "../lib/audio/recorder";

/** Default hotkey for push-to-talk.
 *
 * Numpad minus: easy to reach with the right hand, not used by League.
 * In ow-electron Phase 2, this will move to overlay.hotkeys which works
 * during gameplay. For now, the main process handles it.
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
  // React state updates are async, but the hotkey handler fires synchronously —
  // without a ref we'd get stale closure values.
  const isRecordingRef = useRef(false);

  const stopAndTranscribe = useCallback(async () => {
    try {
      isRecordingRef.current = false;
      setState((s) => ({ ...s, isRecording: false, isTranscribing: true }));

      debugInput$.next({
        source: "voice",
        summary: "Recording stopped, transcribing...",
      });

      // Get WAV bytes from renderer-side audio capture
      const wavBytes = await stopAudioCapture();
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
      // Force-reset if a previous cycle left state stuck (e.g., focus loss
      // caused a "Released" event to be missed, or an error mid-transcription)
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        try {
          await stopAudioCapture();
        } catch {
          // Ignore — just cleaning up stale state
        }
      }

      isRecordingRef.current = true;
      setState((s) => ({ ...s, isRecording: true, error: null }));
      debugInput$.next({
        source: "voice",
        summary: "Recording started (hotkey held)",
      });
      await startAudioCapture();
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
    // Phase 1: renderer-side keydown/keyup for hold-to-talk.
    // Works when the Electron window has focus. Real hold-to-talk behavior:
    // hold key = record, release key = stop and transcribe.
    // Phase 2: overlay.hotkeys will replace this for in-game support.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== PUSH_TO_TALK_HOTKEY) return;
      if (e.repeat) return; // Ignore key-repeat events
      if (isRecordingRef.current) return;
      debugInput$.next({
        source: "voice",
        summary: `Hotkey pressed: ${PUSH_TO_TALK_HOTKEY}`,
      });
      startRef.current();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== PUSH_TO_TALK_HOTKEY) return;
      if (!isRecordingRef.current) return;
      debugInput$.next({
        source: "voice",
        summary: `Hotkey released: ${PUSH_TO_TALK_HOTKEY}`,
      });
      stopRef.current();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    debugInput$.next({
      source: "voice",
      summary: `Push-to-talk listening: ${PUSH_TO_TALK_HOTKEY} (hold to talk, window focus required)`,
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return { ...state, startRecording, stopAndTranscribe };
}

export { type SttProvider } from "../lib/voice/stt-provider";
