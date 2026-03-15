function floatTo16BitPCM(input) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export class MicrophoneCapture {
  constructor(options = {}) {
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.chunks = [];
    this.onChunk = options.onChunk || null;
    this.onSpeechStart = options.onSpeechStart || null;
    this.onSpeechEnd = options.onSpeechEnd || null;
    this.onLevel = options.onLevel || null;
    this.bufferSize = options.bufferSize || 4096;
    this.collectChunks = Boolean(options.collectChunks);
    this.mimeType = "audio/lpcm;rate=16000;channels=1;sampleSizeBits=16";
    this.startThreshold = Number(options.startThreshold ?? 0.024);
    this.stopThreshold = Number(options.stopThreshold ?? 0.014);
    this.minSpeechFrames = Math.max(1, Number(options.minSpeechFrames ?? 2));
    this.silenceDurationMs = Math.max(120, Number(options.silenceDurationMs ?? 700));
    this.smoothedLevel = 0;
    this.lastVoiceAt = 0;
    this.aboveThresholdFrames = 0;
    this.isSpeaking = false;
  }

  async start(options = {}) {
    await this.stop();
    this.onChunk = options.onChunk || this.onChunk;
    this.onSpeechStart = options.onSpeechStart || this.onSpeechStart;
    this.onSpeechEnd = options.onSpeechEnd || this.onSpeechEnd;
    this.onLevel = options.onLevel || this.onLevel;
    this.bufferSize = options.bufferSize || this.bufferSize;
    this.collectChunks = Boolean(options.collectChunks ?? this.collectChunks);
    this.startThreshold = Number(options.startThreshold ?? this.startThreshold);
    this.stopThreshold = Number(options.stopThreshold ?? this.stopThreshold);
    this.minSpeechFrames = Math.max(1, Number(options.minSpeechFrames ?? this.minSpeechFrames));
    this.silenceDurationMs = Math.max(120, Number(options.silenceDurationMs ?? this.silenceDurationMs));
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.context = new AudioContext({ sampleRate: 16000 });
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(this.bufferSize, 1, 1);
    this.chunks = [];
    this.smoothedLevel = 0;
    this.lastVoiceAt = 0;
    this.aboveThresholdFrames = 0;
    this.isSpeaking = false;
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(input);
      const level = this.detectLevel(input);
      const speaking = this.updateSpeechState(level);
      if (this.collectChunks) {
        this.chunks.push(pcm);
      }
      this.onLevel?.(level);
      this.onChunk?.({
        bytes: pcm,
        audioBase64: toBase64(pcm),
        byteLength: pcm.length,
        mimeType: this.mimeType,
        level,
        isSpeaking: speaking,
      });
    };
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  async stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    this.isSpeaking = false;
    this.aboveThresholdFrames = 0;
    this.lastVoiceAt = 0;
    this.smoothedLevel = 0;
  }

  async finish() {
    const chunks = this.chunks;
    await this.stop();
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const joined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      audioBase64: toBase64(joined),
      mimeType: this.mimeType,
      byteLength: joined.length,
    };
  }

  detectLevel(input = []) {
    if (!input.length) return 0;
    let sumSquares = 0;
    for (let index = 0; index < input.length; index += 1) {
      const sample = input[index];
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / input.length);
    this.smoothedLevel = this.smoothedLevel
      ? (this.smoothedLevel * 0.82) + (rms * 0.18)
      : rms;
    return this.smoothedLevel;
  }

  updateSpeechState(level = 0) {
    const now = performance.now();
    if (!this.isSpeaking) {
      if (level >= this.startThreshold) {
        this.aboveThresholdFrames += 1;
        if (this.aboveThresholdFrames >= this.minSpeechFrames) {
          this.isSpeaking = true;
          this.lastVoiceAt = now;
          this.aboveThresholdFrames = 0;
          this.onSpeechStart?.({ level });
        }
      } else {
        this.aboveThresholdFrames = 0;
      }
      return this.isSpeaking;
    }

    if (level >= this.stopThreshold) {
      this.lastVoiceAt = now;
    }
    if (now - this.lastVoiceAt >= this.silenceDurationMs) {
      this.isSpeaking = false;
      this.aboveThresholdFrames = 0;
      this.onSpeechEnd?.({ level });
    }
    return this.isSpeaking;
  }
}
