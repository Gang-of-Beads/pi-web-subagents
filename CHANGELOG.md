# Changelog

## 0.2.1

- Republished: 0.2.0 was accepted by the registry and never appeared.

## 0.2.0

- **This package is now also the pi extension.** `pi.extensions` loads a re-export of `@gang-of-beads/pi-subagents`, which arrives as a dependency, and the runtime's agents, skills and prompts ship as copies kept in step by `npm run check`. One install covers the TUI's `subagent` tool and the Subagents tab; installing both packages loads the extension twice.
- Carries `@gang-of-beads/pi-subagents` 0.89.1 as a vendored tarball (`vendor/`), the Pi 1.5 line, until that version is on npm.

## 0.1.3

- Require plugin API alpha.10; a host without `session.runCommand` now refuses cleanly instead of failing on the type.
- Ship the BSD-3 notice for the Lit the browser bundle inlines.

## 0.1.2

- Every Subagents row opens: the run's task as a bubble, its result as formatted text, the live step while it runs, its facts (tokens as "212 in · 111k out · 18.9M cached") and a **Conversation** row that opens the run's conversation in a dialog, with the reader's messages as bubbles, tool calls as chips and only failed tool output.
- A running run can be steered and stopped from its row, through the extension's own commands. "Stopped from this page." shows only on the device that sent the Stop.
- A finished run's outcome comes from the tool's completion notice to its parent, a workflow child's from the workflow's completion notice, and a running run's elapsed time keeps counting while the tab shows it.
- Built against `@gang-of-beads/pi-web-plugin-api` 0.1.0-alpha.5. The plugin feature-detects every newer host member and keeps working on older PI WEB versions. Restart the session daemon after updating: the plugin's server half runs there.

## 0.1.1

- Built against `@gang-of-beads/pi-web-plugin-api`, the plugin contract package PI WEB publishes for plugin repositories, instead of the whole PI WEB package. Only the build changed: the published plugin code is the same as 0.1.0's.

## 0.1.0

- First release. The Subagents plugin moves out of PI WEB's bundled plugins into this repository, unchanged in behaviour: the Subagents tab, the supervisor-request card, the notice rows, and the background-work count. The plugin id stays `subagents`, so an existing `plugins.subagents` setting keeps applying.
- Published to npm: install with `pi install npm:@gang-of-beads/pi-web-subagents`.
