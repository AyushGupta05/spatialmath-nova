function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export class PcmAudioPlayer {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 24000;
    this.context = null;
    this.nextStartTime = 0;
    this.sources = new Set();
  }

  async ensureContext(sampleRate = this.sampleRate) {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext({ sampleRate });
      this.nextStartTime = 0;
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context;
  }

  async appendBase64Chunk(base64, sampleRate = this.sampleRate) {
    if (!base64) return;
    const context = await this.ensureContext(sampleRate);
    const bytes = decodeBase64(base64);
    if (bytes.length < 2) return;

    const frameCount = Math.floor(bytes.length / 2);
    const audioBuffer = context.createBuffer(1, frameCount, sampleRate);
    const channel = audioBuffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < frameCount; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 0x8000;
    }

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    const startTime = Math.max(context.currentTime + 0.02, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) {
        this.nextStartTime = Math.max(this.nextStartTime, context.currentTime);
      }
    };
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Audio nodes can already be ended when a new turn starts.
      }
    }
    this.sources.clear();
    if (this.context && this.context.state !== "closed") {
      this.nextStartTime = this.context.currentTime;
    } else {
      this.nextStartTime = 0;
    }
  }

  isPlaying() {
    if (!this.context || this.context.state === "closed") {
      return false;
    }
    if (this.sources.size) {
      return true;
    }
    return this.nextStartTime > (this.context.currentTime + 0.01);
  }

  async close() {
    this.stop();
    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }
    this.context = null;
    this.nextStartTime = 0;
  }
}
