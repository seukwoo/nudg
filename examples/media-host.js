export function formatMediaTime(value) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// The host owns HTMLMediaElement commands and platform-only features. nudg sees
// semantic lifecycle events plus normalized progress, buffering and volume.
export function createMediaController(media, player, root, { autoHide = false } = {}) {
  const toggles = [...root.querySelectorAll(".media-toggle")];
  const seek = root.querySelector(".media-seek");
  const volume = root.querySelector(".media-volume");
  const mute = root.querySelector(".media-mute");
  const rate = root.querySelector(".media-rate");
  const repeat = root.querySelector(".media-repeat");
  const current = root.querySelector(".media-current");
  const duration = root.querySelector(".media-duration");
  const shell = root.querySelector(".media-shell");
  const listeners = [];
  let lastMuted = media.muted || media.volume === 0;

  const listen = (target, type, handler, options) => {
    target?.addEventListener(type, handler, options);
    if (target) listeners.push(() => target.removeEventListener(type, handler, options));
  };
  const normalized = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
  const showControls = () => {
    if (!autoHide) return;
    player.send("host.controls-show");
  };
  const syncTime = () => {
    const length = Number.isFinite(media.duration) ? media.duration : 0;
    const progress = length ? normalized(media.currentTime / length) : 0;
    player.input("host.progress", progress);
    if (seek) {
      seek.max = String(length || 0);
      seek.value = String(media.currentTime || 0);
      seek.setAttribute("aria-valuetext", `${formatMediaTime(media.currentTime)} of ${formatMediaTime(length)}`);
    }
    if (current) current.textContent = formatMediaTime(media.currentTime);
    if (duration) duration.textContent = formatMediaTime(length);
  };
  const syncBuffered = () => {
    const end = media.buffered?.length ? media.buffered.end(media.buffered.length - 1) : 0;
    player.input("host.buffered", media.duration ? normalized(end / media.duration) : 0);
  };
  const syncVolume = () => {
    const muted = media.muted || media.volume === 0;
    player.input("host.volume", muted ? 0 : media.volume);
    if (volume) volume.value = String(media.volume);
    if (mute) {
      mute.setAttribute("aria-pressed", String(muted));
      mute.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    }
    if (muted !== lastMuted) player.send(muted ? "host.mute" : "host.unmute");
    lastMuted = muted;
  };
  const syncPlaying = () => {
    const playing = !media.paused && !media.ended;
    toggles.forEach((toggle) => {
      toggle.textContent = playing ? "\u275a\u275a" : "\u25b6";
      toggle.setAttribute("aria-label", playing ? "Pause" : "Play");
    });
    if (playing) showControls();
  };

  listen(media, "loadstart", () => player.send("host.load"));
  listen(media, "loadedmetadata", () => {
    syncTime();
    syncBuffered();
    syncVolume();
    player.send("host.ready");
  });
  listen(media, "playing", () => {
    player.send("host.play");
    syncPlaying();
  });
  listen(media, "pause", () => {
    if (!media.ended) player.send("host.pause");
    syncPlaying();
    showControls();
  });
  listen(media, "waiting", () => player.send("host.buffering"));
  listen(media, "canplay", () => player.send(media.paused ? "host.pause" : "host.play"));
  listen(media, "ended", () => {
    player.send("host.ended");
    syncPlaying();
    showControls();
  });
  listen(media, "error", () => player.send("host.error"));
  listen(media, "timeupdate", syncTime);
  listen(media, "durationchange", syncTime);
  listen(media, "progress", syncBuffered);
  listen(media, "volumechange", syncVolume);
  listen(shell, "pointermove", showControls);
  listen(shell, "focusin", showControls);

  toggles.forEach((toggle) =>
    listen(toggle, "click", async () => {
      showControls();
      try {
        if (media.paused || media.ended) await media.play();
        else media.pause();
      } catch {
        player.send("host.error");
      }
    }),
  );
  listen(seek, "input", () => {
    media.currentTime = Number(seek.value);
    syncTime();
  });
  listen(seek, "pointerdown", () => player.send("host.scrub-start"));
  for (const event of ["pointerup", "pointercancel", "change"]) listen(seek, event, () => player.send("host.scrub-end"));
  listen(root.querySelector(".media-stop"), "click", () => {
    media.pause();
    media.currentTime = 0;
    syncTime();
    syncPlaying();
    showControls();
    player.send("host.stop");
  });
  listen(volume, "input", () => {
    media.volume = Number(volume.value);
    media.muted = false;
  });
  listen(mute, "click", () => (media.muted = !media.muted));
  listen(rate, "change", () => (media.playbackRate = Number(rate.value)));
  listen(root.querySelector(".media-back"), "click", () => (media.currentTime = Math.max(0, media.currentTime - 10)));
  listen(root.querySelector(".media-forward"), "click", () => (media.currentTime = Math.min(media.duration || Infinity, media.currentTime + 10)));
  listen(repeat, "click", () => {
    media.loop = !media.loop;
    repeat.setAttribute("aria-pressed", String(media.loop));
    player.send(media.loop ? "host.repeat-on" : "host.repeat-off");
  });
  listen(root.querySelector(".media-fullscreen"), "click", async () => {
    try {
      await shell?.requestFullscreen?.();
    } catch {
      // Fullscreen can be unavailable in an embedded or permission-limited host.
    }
  });
  listen(root.querySelector(".media-pip"), "click", async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture?.();
      else await media.requestPictureInPicture?.();
    } catch {
      // Picture in Picture is optional and may be denied by the host.
    }
  });
  if (autoHide) listen(document, "visibilitychange", () => player.send(document.hidden ? "host.suspend" : "host.resume"));

  syncTime();
  syncBuffered();
  syncVolume();
  syncPlaying();
  if (media.readyState >= 1) player.send("host.ready");

  return {
    dispose() {
      listeners.splice(0).forEach((remove) => remove());
      media.pause();
    },
  };
}
