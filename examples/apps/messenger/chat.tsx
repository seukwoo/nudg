// One open chat: the header, the messages, the typing bubble, the jump-to-latest button,
// the reaction picker and the composer. Each moving part is a nudg file; this code only
// says when (events) and how far (inputs), and keeps the data.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNudg } from "@nudg/core/react";
import animatedList from "../../animated-list.nudg.json";
import typingIndicator from "../../typing-indicator.nudg.json";
import bubbleFile from "./motion/bubble.nudg.json";
import reactionsFile from "./motion/reactions.nudg.json";
import composerFile from "./motion/composer.nudg.json";
import jumpFile from "./motion/jump.nudg.json";
import recorderFile from "./motion/recorder.nudg.json";
import voiceFile from "./motion/voice.nudg.json";
import roundFile from "./motion/round.nudg.json";
import { REACTIONS, type Chat, type Message } from "./data.ts";
import { clock, closeDevices, openDevices, playback, record, wakeAudio, type Clip, type Devices, type Recording } from "./media.ts";
import { Avatar } from "./avatar.tsx";
import { useEntered } from "./use-entered.ts";

/** A message the reaction picker is open over: where it is, and how to tell it the picker closed. */
interface Held {
  id: string;
  rect: DOMRect;
  release: () => void;
}

export function ChatScreen(props: {
  chat: Chat;
  typing: boolean;
  backRef: (el: Element | null) => void;
  onSend: (text: string, replyTo?: string) => void;
  onSendClip: (kind: "voice" | "video", clip: Clip, replyTo?: string) => void;
  onReact: (id: string, emoji: string) => void;
}) {
  const { chat, typing } = props;
  const [replyTo, setReplyTo] = useState<Message>();
  const [held, setHeld] = useState<Held>();
  const screen = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const jump = useNudg(jumpFile);

  const fromBottom = () => {
    const s = scroller.current;
    return s ? s.scrollHeight - s.clientHeight - s.scrollTop : 0;
  };
  // The newest message stays in view unless the reader has scrolled up to read.
  const follow = useRef(true);
  useLayoutEffect(() => {
    const s = scroller.current;
    if (s && follow.current) s.scrollTop = s.scrollHeight;
  });
  const onScroll = () => {
    follow.current = fromBottom() < 80;
    jump.input("host.fromBottom", fromBottom());
  };
  // Rows grow after they mount, so keep up with them while following.
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const observer = new ResizeObserver(() => follow.current && (s.scrollTop = s.scrollHeight));
    for (const child of s.children) observer.observe(child);
    return () => observer.disconnect();
  });

  const byId = new Map(chat.messages.map((m) => [m.id, m]));
  return (
    <div className="chat" ref={screen}>
      <header className="chat-header">
        <button ref={props.backRef} className="back" type="button" aria-label="Back to chats">
          ‹
        </button>
        <Avatar name={chat.name} color={chat.color} small />
        <div>
          <strong>{chat.name}</strong>
          <div className="status">{typing ? "typing…" : "online"}</div>
        </div>
      </header>
      <div className="messages" ref={scroller} onScroll={onScroll}>
        <div className="messages-inner">
          {chat.messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              quoted={m.replyTo ? byId.get(m.replyTo) : undefined}
              onReply={setReplyTo}
              onHold={(rect, release) => setHeld({ id: m.id, rect, release })}
            />
          ))}
          <Typing active={typing} />
        </div>
      </div>
      <button
        ref={jump.bind("jump")}
        className="jump"
        type="button"
        aria-label="Jump to the latest message"
        onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
      >
        ↓
      </button>
      <Composer
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(undefined)}
        onSend={(text) => {
          follow.current = true;
          props.onSend(text, replyTo?.id);
          setReplyTo(undefined);
        }}
        onSendClip={(kind, clip) => {
          follow.current = true;
          props.onSendClip(kind, clip, replyTo?.id);
          setReplyTo(undefined);
        }}
      />
      <Reactions
        held={held}
        screen={screen}
        onPick={(emoji) => held && props.onReact(held.id, emoji)}
        onClosed={() => {
          held?.release();
          setHeld(undefined);
        }}
      />
    </div>
  );
}

function MessageRow({ message, quoted, onReply, onHold }: { message: Message; quoted?: Message; onReply: (m: Message) => void; onHold: (rect: DOMRect, release: () => void) => void }) {
  // Messages that were already there start shown; a fresh one opens its row on insert.
  const n = useNudg(bubbleFile, { state: message.fresh ? undefined : ["presence/shown", "swipe/rest", "hold/idle"] });
  const bubble = useRef<Element | null>(null);
  const bindBubble = n.bind("bubble");
  const bubbleRef = useCallback((el: Element | null) => {
    bubble.current = el;
    bindBubble(el);
  }, [bindBubble]);
  useEffect(() => {
    if (message.fresh) n.send("host.insert");
  }, []);
  useEntered(n.state, "swipe/replied", () => onReply(message));
  useEntered(n.state, "hold/held", () => bubble.current && onHold(bubble.current.getBoundingClientRect(), () => n.send("host.release")));

  return (
    <div ref={n.bind("row")} className={`row ${message.from}`}>
      <div className="row-inner">
        <div ref={bubbleRef} className={message.video ? "bubble round-bubble" : "bubble"}>
          {quoted && <div className="quote">{quoted.text}</div>}
          {message.voice ? <Voice clip={message.voice} unheard={message.from === "them"} /> : message.video ? <Round clip={message.video} /> : <span>{message.text}</span>}
          <time>{message.time}</time>
        </div>
        {message.reactions.length > 0 && <div className="reactions-chip">{message.reactions.join(" ")}</div>}
        <span ref={n.bind("reply")} className="reply-arrow" aria-hidden="true">
          ↩
        </span>
      </div>
    </div>
  );
}

/** Plays a clip while a file is in `playback/playing` (or `playing`), and reports progress back to it. */
function usePlayback(n: { state: string[]; input: (name: string, v: number) => void; send: (e: string) => boolean }, clip: Clip, media: () => HTMLMediaElement | undefined) {
  const player = useRef<ReturnType<typeof playback>>(undefined);
  const get = () =>
    (player.current ??= playback(
      clip,
      media(),
      (p) => n.input("host.progress", p),
      () => n.send("host.ended"),
    ));
  useEffect(() => () => player.current?.destroy(), []);
  const playing = n.state.some((s) => s.endsWith("playing"));
  useEffect(() => {
    if (playing) get().play();
    else player.current?.pause();
  }, [playing]);
  return playing;
}

function Voice({ clip, unheard }: { clip: Clip; unheard: boolean }) {
  const v = useNudg(voiceFile);
  const audio = useRef<HTMLAudioElement>(undefined);
  const playing = usePlayback(v, clip, () => (clip.url ? (audio.current ??= new Audio(clip.url)) : undefined)); // nudg-audit-ignore: plays the recorded message, not feedback
  return (
    <div className="voice">
      <button ref={v.bind("toggle")} className="voice-toggle" type="button" aria-label={playing ? "Pause" : "Play voice message"}>
        <span ref={v.bind("play")}>
          <PlayIcon />
        </span>
        <span ref={v.bind("pause")}>
          <PauseIcon />
        </span>
      </button>
      <div>
        <div ref={v.bind("wave")} className="wave">
          <Bars bars={clip.bars} />
          <div ref={v.bind("fill")} className="wave-fill">
            <Bars bars={clip.bars} />
          </div>
        </div>
        <div className="voice-info">
          {clock(clip.duration, true)}
          {unheard && <span ref={v.bind("unheard")} className="unheard" />}
        </div>
      </div>
    </div>
  );
}

const Bars = ({ bars }: { bars: number[] }) => (
  <div className="bars">
    {bars.map((b, i) => (
      <i key={i} style={{ height: `${Math.round(4 + b * 18)}px` }} />
    ))}
  </div>
);

function Round({ clip }: { clip: Clip }) {
  const r = useNudg(roundFile);
  const video = useRef<HTMLVideoElement>(null);
  const playing = usePlayback(r, clip, () => video.current ?? undefined);
  return (
    <div ref={r.bind("round")} className="round" role="button" tabIndex={0} aria-label={playing ? "Pause video message" : "Play video message"}>
      {clip.url ? <video ref={video} src={clip.url} playsInline /> : <div className="round-stand-in" />}
      <Ring arcR={r.bind("arcR")} arcL={r.bind("arcL")} ring={r.bind("ring")} />
      <span ref={r.bind("badge")} className="round-badge">
        <PlayIcon /> {clock(clip.duration, true)}
      </span>
    </div>
  );
}

/** A ring that fills clockwise: each half turns an arc behind a half-circle clip. */
function Ring({ arcR, arcL, ring }: { arcR: (el: Element | null) => void; arcL: (el: Element | null) => void; ring?: (el: Element | null) => void }) {
  return (
    <div ref={ring} className="ring" aria-hidden="true">
      <div className="half right">
        <div ref={arcR} className="arc" />
      </div>
      <div className="half left">
        <div ref={arcL} className="arc" />
      </div>
    </div>
  );
}

/**
 * The typing bubble from the examples, inside a row of the animated list: the row opens to
 * the bubble's height and closes after it, so the messages below never jump.
 */
function Typing({ active }: { active: boolean }) {
  const [mounted, setMounted] = useState(active);
  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);
  return mounted ? <TypingRow active={active} onGone={() => setMounted(false)} /> : null;
}

function TypingRow({ active, onGone }: { active: boolean; onGone: () => void }) {
  const row = useNudg(animatedList, { exit: "removed", onExit: onGone });
  const dots = useNudg(typingIndicator);
  useEffect(() => {
    if (active) {
      row.send("host.insert");
      dots.send("host.typing");
    } else {
      dots.send("host.idle");
      row.send("host.remove");
    }
  }, [active]);
  return (
    <div ref={row.bind("row")} className="row them">
      <div className="row-inner">
        <div ref={dots.bind("bubble")} className="bubble typing" aria-label="typing">
          <span ref={dots.bind("dot1")} />
          <span ref={dots.bind("dot2")} />
          <span ref={dots.bind("dot3")} />
        </div>
      </div>
    </div>
  );
}

function Reactions({ held, screen, onPick, onClosed }: { held?: Held; screen: RefObject<HTMLDivElement | null>; onPick: (emoji: string) => void; onClosed: () => void }) {
  const r = useNudg(reactionsFile);
  const bar = useRef<HTMLDivElement | null>(null);
  const bindBar = r.bind("bar");
  const barRef = useCallback((el: HTMLDivElement | null) => {
    bar.current = el;
    bindBar(el);
  }, [bindBar]);
  useEffect(() => {
    if (!held) return;
    r.send("host.open");
    bar.current?.focus();
  }, [held]);
  useEntered(r.state, "closed", onClosed);

  const open = r.state.includes("open");
  // Above the bubble, inside the screen.
  const frame = screen.current?.getBoundingClientRect();
  const top = held && frame ? Math.max(64, held.rect.top - frame.top - 60) : 0;
  return (
    <div className="reactions" style={{ pointerEvents: open ? "auto" : "none" }}>
      <div ref={r.bind("scrim")} className="scrim" />
      <div ref={barRef} className="reaction-bar" style={{ top }} tabIndex={-1} role="menu" aria-label="React">
        {REACTIONS.map((emoji, i) => (
          <button key={emoji} ref={r.bind(`r${i + 1}`)} type="button" role="menuitem" onClick={() => onPick(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ replyTo, onCancelReply, onSend, onSendClip }: { replyTo?: Message; onCancelReply: () => void; onSend: (text: string) => void; onSendClip: (kind: "voice" | "video", clip: Clip) => void }) {
  const [text, setText] = useState("");
  const c = useNudg(composerFile);
  const input = useRef<HTMLInputElement>(null);
  const change = (value: string) => {
    if (!text && value) c.send("host.typed");
    if (text && !value) c.send("host.cleared");
    setText(value);
  };
  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    change("");
  };
  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);
  const rec = useRecorder(onSendClip);
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {replyTo && <ReplyBar text={replyTo.text} onCancel={onCancelReply} />}
      <p className="record-notice" role="status" hidden={!rec.notice || !!text}>
        {rec.notice}
      </p>
      <div className="composer-row">
        <input ref={input} value={text} onChange={(e) => change(e.target.value)} placeholder="Message" aria-label="Message" />
        <div ref={rec.n.bind("panel")} className="record-panel" aria-hidden={!rec.active}>
          <span ref={rec.n.bind("dot")} className="record-dot" />
          <span className="record-time">{clock(rec.elapsed)}</span>
          <span ref={rec.n.bind("hint")} className="record-hint">
            <span ref={rec.n.bind("slide")}>‹ Slide to cancel</span>
          </span>
          <button ref={rec.n.bind("stop")} className="record-stop" type="button" tabIndex={rec.locked ? 0 : -1} style={{ pointerEvents: rec.locked ? "auto" : "none" }}>
            Cancel
          </button>
        </div>
        <div className="composer-action">
          <button ref={c.bind("mic")} type="button" tabIndex={-1} aria-hidden="true">
            <span ref={rec.n.bind("micIcon")} className="mode-icon">
              <MicIcon />
            </span>
            <span ref={rec.n.bind("camIcon")} className="mode-icon">
              <CameraIcon />
            </span>
          </button>
          <button ref={c.bind("send")} type="submit" aria-label="Send" tabIndex={text ? 0 : -1}>
            <SendIcon />
          </button>
          <div ref={rec.n.bind("lock")} className="lock" aria-hidden="true">
            <LockIcon />
            <span ref={rec.n.bind("lockArrow")}>⌃</span>
          </div>
          <div ref={rec.n.bind("blob")} className="blob" aria-hidden="true">
            <div ref={rec.n.bind("halo")} className="halo" />
            <span ref={rec.n.bind("blobIcon")} className="blob-icon">
              {rec.video ? <CameraIcon /> : <MicIcon />}
            </span>
            <span ref={rec.n.bind("blobSend")} className="blob-icon">
              <SendIcon />
            </span>
          </div>
          <button
            ref={rec.n.bind("mic")}
            className="record-hit"
            type="button"
            // The press asks for the devices, and is the gesture Safari needs before the level meter can hear.
            onPointerDown={rec.open}
            onKeyDown={(e) => e.key === "Enter" && rec.open()}
            hidden={!!text}
            title={rec.locked ? "Tap to send" : `Hold to record, tap for ${rec.video ? "voice" : "video"}`}
            aria-label={rec.locked ? "Send the recording" : `Hold to record a ${rec.video ? "video" : "voice"} message, tap to switch to ${rec.video ? "voice" : "video"}; Enter records hands-free`}
          />
        </div>
      </div>
      <div ref={rec.n.bind("round")} className="record-round" aria-hidden="true" style={{ visibility: rec.video ? "visible" : "hidden" }}>
        {rec.stream ? <video
            ref={(el) => {
              if (el && el.srcObject !== rec.stream) el.srcObject = rec.stream ?? null;
            }}
            autoPlay
            muted
            playsInline
          /> : <div className="round-stand-in" />}
        <Ring arcR={rec.n.bind("arcR")} arcL={rec.n.bind("arcL")} />
      </div>
    </form>
  );
}

/**
 * The recorder file drives the gesture; this records while it is in recording or locked, and
 * keeps or drops the recording as it enters sent or cancelled. The devices are asked for on the
 * press, so a browser's permission prompt comes up at once; a press that let go before they were
 * ready (the person was answering the prompt) records nothing.
 */
function useRecorder(onSendClip: (kind: "voice" | "video", clip: Clip) => void) {
  const n = useNudg(recorderFile);
  const video = n.state.includes("mode/video");
  const [elapsed, setElapsed] = useState(0);
  const [stream, setStream] = useState<MediaStream>();
  const [notice, setNotice] = useState<string>();
  const press = useRef<{ devices: Promise<Devices>; video: boolean; started: boolean; recording?: Recording; frame: number }>(undefined);

  /** On the press: wake the audio and ask for the devices. A tap that sends a locked recording keeps the press it has. */
  const open = () => {
    wakeAudio();
    if (press.current) return;
    press.current = { devices: openDevices(video), video, started: false, frame: 0 };
  };
  /** The press became a tap or was cancelled before recording. */
  const drop = () => {
    const p = press.current;
    if (!p || p.started) return;
    press.current = undefined;
    void p.devices.then(closeDevices);
  };
  const start = () => {
    if (!press.current) open();
    const p = press.current!;
    if (p.started) return;
    p.started = true;
    setElapsed(0);
    void p.devices.then((devices) => {
      if (press.current !== p) return;
      const r = record(devices);
      p.recording = r;
      setNotice(devices.problem);
      setStream(devices.stream);
      const tick = () => {
        n.input("host.volume", r.level());
        if (p.video) n.input("host.progress", r.elapsed() / 60);
        setElapsed(r.elapsed());
        p.frame = requestAnimationFrame(tick);
      };
      tick();
    });
  };
  const finish = (keep: boolean) => {
    const p = press.current;
    if (!p) return;
    press.current = undefined;
    void p.devices.then(async (devices) => {
      const r = p.recording;
      if (!r) {
        // Let go before the devices were ready: nothing was recorded.
        closeDevices(devices);
        if (keep) setNotice(devices.problem ?? "Ready. Hold to record.");
        return;
      }
      cancelAnimationFrame(p.frame);
      n.input("host.volume", 0);
      n.input("host.progress", 0);
      setStream(undefined);
      if (keep) onSendClip(p.video ? "video" : "voice", await r.stop());
      else r.cancel();
    });
  };
  useEntered(n.state, "record/tapped", () => {
    drop();
    n.send("host.toggle");
    setNotice(video ? "Voice message: hold to record, tap for video." : "Round video: hold to record, tap for voice.");
  });
  useEntered(n.state, "record/idle", drop);
  useEntered(n.state, "record/recording", start);
  useEntered(n.state, "record/locked", start);
  useEntered(n.state, "record/sent", () => finish(true));
  useEntered(n.state, "record/cancelled", () => finish(false));
  useEffect(() => () => finish(false), []);

  const active = n.state.includes("record/recording") || n.state.includes("record/locked");
  return { n, video, elapsed, stream, active, locked: n.state.includes("record/locked"), open, notice, setNotice };
}

function ReplyBar({ text, onCancel }: { text: string; onCancel: () => void }): ReactNode {
  return (
    <div className="reply-bar">
      <div>
        <strong>Reply</strong>
        <div className="reply-text">{text}</div>
      </div>
      <button type="button" aria-label="Cancel reply" onClick={onCancel}>
        ×
      </button>
    </div>
  );
}

const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12Z" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2Z" />
  </svg>
);

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="currentColor" d="M4 6h11a2 2 0 0 1 2 2v1.5l4-2.5v10l-4-2.5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="currentColor" d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Zm2 0h6V8a3 3 0 0 0-6 0Z" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="currentColor" d="M7 4.5v15l13-7.5Z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="currentColor" d="M6 4h4v16H6Zm8 0h4v16h-4Z" />
  </svg>
);
