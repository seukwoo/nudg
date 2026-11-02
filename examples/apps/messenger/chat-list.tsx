// The chat list. Each row is two players on nested elements: the swipe row from the
// examples (swipe left to archive) inside one row of the animated list, whose height closes
// while the swipe throws the row out.

import { useNudg } from "@nudg/core/react";
import animatedList from "../../animated-list.nudg.json";
import swipeRow from "../../swipe-row.nudg.json";
import type { Chat } from "./data.ts";
import { Avatar } from "./avatar.tsx";
import { useEntered } from "./use-entered.ts";

export function ChatList({ chats, onOpen, onArchive }: { chats: Chat[]; onOpen: (id: string) => void; onArchive: (chat: Chat) => void }) {
  return (
    <ul className="chats">
      {chats.map((chat) => (
        <ChatRow key={chat.id} chat={chat} onOpen={onOpen} onArchive={onArchive} />
      ))}
    </ul>
  );
}

function ChatRow({ chat, onOpen, onArchive }: { chat: Chat; onOpen: (id: string) => void; onArchive: (chat: Chat) => void }) {
  const row = useNudg(animatedList, { state: ["presence/present", "order/rest"], exit: "removed", onExit: () => onArchive(chat) });
  const swipe = useNudg(swipeRow);
  useEntered(swipe.state, "deleted", () => row.send("host.remove"));
  const last = chat.messages.at(-1);
  return (
    <li ref={row.bind("row")} className="chat-row">
      <div ref={swipe.bind("row")} className="swipe">
        <button ref={swipe.bind("action")} className="archive" type="button">
          Archive
        </button>
        <div
          ref={swipe.bind("content")}
          className="chat-content"
          role="button"
          tabIndex={0}
          // A tap on an open row closes it (the file does that); otherwise it opens the chat.
          onClick={() => swipe.state.includes("open") || onOpen(chat.id)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(chat.id)}
        >
          <Avatar name={chat.name} color={chat.color} />
          <div className="chat-text">
            <div className="chat-top">
              <strong>{chat.name}</strong>
              <time>{last?.time}</time>
            </div>
            <div className="chat-bottom">
              <span className="preview">{last ? (last.from === "me" ? `You: ${last.text}` : last.text) : ""}</span>
              {chat.unread > 0 && <span className="unread">{chat.unread}</span>}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
