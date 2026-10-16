# Changelog

## 0.1.1

- Built against `@gang-of-beads/pi-web-plugin-api`, the plugin contract package PI WEB publishes for plugin repositories, instead of the whole PI WEB package. Only the build changed: the published plugin code is the same as 0.1.0's.

## 0.1.0

- First release. The Subagents plugin moves out of PI WEB's bundled plugins into this repository, unchanged in behaviour: the Subagents tab, the supervisor-request card, the notice rows, and the background-work count. The plugin id stays `subagents`, so an existing `plugins.subagents` setting keeps applying.
- Published to npm: install with `pi install npm:@gang-of-beads/pi-web-subagents`.
