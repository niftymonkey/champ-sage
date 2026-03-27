/**
 * Speech-to-text provider interface and implementations.
 *
 * Abstracts the STT engine behind a simple interface so we can swap between
 * providers without changing the voice input pipeline:
 * - OpenAI Whisper API (current default — same API key as coaching LLM)
 * - Deepgram Nova-3 (upgrade path — faster, larger vocab budget)
 * - Local whisper.cpp (future — free, runs in Docker)
 *
 * The provider receives raw audio bytes and vocabulary hints, and returns
 * a transcript string with latency measurement.
 */

import OpenAI from "openai";
import { formatWhisperGlossary } from "./vocab-hints";

export interface SttResult {
  transcript: string;
  /** Round-trip time for the STT API call in milliseconds */
  latencyMs: number;
}

export interface SttProvider {
  transcribe(audio: Blob, vocabHints: string[]): Promise<SttResult>;
}

/**
 * Local Whisper provider that calls a whisper-api Docker container.
 *
 * Uses the Mnemo project's whisper-api service running locally.
 * Expects the container to be running on the specified URL (default: http://localhost:8080).
 * Falls back to whisper.cpp locally (no OpenAI key needed).
 */
export class LocalWhisperProvider implements SttProvider {
  private baseUrl: string;

  constructor(baseUrl = "http://localhost:8080") {
    this.baseUrl = baseUrl;
  }

  async transcribe(audio: Blob, _vocabHints: string[]): Promise<SttResult> {
    const formData = new FormData();
    formData.append("audio", audio, "recording.wav");
    formData.append("mode", "local");

    const start = performance.now();

    const response = await fetch(`${this.baseUrl}/transcribe`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Local Whisper failed: ${response.status} ${error}`);
    }

    const result = await response.json();
    const latencyMs = Math.round(performance.now() - start);

    return {
      transcript: result.text,
      latencyMs,
    };
  }
}

/**
 * OpenAI Whisper API implementation.
 *
 * Uses the same API key as the coaching LLM (GPT-5.4 mini), so no additional
 * credentials are needed. Vocabulary hints are formatted as a glossary string
 * in the `prompt` parameter — Whisper uses this to bias toward recognizing
 * the specified terms.
 *
 * Whisper's prompt parameter is limited to 224 tokens. Our vocabulary hint
 * list is ~188 tokens, fitting within this limit. See vocab-hints.ts for
 * the full analysis of how we stay under budget.
 */
export class WhisperProvider implements SttProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  }

  async transcribe(audio: Blob, vocabHints: string[]): Promise<SttResult> {
    // Wrap the Blob as a File — the OpenAI SDK expects a File object
    // with a name so it can determine the content type for the multipart upload.
    const file = new File([audio], "recording.wav", { type: "audio/wav" });

    // Build the glossary prompt from vocab hints.
    // When empty, we omit the prompt entirely rather than sending an empty string,
    // since Whisper performs slightly better without a prompt than with an empty one.
    const glossary = formatWhisperGlossary(vocabHints);

    const start = performance.now();

    const response = await this.client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      ...(glossary ? { prompt: glossary } : {}),
    });

    const latencyMs = Math.round(performance.now() - start);

    return {
      transcript: response.text,
      latencyMs,
    };
  }
}
