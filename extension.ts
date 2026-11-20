/**
 * The pi extension this package also installs.
 *
 * The runtime lives in `@gang-of-beads/pi-subagents`, which is published from its own repository so
 * upstream fixes keep landing there without passing through this one. Re-exporting its factory is
 * enough: pi loads this file, the extension code runs from the dependency, and the agents, skills and
 * prompts are copies kept in step by `scripts/sync-subagents-assets.mjs`.
 */
export { default } from "@gang-of-beads/pi-subagents";
