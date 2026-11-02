// Made-up chats for the example. Nothing here moves; the motion is in ./motion and ../../.

export interface Message {
  id: string;
  from: "me" | "them";
  text: string;
  time: string;
  reactions: string[];
  /** The message this one answers, by id. */
  replyTo?: string;
  /** Arrived while the chat was open: it animates in instead of being there already. */
  fresh?: boolean;
}

export interface Chat {
  id: string;
  name: string;
  color: string;
  unread: number;
  messages: Message[];
  /** What the other side says next, in turn, when you write to them. */
  replies: string[];
}

let next = 0;
export const newId = () => `m${++next}`;

const m = (from: Message["from"], text: string, time: string): Message => ({ id: newId(), from, text, time, reactions: [] });

export const CHATS: Chat[] = [
  {
    id: "mina",
    name: "Mina Park",
    color: "#e0794f",
    unread: 2,
    messages: [
      m("them", "Morning! Did you see the photos from Saturday?", "09:12"),
      m("me", "Yes, the one on the ridge is amazing", "09:20"),
      m("them", "Sora took that one", "09:21"),
      m("me", "Tell her to send the full size", "09:21"),
      m("them", "Will do", "09:22"),
      m("them", "Are you free for lunch?", "11:48"),
      m("me", "Can't today, deadline 😩", "11:55"),
      m("them", "Next week then", "11:56"),
      m("me", "Deal", "11:56"),
      m("them", "How did the deadline go?", "16:30"),
      m("me", "Shipped it, finally", "16:41"),
      m("them", "🎉🎉", "16:41"),
      m("me", "I need to climb something", "16:42"),
      m("them", "Are we still on for climbing tonight?", "18:02"),
      m("me", "Yes! 7 at the usual place", "18:04"),
      m("them", "Perfect. I'll bring the new rope", "18:05"),
      m("me", "The orange one? It's so stiff", "18:05"),
      m("them", "It softens up, trust me", "18:06"),
      m("them", "Also, Leo might join", "18:06"),
    ],
    replies: ["Great, see you there 🙌", "Haha fair", "Leo says hi btw", "Okay, leaving now"],
  },
  {
    id: "climbing",
    name: "Climbing club",
    color: "#4f8a5b",
    unread: 5,
    messages: [
      m("them", "Wall reset is done, new routes on the left side", "15:40"),
      m("them", "Please don't use the blue holds yet, the bolts need a day", "15:41"),
      m("me", "Thanks for the heads up", "16:10"),
    ],
    replies: ["👍", "Noted!", "The overhang one is brutal"],
  },
  {
    id: "leo",
    name: "Leo",
    color: "#5b6bd6",
    unread: 0,
    messages: [m("me", "Did you finish the slides?", "Tue"), m("them", "Almost, sending tonight", "Tue")],
    replies: ["Sent!", "Check your inbox", "Sorry, one more fix"],
  },
  {
    id: "dad",
    name: "Dad",
    color: "#b0568f",
    unread: 0,
    messages: [m("them", "Call me when you're free", "Mon"), m("me", "Will do after work", "Mon")],
    replies: ["Okay 👍", "Love you", "Don't forget Sunday"],
  },
  {
    id: "sora",
    name: "Sora",
    color: "#2f8fa3",
    unread: 0,
    messages: [m("them", "That ramen place was amazing", "Sun"), m("me", "We have to go back", "Sun")],
    replies: ["Next Friday?", "I'm in", "Bring Mina too"],
  },
];

export const REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

export const now = () => new Date().toTimeString().slice(0, 5);
