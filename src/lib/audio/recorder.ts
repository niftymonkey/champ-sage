/**
 * Browser-based audio recorder using getUserMedia + AudioWorklet.
 *
 * Replaces the Rust cpal audio capture. Records PCM audio from the
 * default microphone and returns WAV bytes when stopped.
 *
 * Uses ScriptProcessorNode (deprecated but widely supported) for
 * accumulating raw PCM samples. AudioWorklet would be better for
 * production but requires a separate module file.
 */

interface RecordingSession {
  stream: MediaStream;
  context: AudioContext;
  processor: ScriptProcessorNode;
  samples: Float32Array[];
  sampleRate: number;
}

let session: RecordingSession | null = null;

/**
 * Start recording from the default microphone.
 * Accumulates raw PCM samples in memory.
 */
export async function startRecording(): Promise<void> {
  // Clean up any stale session
  if (session) {
    stopSession(session);
    session = null;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    },
  });

  const context = new AudioContext({ sampleRate: 16000 });
  const source = context.createMediaStreamSource(stream);

  // ScriptProcessorNode to capture raw PCM samples
  const processor = context.createScriptProcessor(4096, 1, 1);
  const samples: Float32Array[] = [];

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const input = event.inputBuffer.getChannelData(0);
    samples.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(context.destination);

  session = {
    stream,
    context,
    processor,
    samples,
    sampleRate: context.sampleRate,
  };
}

/**
 * Stop recording and return the captured audio as WAV bytes.
 * Returns a number[] matching the format the STT pipeline expects.
 */
export async function stopRecording(): Promise<number[]> {
  if (!session) {
    throw new Error("Not currently recording");
  }

  const { samples, sampleRate } = session;
  stopSession(session);
  session = null;

  if (samples.length === 0) {
    throw new Error("No audio captured");
  }

  // Merge Float32Array chunks into a single buffer
  const totalLength = samples.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of samples) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert Float32 [-1, 1] to Int16 PCM
  const pcm = new Int16Array(merged.length);
  for (let i = 0; i < merged.length; i++) {
    const s = Math.max(-1, Math.min(1, merged[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // Encode as WAV
  const wavBytes = encodeWav(pcm, sampleRate, 1);
  return Array.from(new Uint8Array(wavBytes));
}

export function isRecording(): boolean {
  return session !== null;
}

function stopSession(s: RecordingSession): void {
  s.processor.disconnect();
  s.stream.getTracks().forEach((track) => track.stop());
  s.context.close().catch(() => {});
}

/**
 * Encode raw 16-bit PCM samples as a WAV file in an ArrayBuffer.
 */
function encodeWav(
  samples: Int16Array,
  sampleRate: number,
  channels: number
): ArrayBuffer {
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");

  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // sub-chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  // Write PCM samples
  const output = new Int16Array(buffer, 44);
  output.set(samples);

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
