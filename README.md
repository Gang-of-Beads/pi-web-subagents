# pi-web-subagents

A [PI WEB](https://github.com/Gang-of-Beads/pi-web) plugin for [pi-subagents](https://github.com/Gang-of-Beads/pi-subagents), the extension behind the `subagent` tool.

- A **Subagents** tab beside the conversation lists the runs the open session started, with each run's state and its output; its badge counts the running ones. The tab shows only where the extension is loaded.
- A running row opens to **Steer** (one line of words, sent with the paper plane) with **Stop** at the end of the same line. They send the extension's own commands in the open session, exactly as typing them would: `/subagents-steer <run-id> <words>` and `/subagents-stop <run-id>`, with the id the subagent tool knows the run by. The row's note shows what the extension answered. The extension posts its usual "Running subagent..." card in the conversation for each. A run held inside the current reply (a foreground run) has neither: it stops with the session's Stop. The steer words are dropped when the row closes.
- Every row opens, drawn like a short conversation. The task it was given sits in a tinted bubble, like your own messages. A running row then shows its latest step as a live line with a green dot (the tool it started, or the start of what it last said, with how long ago), above Steer and Stop. A finished row shows the result as formatted text under the task, how it ended when that was not Done (a failed run's error, up to 4 KiB; "Stopped from this page." when this device sent the Stop, otherwise "Stopped."), and one line of facts: model, tokens in, out and cached, cost, turns and duration. Long task and result text opens in place with **Show all**. Each opened row ends in a **Conversation** row with how many messages the run holds ("14 messages so far" while it works, counted when the row opened).
- **Conversation** opens the run's whole conversation full screen, as a chat: the task and any steering in your bubbles, the subagent's text formatted without a bubble, and each tool call as one line saying how it ended (how many lines it returned, failed, or running). Only a failed call's output is shown, under its line, cut to its first 20 lines. The back key returns to the list; a running run's view has a **Refresh** key and says when it was read.
- When a child asks its supervisor a question (`subagent_supervisor_request`), the conversation shows a card to answer it: send the reply as a message, or put it in the composer to edit first. Once you have answered, the card says so.
- Subagent notices (finished, steered, controlled, resumed after compaction, supervisor replies) are drawn as short rows instead of raw payloads.
- While a session has a running child, the plugin reports it to PI WEB as background work: it counts toward the session's background runs, and open panels refresh when the last run ends.

## Requirements

- PI WEB 2.202610.5 or later. Earlier releases bundle their own copy of this plugin, which wins over an installed one (Settings → PI WEB plugins reports the duplicate id).
- Steer and Stop need a PI WEB whose plugin pages can open a row and run the commands a plugin declares (the plugin API's `renderMessageField`, `renderButton` and a workspace page's `session`). Conversation also needs the plugin API's `showDialog` and `renderMarkdownHtml`; without them a row has no Conversation row. On an older PI WEB the rows stay flat, as before; on a PI WEB that draws the row but cannot run the commands, an open row says "Steer and Stop need a newer PI WEB on this machine."
- The pi-subagents extension installed in pi.

## Install

```sh
pi install npm:@gang-of-beads/pi-web-subagents
```

To follow `main` instead of releases, install `git:github.com/Gang-of-Beads/pi-web-subagents`.

The plugin has a server part, so restart the PI WEB session daemon, then reload the PI WEB tab. To remove it, run `pi remove npm:@gang-of-beads/pi-web-subagents` and restart the daemon again.

## How it works

The server part runs inside the PI WEB session daemon and only reads. A run is found from the files the subagent tool leaves next to the parent session's transcript (`<session dir>/<parent session id>/<run id>/…` while it runs, `subagent-artifacts/` when it is done), so a run belongs to the session whose directory holds it. It answers the browser's operations and reports how many runs are still going:

- `runs.list`: the session's runs, polled while the tab is on screen and the session works. A running run's latest step is read from the end of its transcript (the tool's artifact transcript, else the child's own session file) only when the file changed since the last poll.
- `runs.detail`: what an opened row shows, read when it opens: the task (the first user message in the first 128 KiB of the transcript; the tool keeps a redacted copy in `_input.md` and `meta.json`), the first 64 KiB of the result, the facts from `meta.json`, a failed run's error (up to 4 KiB), and, when the request says `countMessages: true` (the page does where it draws a Conversation row), how many messages Conversation would draw from, counted over the same last 8 MiB of the transcript Conversation reads (a longer transcript reads "at least" that many).
- `runs.conversation`: the whole conversation, read when Conversation is pressed: the last 8 MiB of the transcript, answered as the newest turns that fit in 1 MiB, with a line saying how much is shown when that cut anything.
- `runs.output`: a run's result, kept for callers of earlier releases.

`runs.detail` and `runs.conversation` answer only for a run the session's own `runs.list` holds, and open files only by the paths that listing found. For a running run, `runs.list` also carries the tool's own run id (from the child session's name) and whether the tool holds it detached or inside the parent's reply (from the `source` the tool stamps on the run's artifact transcript); when nothing on disk says, that is reported as unknown and the row offers Steer and Stop and lets the extension answer. A finished run's outcome (done, failed with its error, or stopped) is the one the tool reported to the parent in its completion notice (`subagent-notify`, which also links a child that failed before writing its transcript to its run); without one, the run's `meta.json` exit code decides, and a run with neither reads lost or unknown. The browser part polls while the tab is on screen and draws the tab, the card and the notice rows.

## Development

```sh
npm install
npm run check
```

`npm run check` type-checks, runs the tests, and builds two bundles with esbuild: `dist/browser/pi-web-plugin.js` (with Lit inlined) for the page and `dist/server-plugin.js` for the daemon. `dist/` is committed so that `pi install git:` works without a build step, and the check fails when it is out of date.

To try a change in a running PI WEB, link the working copy as a local plugin, restart the session daemon and reload the tab:

```sh
mkdir -p ~/.pi-web/plugins
ln -s "$PWD" ~/.pi-web/plugins/subagents
```

See [PI WEB's plugin documentation](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugins.md) for the plugin contract.

## Contributing

Issues and pull requests are welcome. Please keep changes small and focused, run `npm run check` before opening a pull request, and describe what you changed and how you checked it in a running PI WEB.

## Releasing

Update `version` in `package.json` and `package-lock.json`, give `CHANGELOG.md` a section for it, commit, and push a matching `v<version>` tag. The release workflow checks the package, publishes it to npm, and creates the GitHub Release from that CHANGELOG section.

## License

[MIT](LICENSE)
