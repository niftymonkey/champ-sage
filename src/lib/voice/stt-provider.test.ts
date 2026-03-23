import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhisperProvider } from "./stt-provider";

// Mock the OpenAI SDK — we don't want to make real API calls in tests
const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      audio = {
        transcriptions: {
          create: mockCreate,
        },
      };
    },
  };
});

describe("WhisperProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns transcript from Whisper API response", async () => {
    mockCreate.mockResolvedValue({ text: "should I build Rabadon's" });

    const provider = new WhisperProvider("test-api-key");
    const audio = new Blob(["fake-audio"], { type: "audio/wav" });
    const result = await provider.transcribe(audio, ["Rabadon's"]);

    expect(result.transcript).toBe("should I build Rabadon's");
  });

  it("sends audio as a File with correct name and type", async () => {
    mockCreate.mockResolvedValue({ text: "test" });

    const provider = new WhisperProvider("test-api-key");
    const audio = new Blob(["fake-audio"], { type: "audio/wav" });
    await provider.transcribe(audio, []);

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.file).toBeInstanceOf(File);
    expect(callArgs.file.name).toBe("recording.wav");
  });

  it("formats vocab hints as a glossary in the prompt parameter", async () => {
    mockCreate.mockResolvedValue({ text: "test" });

    const provider = new WhisperProvider("test-api-key");
    const audio = new Blob(["fake-audio"], { type: "audio/wav" });
    await provider.transcribe(audio, ["Aatrox", "Rabadon's", "Hextech"]);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.prompt).toBe("Glossary: Aatrox, Rabadon's, Hextech");
  });

  it("omits prompt parameter when vocab hints are empty", async () => {
    mockCreate.mockResolvedValue({ text: "test" });

    const provider = new WhisperProvider("test-api-key");
    const audio = new Blob(["fake-audio"], { type: "audio/wav" });
    await provider.transcribe(audio, []);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.prompt).toBeUndefined();
  });

  it("uses whisper-1 model", async () => {
    mockCreate.mockResolvedValue({ text: "test" });

    const provider = new WhisperProvider("test-api-key");
    const audio = new Blob(["fake-audio"], { type: "audio/wav" });
    await provider.transcribe(audio, []);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe("whisper-1");
  });

  it("measures latency", async () => {
    // Simulate a small delay
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ text: "test" }), 50)
        )
    );

    const provider = new WhisperProvider("test-api-key");
    const audio = new Blob(["fake-audio"], { type: "audio/wav" });
    const result = await provider.transcribe(audio, []);

    expect(result.latencyMs).toBeGreaterThanOrEqual(40);
    expect(result.latencyMs).toBeLessThan(500);
  });

  it("throws on API error", async () => {
    mockCreate.mockRejectedValue(new Error("API rate limit exceeded"));

    const provider = new WhisperProvider("test-api-key");
    const audio = new Blob(["fake-audio"], { type: "audio/wav" });

    await expect(provider.transcribe(audio, [])).rejects.toThrow(
      "API rate limit exceeded"
    );
  });
});
