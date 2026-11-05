// Recording and playing voice and round video messages. The browser's media APIs where they
// are allowed; otherwise a stand-in (a made-up level, a silent clock), so the example works
// without a microphone, a camera or permission. Nothing here moves anything: the level and
// the progress go to nudg files as inputs.

export interface Clip {
  /** The recording, or nothing for a stand-in that only has a length. */
  url?: string;
  /** Seconds. */
  duration: number;
  /** Bar heights from 0 to 1, for the waveform. */
  bars: number[];
}

export interface Recording {
  /** The camera, for the live preview of a round video. */
  stream?: MediaStream;
  /** The microphone level, 0 to 1. */
  level(): number;
  /** Seconds since recording started. */
  elapsed(): number;
  stop(): Promise<Clip>;
  cancel(): void;
}

export const BARS = 28;

// One audio context for the level meter. Safari starts it suspended unless it is created or
// resumed in a person's gesture, which recording (after a hold) is not; wakeAudio is called on the press.
let audio: AudioContext | undefined;
export function wakeAudio() {
  audio ??= new AudioContext();
  void audio.resume().catch(() => {});
}

export interface Devices {
  /** The microphone, and the camera for a round video; nothing when the browser said no. */
  stream?: MediaStream;
  /** Why there is no stream, in words for the person. */
  problem?: string;
}

/**
 * Asks for the microphone (and the camera). Called on the press itself, so a browser that has
 * to ask shows its prompt right away, not halfway through a recording.
 */
export async function openDevices(video: boolean): Promise<Devices> {
  const what = video ? "camera and microphone" : "microphone";
  if (!navigator.mediaDevices?.getUserMedia) return { problem: `This page can't use the ${what} here (it needs https). Recording a stand-in.` };
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: "user", width: 480, height: 480 } : false }) };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError")
      return { problem: `The ${what} ${video ? "are" : "is"} blocked for this site (in the browser's site settings, or the system's privacy settings). Recording a stand-in.` };
    if (name === "NotFoundError" || name === "OverconstrainedError") return { problem: `No ${what} found. Recording a stand-in.` };
    return { problem: `The ${what} didn't start (${name || "unknown error"}). Recording a stand-in.` };
  }
}

/** Lets go of devices that were opened for a press that didn't become a recording. */
export function closeDevices(devices: Devices) {
  devices.stream?.getTracks().forEach((t) => t.stop());
}

/** Records from opened devices, or along a stand-in when there are none. */
export function record(devices: Devices): Recording {
  const start = performance.now();
  const elapsed = () => (performance.now() - start) / 1000;
  const { stream } = devices;

  let level = () => Math.max(0, Math.min(1, 0.35 + 0.25 * Math.sin(elapsed() * 7) + 0.2 * Math.sin(elapsed() * 17)));
  let source: MediaStreamAudioSourceNode | undefined;
  if (stream) {
    wakeAudio();
    const analyser = audio!.createAnalyser();
    analyser.fftSize = 512;
    source = audio!.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    level = () => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
      return Math.min(1, rms * 6);
    };
  }

  const levels: number[] = [];
  const sampler = setInterval(() => levels.push(level()), 100);
  const chunks: Blob[] = [];
  const recorder = stream && typeof MediaRecorder !== "undefined" ? new MediaRecorder(stream) : undefined;
  recorder?.addEventListener("dataavailable", (e) => chunks.push(e.data));
  recorder?.start();

  const release = () => {
    clearInterval(sampler);
    stream?.getTracks().forEach((t) => t.stop());
    source?.disconnect();
  };
  return {
    stream,
    level,
    elapsed,
    async stop() {
      const duration = elapsed();
      if (recorder && recorder.state !== "inactive") {
        const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
        recorder.stop();
        await stopped;
      }
      release();
      const url = chunks.length ? URL.createObjectURL(new Blob(chunks, { type: recorder?.mimeType })) : undefined;
      return { url, duration, bars: squash(levels, BARS) };
    },
    cancel() {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}

/** `n` bars from the sampled levels, each the loudest sample in its stretch, scaled to the loudest. */
export function squash(levels: number[], n: number): number[] {
  if (!levels.length) return Array.from({ length: n }, () => 0.1);
  const out = Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * levels.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / n));
    return Math.max(...levels.slice(from, to));
  });
  const top = Math.max(...out) || 1;
  return out.map((v) => Math.max(0.1, v / top));
}

export interface Playback {
  play(): void;
  pause(): void;
  destroy(): void;
}

/**
 * Plays a clip through `media` (an audio or video element), or along a silent clock when the
 * clip has no recording. Reports progress each frame and once at the end.
 */
export function playback(clip: Clip, media: HTMLMediaElement | undefined, onProgress: (p: number) => void, onEnded: () => void): Playback {
  let frame = 0;
  // The silent clock: where it was paused, and when it last started.
  let position = 0;
  let since = 0;
  const now = () => (media && clip.url ? media.currentTime : position + (since ? (performance.now() - since) / 1000 : 0));
  const end = () => {
    cancelAnimationFrame(frame);
    since = 0;
    position = 0;
    onProgress(1);
    onEnded();
  };
  const tick = () => {
    // A recorded clip's own duration is often unknown (Infinity) until it has played through.
    const p = Math.min(1, now() / clip.duration);
    if (!(media && clip.url) && p >= 1) return end();
    onProgress(p);
    frame = requestAnimationFrame(tick);
  };
  media?.addEventListener("ended", end);
  return {
    play() {
      if (media && clip.url) void media.play().catch(() => {});
      else since = performance.now();
      frame = requestAnimationFrame(tick);
    },
    pause() {
      cancelAnimationFrame(frame);
      if (media && clip.url) media.pause();
      else if (since) {
        position += (performance.now() - since) / 1000;
        since = 0;
      }
    },
    destroy() {
      cancelAnimationFrame(frame);
      media?.removeEventListener("ended", end);
      media?.pause();
    },
  };
}

/** m:ss; a length under a second still shows as 0:01. */
export const clock = (seconds: number, length = false) => {
  const s = length ? Math.max(1, Math.round(seconds)) : Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
