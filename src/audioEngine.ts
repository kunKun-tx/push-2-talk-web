export type AudioInterruption =
  | { type: "context-suspended" }
  | { type: "microphone-ended" };

type AudioInterruptionHandler = (interruption: AudioInterruption) => void;

export class AudioEngineError extends Error {
  constructor(
    public readonly code: "unsupported" | "insecure" | "suspended",
    message: string,
  ) {
    super(message);
    this.name = "AudioEngineError";
  }
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gate: GainNode | null = null;
  private talkRequested = false;
  private stopping = false;
  private generation = 0;

  constructor(private readonly onInterruption: AudioInterruptionHandler) {}

  get isActive(): boolean {
    return this.context !== null && this.stream !== null;
  }

  async start(): Promise<void> {
    if (this.isActive) return;

    if (!window.isSecureContext) {
      throw new AudioEngineError(
        "insecure",
        "Microphone access requires HTTPS (or localhost during development).",
      );
    }

    if (!navigator.mediaDevices?.getUserMedia || !("AudioContext" in window)) {
      throw new AudioEngineError(
        "unsupported",
        "This browser does not provide the microphone and Web Audio features this app needs.",
      );
    }

    const startGeneration = ++this.generation;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let gate: GainNode | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      if (startGeneration !== this.generation) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }

      context = new AudioContext({ latencyHint: "interactive" });
      source = context.createMediaStreamSource(stream);
      gate = context.createGain();

      // The graph is muted before it is connected. This is the fail-closed default.
      gate.gain.value = 0;
      source.connect(gate);
      gate.connect(context.destination);

      await context.resume();
      if (context.state !== "running") {
        throw new AudioEngineError(
          "suspended",
          "Audio could not start. Tap Enable Microphone again and keep this tab in the foreground.",
        );
      }

      this.stream = stream;
      this.context = context;
      this.source = source;
      this.gate = gate;
      this.talkRequested = false;

      const activeContext = context;
      context.onstatechange = () => {
        if (
          this.context === activeContext &&
          !this.stopping &&
          activeContext.state === "suspended"
        ) {
          this.muteImmediately();
          this.onInterruption({ type: "context-suspended" });
        }
      };

      for (const track of stream.getAudioTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (this.stream === stream && !this.stopping) {
              this.muteImmediately();
              this.onInterruption({ type: "microphone-ended" });
            }
          },
          { once: true },
        );
      }
    } catch (error) {
      this.disconnectLocalGraph(source, gate);
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      if (context && context.state !== "closed") {
        await context.close().catch(() => undefined);
      }
      throw error;
    }
  }

  async setTalking(talking: boolean): Promise<boolean> {
    this.talkRequested = talking;
    const context = this.context;
    const gate = this.gate;

    if (!context || !gate) return false;

    if (!talking) {
      this.rampGateTo(0);
      return false;
    }

    if (context.state !== "running") {
      await context.resume();
    }

    // The hold may have ended while resume() was pending.
    if (!this.talkRequested || this.context !== context || this.gate !== gate) {
      this.muteImmediately();
      return false;
    }

    if (context.state !== "running") {
      this.muteImmediately();
      throw new AudioEngineError(
        "suspended",
        "Audio is paused by the browser. Keep the tab visible, then try holding again.",
      );
    }

    this.rampGateTo(1);
    return true;
  }

  forceMute(): void {
    this.talkRequested = false;
    this.rampGateTo(0);
  }

  async stop(): Promise<void> {
    ++this.generation;
    this.stopping = true;
    this.talkRequested = false;
    this.muteImmediately();

    const context = this.context;
    const stream = this.stream;
    const source = this.source;
    const gate = this.gate;

    this.context = null;
    this.stream = null;
    this.source = null;
    this.gate = null;

    if (context) context.onstatechange = null;
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.disconnectLocalGraph(source, gate);

    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }

    this.stopping = false;
  }

  private rampGateTo(value: 0 | 1): void {
    if (!this.context || !this.gate) return;
    const now = this.context.currentTime;
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setTargetAtTime(value, now, 0.008);
  }

  private muteImmediately(): void {
    if (!this.context || !this.gate) return;
    const now = this.context.currentTime;
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setValueAtTime(0, now);
  }

  private disconnectLocalGraph(
    source: MediaStreamAudioSourceNode | null,
    gate: GainNode | null,
  ): void {
    try {
      source?.disconnect();
    } catch {
      // A partially initialized node may already be disconnected.
    }

    try {
      gate?.disconnect();
    } catch {
      // A partially initialized node may already be disconnected.
    }
  }
}
