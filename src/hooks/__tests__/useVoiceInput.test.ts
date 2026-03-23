import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceInput } from "../useVoiceInput";
import type { SttProvider, SttResult } from "../../lib/voice/stt-provider";
import { playerIntent$, debugInput$ } from "../../lib/reactive";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function createMockProvider(
  result: SttResult = { transcript: "test transcript", latencyMs: 150 }
): SttProvider {
  return {
    transcribe: vi.fn().mockResolvedValue(result),
  };
}

// Fake WAV bytes — just enough to not be empty.
// Real WAV would have a header, but the hook only cares about byte count for duration calc.
const fakeWavBytes = new Array(32000).fill(0); // ~1 second at 16kHz 16-bit mono

describe("useVoiceInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "start_recording") return undefined;
      if (cmd === "stop_recording") return fakeWavBytes;
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useVoiceInput(createMockProvider()));
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.lastTranscript).toBeNull();
    expect(result.current.lastLatencyMs).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("sets isRecording on startRecording", async () => {
    const { result } = renderHook(() => useVoiceInput(createMockProvider()));

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("start_recording");
  });

  it("transcribes on stopAndTranscribe and updates state", async () => {
    const provider = createMockProvider({
      transcript: "should I build Rabadon's",
      latencyMs: 200,
    });
    const { result } = renderHook(() => useVoiceInput(provider));

    // Start recording first
    await act(async () => {
      await result.current.startRecording();
    });

    // Stop and transcribe
    await act(async () => {
      await result.current.stopAndTranscribe();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.lastTranscript).toBe("should I build Rabadon's");
    expect(result.current.lastLatencyMs).toBe(200);
    expect(mockInvoke).toHaveBeenCalledWith("stop_recording");
  });

  it("pushes transcript into playerIntent$", async () => {
    const provider = createMockProvider({
      transcript: "which augment should I pick",
      latencyMs: 100,
    });

    const events: Array<{ type: string; text: string }> = [];
    const sub = playerIntent$.subscribe((e) =>
      events.push(e as { type: "query"; text: string })
    );

    const { result } = renderHook(() => useVoiceInput(provider));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopAndTranscribe();
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "query",
      text: "which augment should I pick",
    });

    sub.unsubscribe();
  });

  it("does not push empty transcripts into playerIntent$", async () => {
    const provider = createMockProvider({
      transcript: "   ",
      latencyMs: 100,
    });

    const events: unknown[] = [];
    const sub = playerIntent$.subscribe((e) => events.push(e));

    const { result } = renderHook(() => useVoiceInput(provider));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopAndTranscribe();
    });

    expect(events).toHaveLength(0);
    sub.unsubscribe();
  });

  it("emits debug events at each stage", async () => {
    const provider = createMockProvider();
    const debugEvents: Array<{ source: string; summary: string }> = [];
    const sub = debugInput$.subscribe((e) => debugEvents.push(e));

    const { result } = renderHook(() => useVoiceInput(provider));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopAndTranscribe();
    });

    const voiceEvents = debugEvents.filter((e) => e.source === "voice");
    expect(voiceEvents.length).toBeGreaterThanOrEqual(4);
    expect(
      voiceEvents.some((e) => e.summary.includes("Recording started"))
    ).toBe(true);
    expect(
      voiceEvents.some((e) => e.summary.includes("Recording stopped"))
    ).toBe(true);
    expect(voiceEvents.some((e) => e.summary.includes("Audio captured"))).toBe(
      true
    );
    expect(voiceEvents.some((e) => e.summary.includes("Transcript"))).toBe(
      true
    );

    sub.unsubscribe();
  });

  it("handles recording errors gracefully", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "start_recording")
        throw new Error("No input device available");
      return undefined;
    });

    const { result } = renderHook(() => useVoiceInput(createMockProvider()));

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toBe("No input device available");
  });

  it("handles transcription errors gracefully", async () => {
    const provider: SttProvider = {
      transcribe: vi.fn().mockRejectedValue(new Error("API rate limit")),
    };

    const { result } = renderHook(() => useVoiceInput(provider));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopAndTranscribe();
    });

    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.error).toBe("API rate limit");
  });

  it("errors when no provider is configured", async () => {
    const { result } = renderHook(() => useVoiceInput(null));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopAndTranscribe();
    });

    expect(result.current.error).toBe("No STT provider configured");
  });
});
