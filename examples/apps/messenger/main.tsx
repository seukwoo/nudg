// A messenger built on nudg: the chat list, a chat, and the motion between them. The app
// owns the data and says when things happen; every motion is a nudg file.

import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useNudg } from "@nudg/core/react";
import stackNavigation from "../../stack-navigation.nudg.json";
import toastFile from "../../toast.nudg.json";
import { CHATS, newId, now, type Chat } from "./data.ts";
import { ChatList } from "./chat-list.tsx";
import { ChatScreen } from "./chat.tsx";

function App() {
  const [chats, setChats] = useState(CHATS);
  const [openId, setOpenId] = useState<string>();
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  // The list slides under the chat; the chat leaves the page once it has slid out.
  const stack = useNudg(stackNavigation, { onSettle: (s) => s.includes("root") && setOpenId(undefined) });
  const toast = useNudg(toastFile);

  const update = (id: string, fn: (chat: Chat) => Chat) => setChats((all) => all.map((c) => (c.id === id ? fn(c) : c)));
  const open = (id: string) => {
    setOpenId(id);
    update(id, (c) => ({ ...c, unread: 0 }));
    stack.send("host.push");
  };

  // The other side answers: typing for a moment, then a message.
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const answer = (chat: Chat) => {
    const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    later(600, () => setTyping((t) => ({ ...t, [chat.id]: true })));
    later(2200, () => setTyping((t) => ({ ...t, [chat.id]: false })));
    later(2500, () =>
      update(chat.id, (c) => {
        const [text, ...rest] = c.replies;
        return text ? { ...c, replies: [...rest, text], messages: [...c.messages, { id: newId(), from: "them", text, time: now(), reactions: [], fresh: true }] } : c;
      }),
    );
  };

  const chat = chats.find((c) => c.id === openId);
  return (
    <div className="phone">
      <div ref={stack.bind("previous")} className="screen list-screen">
        <header className="list-header">
          <h1>Chats</h1>
        </header>
        <ChatList
          chats={chats}
          onOpen={open}
          onArchive={(archived) => {
            setChats((all) => all.filter((c) => c.id !== archived.id));
            setNotice(`Archived ${archived.name}`);
            toast.send("host.show");
          }}
        />
      </div>
      <div ref={stack.bind("shade")} className="shade" />
      <div ref={stack.bind("screen")} className="screen chat-screen">
        {chat && (
          <ChatScreen
            chat={chat}
            typing={!!typing[chat.id]}
            backRef={stack.bind("back")}
            onSend={(text, replyTo) => {
              update(chat.id, (c) => ({ ...c, messages: [...c.messages, { id: newId(), from: "me", text, time: now(), reactions: [], replyTo, fresh: true }] }));
              answer(chat);
            }}
            onSendClip={(kind, clip, replyTo) => {
              const text = kind === "voice" ? "Voice message" : "Video message";
              update(chat.id, (c) => ({ ...c, messages: [...c.messages, { id: newId(), from: "me", text, [kind]: clip, time: now(), reactions: [], replyTo, fresh: true }] }));
              answer(chat);
            }}
            onReact={(id, emoji) =>
              update(chat.id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? { ...m, reactions: m.reactions.includes(emoji) ? m.reactions : [...m.reactions, emoji] } : m)) }))
            }
          />
        )}
      </div>
      <div ref={toast.bind("toast")} className="toast" role="status">
        {notice}
      </div>
    </div>
  );
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
