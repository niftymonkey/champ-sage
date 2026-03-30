import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceInput } from "../useVoiceInput";
import type { SttProvider, SttResult } from "../../lib/voice/stt-provider";
import { playerIntent$ } from "../../lib/reactive";

// Mock the logger — vi.hoisted runs before vi.mock hoisting
const mockVoiceLog = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  getLogger: vi.fn(() => mockVoiceLog),
}));

// Mock the renderer-side audio recorder
vi.mock("../../lib/audio/recorder", () => ({
  startRecording: vi.fn().mockResolvedValue(undefined),
  stopRecording: vi.fn(),
  isRecording: vi.fn(() => false),
}));

import {
  startRecording as mockStartRecording,
  stopRecording as mockStopRecording,
} from "../../lib/audio/recorder";

// Mock window.electronAPI for hotkey events
const mockOnHotkeyEvent = vi.fn(() => () => {});

beforeEach(() => {
  window.electronAPI = {
    invoke: vi.fn(),
    onLcuEvent: vi.fn(() => () => {}),
    onLcuDisconnect: vi.fn(() => () => {}),
    onHotkeyEvent: mockOnHotkeyEvent,
    onGepInfoUpdate: vi.fn(() => () => {}),
    onGepGameEvent: vi.fn(() => () => {}),
    onOverlayStatus: vi.fn(() => () => {}),
  };
});

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
    vi.mocked(mockStopRecording).mockResolvedValue(fakeWavBytes);
    // Re-assign after clearAllMocks
    window.electronAPI = {
      invoke: vi.fn(),
      onLcuEvent: vi.fn(() => () => {}),
      onLcuDisconnect: vi.fn(() => () => {}),
      onHotkeyEvent: mockOnHotkeyEvent,
      onGepInfoUpdate: vi.fn(() => () => {}),
      onGepGameEvent: vi.fn(() => () => {}),
      onOverlayStatus: vi.fn(() => () => {}),
    };
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
    expect(mockStartRecording).toHaveBeenCalled();
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
    expect(mockStopRecording).toHaveBeenCalled();
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

  it("logs at each stage of the voice pipeline", async () => {
    const provider = createMockProvider();
    const { result } = renderHook(() => useVoiceInput(provider));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await result.current.stopAndTranscribe();
    });

    // Should have logged: recording started, recording stopped, audio captured (debug), transcript
    expect(mockVoiceLog.info).toHaveBeenCalledWith("Recording started");
    expect(mockVoiceLog.info).toHaveBeenCalledWith(
      "Recording stopped, transcribing..."
    );
    expect(mockVoiceLog.info).toHaveBeenCalledWith(
      expect.stringContaining("Transcript")
    );
    expect(mockVoiceLog.debug).toHaveBeenCalledWith(
      expect.stringContaining("Audio captured")
    );
  });

  it("handles recording errors gracefully", async () => {
    vi.mocked(mockStartRecording).mockRejectedValueOnce(
      new Error("No input device available")
    );

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
