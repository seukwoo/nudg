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

Two patterns repeat. A component that needs a height to open and close is put inside a row of the animated list, so two small files compose instead of one file growing. And the app learns what the person did from the state a file enters (`useEntered` in [use-entered.ts](use-entered.ts)), so the gesture's thresholds stay in the file.

Next: voice messages (hold to record, slide to cancel, slide up to lock), then calls.
