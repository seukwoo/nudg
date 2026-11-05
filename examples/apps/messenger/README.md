# Messenger

A messenger whose every motion is a nudg file. The app (React) keeps the chats and says when things happen and how far a value is; the files say how everything moves. There are no durations, springs or transforms in the app code.

Try it on the [demo site](https://seukwoo.github.io/nudg/examples/apps/messenger/), or locally:

```sh
npm run messenger   # bundles app.js with esbuild
npm run demo        # then open http://127.0.0.1:8787/examples/apps/messenger/
```

## What moves, and which file moves it

| Interaction | File | The app's part |
|---|---|---|
| Open a chat, swipe back | [stack-navigation](../../stack-navigation.nudg.json) | `host.push`; drops the chat once it settles back in `root` |
| Swipe a chat left to archive | [swipe-row](../../swipe-row.nudg.json) inside a row of [animated-list](../../animated-list.nudg.json) | sends `host.remove` to the row when the swipe enters `deleted`, and removes the chat when the row exits |
| "Archived" notice | [toast](../../toast.nudg.json) | `host.show` |
| A new message rises in | [bubble](motion/bubble.nudg.json) | `host.insert` for messages that arrive while the chat is open |
| Swipe a message left to reply | [bubble](motion/bubble.nudg.json) | starts a reply when the message enters `swipe/replied` |
| Hold a message to react | [bubble](motion/bubble.nudg.json), [reactions](motion/reactions.nudg.json) | opens the picker when the message enters `hold/held`, sends `host.release` back when the picker closes |
| Typing… | [typing-indicator](../../typing-indicator.nudg.json) inside a row of [animated-list](../../animated-list.nudg.json) | `host.typing` / `host.idle`, `host.insert` / `host.remove` |
| Microphone turns into send | [composer](motion/composer.nudg.json) | `host.typed` / `host.cleared` as the field fills and empties |
| Jump to the latest message | [jump](motion/jump.nudg.json) | reports `host.fromBottom` on scroll |
| Hold to record, slide left to cancel, slide up to lock | [recorder](motion/recorder.nudg.json) | records while the recorder is in `recording` or `locked`, sends on entering `sent`, discards on `cancelled`; reports `host.volume` and, for video, `host.progress` |
| Tap the microphone to switch to round video | [recorder](motion/recorder.nudg.json) | sends `host.toggle` when the recorder enters `tapped` |
| Play a voice message | [voice](motion/voice.nudg.json) | plays and pauses as the file enters `playing` and `paused`; reports `host.progress`, sends `host.ended` |
| Play a round video message | [round](motion/round.nudg.json) | the same, for the video |

## How the code works

Every component in the app follows the same three steps. The voice message (`Voice` and `usePlayback` in [chat.tsx](chat.tsx)) shows all of them; the snippets below are trimmed from there.

**1. Load a file and bind elements to its targets.** The file names the targets (`toggle`, `play`, `pause`, `fill`, …); the app puts those names on its own elements.

```tsx
const v = useNudg(voiceFile);

<button ref={v.bind("toggle")} className="voice-toggle">
  <span ref={v.bind("play")}><PlayIcon /></span>
  <span ref={v.bind("pause")}><PauseIcon /></span>
</button>
<div ref={v.bind("fill")} className="wave-fill" />
```

**2. Tell the file what happened, and how far a value is.** Events (`host.ended`) move it between states; inputs (`host.progress`) drive values that follow them, like the waveform's fill.

```tsx
playback(clip, audio, (p) => v.input("host.progress", p), () => v.send("host.ended"));
```

The tap on `toggle` needs no code: the file handles it and moves from `paused` to `playing`.

**3. Learn what the person did from the state the file is in.** The tap, the hold and the thresholds stay in the file; the app only acts on the result.

```tsx
const playing = v.state.includes("playback/playing");
useEffect(() => {
  if (playing) player.play();
  else player.pause();
}, [playing]);
```

Where only the moment of entering a state matters (a swipe that ends in `replied`, a recording that ends in `sent`), `useEntered(n.state, "swipe/replied", fn)` from [use-entered.ts](use-entered.ts) calls `fn` once.

The recorder is the same, at a larger size: [motion/recorder.nudg.json](motion/recorder.nudg.json) decides between a tap and a hold, follows the finger, and knows the cancel and lock points; `useRecorder` in [chat.tsx](chat.tsx) records while the file is in `recording` or `locked`, and sends or discards on `sent` and `cancelled`.

One more pattern repeats. A component that needs a height to open and close is put inside a row of the animated list, so two small files compose instead of one file growing.

## Microphone and camera

The first press on the microphone asks the browser for it (and for the camera, in video mode), so the prompt comes up at once; that press records nothing. Where the browser can't or won't give them (no device, blocked in the site or system settings, a page without https), the app says so over the composer and records along a stand-in: a made-up level and a silent clock, so every gesture still works. [media.ts](media.ts) holds that part; it moves nothing.

Next: calls.
