import { basename, dirname } from "node:path";
import type { JsonValue, PiWebServerPlugin } from "@gang-of-beads/pi-web-plugin-api/server-plugin-api";
import { isSafeRunId, listSubagentRuns, readSubagentRunOutput, type SubagentRunInfo } from "./server/runs.js";
import { readRunConversation, readRunDetail } from "./server/runDetail.js";

/**
 * Subagents' server half.
 *
 * The runs a session started are read here, from the layout the subagent tool
 * leaves on disk, so the whole feature - the reader, the operations and the
 * panel - ships in one plugin. The shell learns nothing about runs; it only
 * mounts what this plugin declares.
 *
 * The parent session is named by its transcript path, which the browser
 * already holds: a run belongs to the session whose directory contains it,
 * and attribution is by that recorded fact rather than by timing.
 */

function sessionFileFrom(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path: unknown = Reflect.get(input, "sessionFile");
  return typeof path === "string" && path.endsWith(".jsonl") ? path : undefined;
}

/** The session and run an opened row asks about, or the refusal for the first one that is not well-formed. */
function runRequestFrom(input: unknown): { sessionFile: string; runId: string } | "no-session" | "no-run" {
  const sessionFile = sessionFileFrom(input);
  if (sessionFile === undefined) return "no-session";
  const runId: unknown = typeof input === "object" && input !== null ? Reflect.get(input, "runId") : undefined;
  return typeof runId !== "string" || !isSafeRunId(runId) ? "no-run" : { sessionFile, runId };
}

function runsAsJson(runs: readonly SubagentRunInfo[]): JsonValue {
  return runs.map((run) => ({
    runId: run.runId,
    agent: run.agent,
    status: run.status,
    ...(run.error === undefined ? {} : { error: run.error }),
    elapsedMs: run.elapsedMs,
    startedAt: run.startedAt,
    ...(run.lastActivity === undefined ? {} : { lastActivity: run.lastActivity }),
    ...(run.lastActivityAt === undefined ? {} : { lastActivityAt: run.lastActivityAt }),
    ...(run.task === undefined ? {} : { task: run.task }),
    ...(run.model === undefined ? {} : { model: run.model }),
    ...(run.toolCount === undefined ? {} : { toolCount: run.toolCount }),
    hasOutput: run.hasOutput,
    ...(run.toolRunId === undefined ? {} : { toolRunId: run.toolRunId }),
    ...(run.control === undefined ? {} : { control: run.control }),
  }));
}

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Subagents",
  activate: () => ({
    agentFacts: {
      surfaces: [{ surface: "subagents", tools: ["subagent"] }],
      workPaths: [{ root: "session-dir", path: "subagent-artifacts" }, { root: "session-stem", path: "" }],
    },
    backgroundWork: async (session) => {
      const runs = await listSubagentRuns(dirname(session.sessionFile), basename(session.sessionFile, ".jsonl"), Date.now(), { parentActive: session.parentActive });
      return { running: runs.filter((run) => run.status === "running").length };
    },
    operations: {
      "runs.list": async (input): Promise<JsonValue> => {
        const sessionFile = sessionFileFrom(input);
        // Absence is a state: without a session path there is nothing to read,
        // and saying so is not the same as reporting no runs.
        if (sessionFile === undefined) return { known: false, reason: "no-session" };
        const runs = await listSubagentRuns(dirname(sessionFile), basename(sessionFile, ".jsonl"), Date.now());
        return { known: true, runs: runsAsJson(runs) };
      },
      "runs.output": async (input): Promise<JsonValue> => {
        const sessionFile = sessionFileFrom(input);
        const runId: unknown = typeof input === "object" && input !== null ? Reflect.get(input, "runId") : undefined;
        if (sessionFile === undefined || typeof runId !== "string" || runId === "") return { known: false, reason: "no-run" };
        const output = await readSubagentRunOutput(dirname(sessionFile), runId, { parentSessionId: basename(sessionFile, ".jsonl") });
        return output === undefined ? { known: false, reason: "not-written" } : { known: true, output };
      },
      "runs.detail": async (input, { signal }): Promise<JsonValue> => {
        const request = runRequestFrom(input);
        if (typeof request === "string") return { known: false, reason: request };
        const countMessages = typeof input === "object" && input !== null && Reflect.get(input, "countMessages") === true;
        return readRunDetail(dirname(request.sessionFile), basename(request.sessionFile, ".jsonl"), request.runId, countMessages, signal);
      },
      "runs.conversation": async (input, { signal }): Promise<JsonValue> => {
        const request = runRequestFrom(input);
        if (typeof request === "string") return { known: false, reason: request };
        return readRunConversation(dirname(request.sessionFile), basename(request.sessionFile, ".jsonl"), request.runId, signal);
      },
    },
  }),
};

export default plugin;
