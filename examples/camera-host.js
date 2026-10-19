// Browser-owned camera lifecycle shared by the camera and video-call examples.
// nudg receives semantic events; permission, MediaStream and capture stay in the host.
export function createCameraController(video, { audio = false } = {}) {
  let stream;
  let facingMode = "user";
  let videoEnabled = true;
  let audioEnabled = true;

  const stopTracks = (value) => value?.getTracks().forEach((track) => track.stop());

  async function start() {
    let next;
    try {
      next = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio });
    } catch (error) {
      if (!audio) throw error;
      // A denied or unavailable microphone must not prevent a usable camera preview.
      next = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
    }
    stopTracks(stream);
    stream = next;
    stream.getVideoTracks().forEach((track) => (track.enabled = videoEnabled));
    stream.getAudioTracks().forEach((track) => (track.enabled = audioEnabled));
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    const playPreview = () => Promise.resolve(video.play?.()).catch(() => {});
    playPreview();
    video.addEventListener?.("loadedmetadata", playPreview, { once: true });
    return stream;
  }

  function stop() {
    stopTracks(stream);
    stream = undefined;
    video.srcObject = null;
    video.load?.();
  }

  async function switchFacing() {
    facingMode = facingMode === "user" ? "environment" : "user";
    return start();
  }

  function setVideoEnabled(enabled) {
    videoEnabled = enabled;
    stream?.getVideoTracks().forEach((track) => (track.enabled = enabled));
  }

  function setAudioEnabled(enabled) {
    audioEnabled = enabled;
    stream?.getAudioTracks().forEach((track) => (track.enabled = enabled));
  }

  function capture(canvas) {
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    try {
      canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    } catch {
      // A test double or a camera that has not produced its first frame can still
      // exercise the capture state without yielding pixels yet.
    }
    return canvas;
  }

  return {
    start,
    stop,
    switchFacing,
    setVideoEnabled,
    setAudioEnabled,
    capture,
    get stream() {
      return stream;
    },
    get facingMode() {
      return facingMode;
    },
    get hasAudio() {
      return Boolean(stream?.getAudioTracks().length);
    },
    get videoEnabled() {
      return videoEnabled;
    },
    get audioEnabled() {
      return audioEnabled;
    },
  };
}
