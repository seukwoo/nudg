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
import { REACTIONS, type Chat, type Message } from "./data.ts";
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
        <div ref={bubbleRef} className="bubble">
          {quoted && <div className="quote">{quoted.text}</div>}
          <span>{message.text}</span>
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

function Composer({ replyTo, onCancelReply, onSend }: { replyTo?: Message; onCancelReply: () => void; onSend: (text: string) => void }) {
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
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {replyTo && <ReplyBar text={replyTo.text} onCancel={onCancelReply} />}
      <div className="composer-row">
        <input ref={input} value={text} onChange={(e) => change(e.target.value)} placeholder="Message" aria-label="Message" />
        <div className="composer-action">
          <button ref={c.bind("mic")} type="button" aria-label="Record a voice message" tabIndex={text ? -1 : 0}>
            <MicIcon />
          </button>
          <button ref={c.bind("send")} type="submit" aria-label="Send" tabIndex={text ? 0 : -1}>
            <SendIcon />
          </button>
        </div>
      </div>
    </form>
  );
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
