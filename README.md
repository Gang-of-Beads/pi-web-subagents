# pi-web-subagents

A [PI WEB](https://github.com/Gang-of-Beads/pi-web) plugin for [pi-subagents](https://github.com/Gang-of-Beads/pi-subagents), the extension behind the `subagent` tool.

- A **Subagents** tab beside the conversation lists the runs the open session started, with each run's state and its output; its badge counts the running ones. The tab shows only where the extension is loaded.
- When a child asks its supervisor a question (`subagent_supervisor_request`), the conversation shows a card to answer it: send the reply as a message, or put it in the composer to edit first. Once you have answered, the card says so.
- Subagent notices (finished, steered, controlled, resumed after compaction, supervisor replies) are drawn as short rows instead of raw payloads.
- While a session has a running child, the plugin reports it to PI WEB as background work: it counts toward the session's background runs, and open panels refresh when the last run ends.

## Requirements

- PI WEB 2.202610.5 or later. Earlier releases bundle their own copy of this plugin, which wins over an installed one (Settings → PI WEB plugins reports the duplicate id).
- The pi-subagents extension installed in pi.

## Install

```sh
pi install npm:@gang-of-beads/pi-web-subagents
```

To follow `main` instead of releases, install `git:github.com/Gang-of-Beads/pi-web-subagents`.

The plugin has a server part, so restart the PI WEB session daemon, then reload the PI WEB tab. To remove it, run `pi remove npm:@gang-of-beads/pi-web-subagents` and restart the daemon again.

## How it works

The server part runs inside the PI WEB session daemon and only reads. A run is found from the files the subagent tool leaves next to the parent session's transcript (`<session dir>/<parent session id>/<run id>/…` while it runs, `subagent-artifacts/` when it is done), so a run belongs to the session whose directory holds it. It answers the browser's `runs.list` and `runs.output` operations and reports how many runs are still going. The browser part polls while the tab is on screen and draws the tab, the card and the notice rows.

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
