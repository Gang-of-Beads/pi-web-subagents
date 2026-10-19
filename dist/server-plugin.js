// src/server-plugin.ts
import { basename as basename2, dirname as dirname2 } from "node:path";

// src/server/runs.ts
import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
var RUNNING_STALE_AFTER_MS = 10 * 60 * 1e3;
var PARENT_ACTIVE_STALE_AFTER_MS = 30 * 60 * 1e3;
var SILENT_LAUNCH_GRACE_MS = 5 * 60 * 1e3;
var TAIL_BYTES = 64 * 1024;
var HEAD_BYTES = 8 * 1024;
var OUTPUT_HEAD_BYTES = 8 * 1024;
async function readWindow(path, bytes, edge) {
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    if (length === 0) return "";
    const buffer = Buffer.alloc(length);
    const position = edge === "head" ? 0 : size - length;
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return void 0;
  } finally {
    await handle?.close().catch(() => void 0);
  }
}
async function listSubagentRuns(sessionDir, parentSessionId, now = Date.now(), options = {}) {
  const candidates = await parentRunCandidates(sessionDir, parentSessionId);
  if (candidates.directoryRunIds.length === 0 && candidates.named.size === 0) return [];
  const snapshot = await readArtifactSnapshot(join(sessionDir, "subagent-artifacts"));
  return describeParentRuns(sessionDir, parentSessionId, now, options, candidates, snapshot);
}
async function parentRunCandidates(sessionDir, parentSessionId) {
  const [directoryRunIds, records] = await Promise.all([
    listDirectories(join(sessionDir, parentSessionId)),
    recordsOfParent(join(sessionDir, `${parentSessionId}.jsonl`), parentSessionId)
  ]);
  return { directoryRunIds, named: records.ids, notified: records.notified };
}
async function readArtifactSnapshot(artifactsDir) {
  const names = await listNames(artifactsDir);
  const [artifacts, running] = await Promise.all([
    readArtifacts(artifactsDir, names),
    readRunningArtifacts(artifactsDir, names)
  ]);
  return { artifacts, running };
}
async function describeParentRuns(sessionDir, parentSessionId, now, options, candidates, snapshot) {
  const runsDir = join(sessionDir, parentSessionId);
  const parentActive = options.parentActive === true;
  const { artifacts, running } = snapshot;
  const owned = new Set(candidates.directoryRunIds);
  const runIds = [
    ...candidates.directoryRunIds,
    ...[...candidates.named].filter((runId) => !owned.has(runId) && (running.has(runId) || artifacts.has(runId)))
  ];
  const runs = [];
  const listedToolRunIds = /* @__PURE__ */ new Set();
  for (const runId of runIds) {
    if (listedToolRunIds.has(runId)) continue;
    const run = await describeRun(runsDir, runId, artifacts, running, candidates.notified, now, parentActive);
    if (run === void 0) continue;
    if (run.toolRunId !== void 0) listedToolRunIds.add(run.toolRunId);
    runs.push(run);
  }
  return runs.sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (b.status === "running" && a.status !== "running") return 1;
    return b.startedAt.localeCompare(a.startedAt);
  });
}
var RUN_DIRECTORY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
async function looksLikeRun(runDir, runId, artifacts) {
  if (artifacts.has(runId)) return true;
  const attempts = await listDirectories(runDir);
  if (attempts.some((name) => name.startsWith("run-"))) return true;
  return RUN_DIRECTORY_NAME.test(runId);
}
async function readRunningArtifacts(artifactsDir, names) {
  const running = /* @__PURE__ */ new Map();
  const reported = new Set(names.filter((name) => name.endsWith("_meta.json")).map((name) => name.slice(0, name.indexOf("_"))));
  for (const name of names) {
    if (!name.endsWith("_transcript.jsonl")) continue;
    const runId = name.slice(0, name.indexOf("_"));
    if (runId === "" || reported.has(runId)) continue;
    const path = join(artifactsDir, name);
    const stats = await statOrUndefined(path);
    if (stats === void 0) continue;
    const agent = agentFromArtifactName(name, runId);
    running.set(runId, { ...agent === void 0 ? {} : { agent }, transcriptPath: path, lastWriteMs: stats.mtimeMs });
  }
  return running;
}
function agentFromArtifactName(name, runId) {
  const rest = name.slice(runId.length + 1).replace(/_transcript\.jsonl$/u, "");
  const agent = rest.replace(/_\d+$/u, "");
  return agent === "" ? void 0 : agent;
}
var RUN_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;
async function recordsOfParent(sessionFile, parentSessionId) {
  const stats = await statOrUndefined(sessionFile);
  if (stats === void 0) return { ids: /* @__PURE__ */ new Set(), notified: emptyNotifiedOutcomes() };
  const cached = spawnedRunIdCache.get(sessionFile);
  if (cached !== void 0 && cached.size <= stats.size && cached.mtimeMs === stats.mtimeMs) return cached;
  const from = cached === void 0 || cached.size > stats.size ? 0 : cached.size;
  const fresh = cached === void 0 || from === 0;
  const ids = fresh ? /* @__PURE__ */ new Set() : cached.ids;
  const notified = fresh ? emptyNotifiedOutcomes() : cached.notified;
  const text = await readRange(sessionFile, from, stats.size);
  if (text !== void 0) {
    for (const line of text.split("\n")) {
      collectSpawnedRunIds(line, ids);
      collectNotifiedOutcomes(line, parentSessionId, notified);
    }
  }
  spawnedRunIdCache.set(sessionFile, { size: stats.size, mtimeMs: stats.mtimeMs, ids, notified });
  return { ids, notified };
}
function emptyNotifiedOutcomes() {
  return { byToolRunId: /* @__PURE__ */ new Map(), toolRunIdByDirectory: /* @__PURE__ */ new Map() };
}
var NOTIFIED_STATUS = {
  completed: "done",
  failed: "failed",
  stopped: "stopped"
};
function collectNotifiedOutcomes(line, parentSessionId, notified) {
  if (!line.includes('"subagent-notify"')) return;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(parsed) || parsed["customType"] !== "subagent-notify") return;
  const details = parsed["details"];
  const runs = isRecord(details) ? details["runs"] : void 0;
  if (!Array.isArray(runs)) return;
  for (const run of runs) {
    if (!isRecord(run)) continue;
    const runId = run["runId"];
    const rawStatus = run["status"];
    if (typeof runId !== "string" || runId === "") continue;
    const sessionValue = run["sessionValue"];
    const directory = typeof sessionValue === "string" ? childDirectoryOf(sessionValue, parentSessionId) : void 0;
    if (directory !== void 0) notified.toolRunIdByDirectory.set(directory, runId);
    const status = typeof rawStatus === "string" && Object.hasOwn(NOTIFIED_STATUS, rawStatus) ? NOTIFIED_STATUS[rawStatus] : void 0;
    if (status === void 0) continue;
    const durationMs = run["durationMs"];
    notified.byToolRunId.set(runId, { status, ...typeof durationMs === "number" ? { durationMs } : {} });
  }
}
function childDirectoryOf(sessionFile, parentSessionId) {
  const runDir = dirname(dirname(sessionFile));
  return basename(dirname(runDir)) === parentSessionId && basename(dirname(sessionFile)).startsWith("run-") ? basename(runDir) : void 0;
}
var spawnedRunIdCache = /* @__PURE__ */ new Map();
async function readRange(path, from, to) {
  if (to <= from) return "";
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return void 0;
  } finally {
    await handle?.close().catch(() => void 0);
  }
}
function collectSpawnedRunIds(line, ids) {
  if (!line.includes('"subagent"')) return;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  const message = parsed["message"];
  const content = isRecord(message) ? message["content"] : void 0;
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part["toolName"] !== "subagent" && part["name"] !== "subagent") continue;
    for (const id of JSON.stringify(part).matchAll(RUN_ID_PATTERN)) ids.add(id[0]);
  }
}
async function describeRun(runsDir, runId, artifacts, runningByRunId, notified, now, parentActive) {
  const runDir = join(runsDir, runId);
  const running = runningByRunId.get(runId);
  if (running === void 0 && !await looksLikeRun(runDir, runId, artifacts)) return void 0;
  const transcript = await findTranscript(runDir);
  const identity = transcript === void 0 ? void 0 : await readRunIdentity(transcript);
  const linkedRunId = identity?.runId ?? notified.toolRunIdByDirectory.get(runId);
  const artifact = artifacts.get(linkedRunId ?? runId) ?? artifacts.get(runId);
  const artifactRunId = linkedRunId !== void 0 && artifacts.has(linkedRunId) ? linkedRunId : runId;
  const outcome = notified.byToolRunId.get(linkedRunId ?? runId);
  let startedAt = artifact?.timestamp;
  let lastWriteMs;
  if (transcript !== void 0) {
    const stats = await statOrUndefined(transcript);
    if (stats !== void 0) {
      startedAt ??= stats.birthtime.toISOString();
      lastWriteMs = stats.mtimeMs;
    }
  }
  if (running !== void 0) {
    const stats = await statOrUndefined(running.transcriptPath);
    if (stats !== void 0) startedAt ??= stats.birthtime.toISOString();
    lastWriteMs ??= running.lastWriteMs;
  }
  if (startedAt === void 0) {
    const dirStats = await statOrUndefined(runDir);
    if (dirStats === void 0 && artifact === void 0) return void 0;
    startedAt = (dirStats?.birthtime ?? new Date(now)).toISOString();
  }
  const status = outcome?.status ?? runStatus(artifact, lastWriteMs, Date.parse(startedAt), now, parentActive);
  const agent = artifact?.agent ?? identity?.agent ?? running?.agent ?? "subagent";
  const label = artifact?.task ?? artifact?.outputSummary;
  const elapsedMs = artifact?.durationMs ?? outcome?.durationMs ?? Math.max(0, (lastWriteMs ?? now) - Date.parse(startedAt));
  const error = status === "failed" ? artifact?.error : void 0;
  const lastActivity = status === "running" && transcript !== void 0 ? await lastTranscriptStep(transcript) : void 0;
  const toolRunId = linkedRunId ?? (running === void 0 ? void 0 : runId);
  const control = status === "running" ? await runControl(toolRunId === void 0 ? void 0 : runningByRunId.get(toolRunId)) : void 0;
  return {
    runId: artifactRunId,
    agent,
    status,
    ...error === void 0 ? {} : { error },
    elapsedMs,
    startedAt,
    ...lastActivity === void 0 ? {} : { lastActivity },
    ...label === void 0 ? {} : { task: label },
    ...artifact?.model === void 0 ? {} : { model: artifact.model },
    ...artifact?.toolCount === void 0 ? {} : { toolCount: artifact.toolCount },
    hasOutput: artifact?.hasOutput === true,
    ...toolRunId === void 0 ? {} : { toolRunId },
    ...control === void 0 ? {} : { control }
  };
}
async function runControl(running) {
  if (running === void 0) return "unknown";
  const head = await readWindow(running.transcriptPath, HEAD_BYTES, "head");
  const firstLine = head?.split("\n")[0];
  if (firstLine === void 0 || firstLine === "") return "unknown";
  let record;
  try {
    record = JSON.parse(firstLine);
  } catch {
    return "unknown";
  }
  const source = isRecord(record) ? record["source"] : void 0;
  return source === "async" || source === "foreground" ? source : "unknown";
}
function runStatus(artifact, lastWriteMs, startedAtMs, now, parentActive) {
  if (artifact?.exitCode !== void 0) return artifact.exitCode === 0 ? "done" : "failed";
  if (artifact?.reported === true) return "done";
  if (lastWriteMs === void 0) {
    if (!parentActive) return silentSinceLaunch(startedAtMs, now) ? "lost" : "unknown";
    return silentSinceLaunch(startedAtMs, now) ? "lost" : "running";
  }
  const quietMs = now - lastWriteMs;
  if (quietMs < RUNNING_STALE_AFTER_MS) return "running";
  if (parentActive && quietMs < PARENT_ACTIVE_STALE_AFTER_MS) return "running";
  return "lost";
}
function silentSinceLaunch(startedAtMs, now) {
  return Number.isFinite(startedAtMs) && now - startedAtMs > SILENT_LAUNCH_GRACE_MS;
}
function parseSubagentSessionName(name) {
  const match = /^subagent-(?<agent>.+)-(?<runId>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?$/u.exec(name);
  const agent = match?.groups?.["agent"];
  const runId = match?.groups?.["runId"];
  return agent === void 0 || runId === void 0 ? void 0 : { agent, runId };
}
async function readRunIdentity(transcript) {
  const head = await readWindow(transcript, HEAD_BYTES, "head");
  if (head === void 0) return void 0;
  for (const line of head.split("\n")) {
    if (!line.includes('"session_info"')) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const name = isRecordWithName(record) ? record.name : void 0;
    const identity = name === void 0 ? void 0 : parseSubagentSessionName(name);
    if (identity !== void 0) return identity;
  }
  return void 0;
}
function isRecordWithName(value) {
  return isRecord(value) && typeof value["name"] === "string";
}
async function findTranscript(runDir) {
  const attempts = (await listDirectories(runDir)).filter((name) => name.startsWith("run-")).sort();
  const latest = attempts.at(-1);
  if (latest === void 0) return void 0;
  const path = join(runDir, latest, "session.jsonl");
  return await statOrUndefined(path) === void 0 ? void 0 : path;
}
async function lastTranscriptStep(transcript) {
  const text = await readWindow(transcript, TAIL_BYTES, "tail");
  if (text === void 0) return void 0;
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  for (const line of lines.reverse()) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const step = stepFromEntry(parsed);
    if (step !== void 0) return step;
  }
  return void 0;
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function stepFromEntry(entry) {
  if (!isRecord(entry)) return void 0;
  const message = entry["message"];
  const content = isRecord(message) ? message["content"] : entry["content"];
  if (!Array.isArray(content)) return void 0;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part = content[index];
    if (!isRecord(part)) continue;
    const partRecord = part;
    const toolName = partRecord["toolName"];
    if (typeof toolName === "string" && toolName !== "") return toolName;
    const type = partRecord["type"];
    const text = partRecord["text"];
    if (type === "text" && typeof text === "string" && text.trim() !== "") return summarize(text);
  }
  return void 0;
}
function summarize(text) {
  const firstLine = text.trim().split("\n")[0] ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 119)}\u2026` : firstLine;
}
async function readArtifacts(artifactsDir, names) {
  const artifacts = /* @__PURE__ */ new Map();
  const outputs = new Set(names.filter((name) => name.endsWith("_output.md")).map((name) => name.slice(0, name.indexOf("_"))));
  for (const name of names) {
    if (!name.endsWith("_meta.json")) continue;
    const runId = name.slice(0, name.indexOf("_"));
    if (runId === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(join(artifactsDir, name), "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const record = parsed;
    const summaryFromOutput = outputs.has(runId) ? await firstLineOfOutput(artifactsDir, names, runId) : void 0;
    artifacts.set(runId, {
      ...summaryFromOutput === void 0 ? {} : { outputSummary: summaryFromOutput },
      ...typeof record["agent"] === "string" ? { agent: record["agent"] } : {},
      // The tool redacts prompts, so `task` is the literal string
      // "[prompt redacted]" for every run - useless as a row label. The first
      // line of what the run returned says more about it than its own
      // description would have.
      ...typeof record["task"] === "string" && !record["task"].includes("redacted") ? { task: summarize(record["task"]) } : {},
      ...typeof record["model"] === "string" ? { model: record["model"] } : {},
      ...typeof record["exitCode"] === "number" ? { exitCode: record["exitCode"] } : {},
      ...typeof record["durationMs"] === "number" ? { durationMs: record["durationMs"] } : {},
      ...typeof record["toolCount"] === "number" ? { toolCount: record["toolCount"] } : {},
      ...typeof record["timestamp"] === "string" ? { timestamp: record["timestamp"] } : {},
      ...typeof record["error"] === "string" && record["error"].trim() !== "" ? { error: summarize(record["error"]) } : {},
      hasOutput: outputs.has(runId),
      // Reading a `meta.json` at all is the run's own report that it ended.
      reported: true
    });
  }
  return artifacts;
}
async function readSubagentRunOutput(sessionDir, runId, options = {}) {
  const maxChars = options.maxChars ?? 2e4;
  if (!isSafeRunId(runId)) return void 0;
  const artifactsDir = join(sessionDir, "subagent-artifacts");
  const names = await listNames(artifactsDir);
  const name = names.find((entry) => entry.startsWith(`${runId}_`) && entry.endsWith("_output.md"));
  if (name !== void 0) {
    try {
      const text = await readFile(join(artifactsDir, name), "utf8");
      return clamp(text, maxChars);
    } catch {
      return void 0;
    }
  }
  return options.parentSessionId === void 0 ? void 0 : await readRunProgress(join(sessionDir, options.parentSessionId), runId, maxChars);
}
async function listNames(dir) {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
function isMissing(error) {
  if (!(error instanceof Error)) return false;
  const code = Reflect.get(error, "code");
  return code === "ENOENT" || code === "ENOTDIR";
}
async function readRunProgress(runsDir, runId, maxChars) {
  const transcript = await findRunTranscript(runsDir, runId);
  if (transcript === void 0) return void 0;
  const text = await readWindow(transcript, TAIL_BYTES, "tail");
  if (text === void 0) return void 0;
  const steps = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const step = stepFromEntry(parsed);
    if (step !== void 0) steps.push(step);
  }
  if (steps.length === 0) return void 0;
  return clamp(`_This run has not written a result yet. Its latest steps:_

${steps.slice(-40).map((step) => `- ${step}`).join("\n")}`, maxChars);
}
async function findRunTranscript(runsDir, runId) {
  const direct = await findTranscript(join(runsDir, runId));
  if (direct !== void 0) return direct;
  for (const candidate of await listDirectories(runsDir)) {
    const transcript = await findTranscript(join(runsDir, candidate));
    if (transcript === void 0) continue;
    const identity = await readRunIdentity(transcript);
    if (identity?.runId === runId) return transcript;
  }
  return void 0;
}
function isSafeRunId(runId) {
  return runId !== "" && !runId.includes("/") && !runId.includes("\\") && !runId.includes("..");
}
function clamp(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, maxChars)}

[truncated]` : text;
}
async function firstLineOfOutput(artifactsDir, names, runId) {
  const name = names.find((entry) => entry.startsWith(`${runId}_`) && entry.endsWith("_output.md"));
  if (name === void 0) return void 0;
  const text = await readWindow(join(artifactsDir, name), OUTPUT_HEAD_BYTES, "head");
  if (text === void 0) return void 0;
  const line = text.split("\n").map((entry) => entry.replace(/^#+\s*/, "").trim()).find((entry) => entry !== "");
  return line === void 0 ? void 0 : summarize(line);
}
async function listDirectories(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
async function statOrUndefined(path) {
  try {
    return await stat(path);
  } catch {
    return void 0;
  }
}

// src/server-plugin.ts
function sessionFileFrom(input) {
  if (typeof input !== "object" || input === null) return void 0;
  const path = Reflect.get(input, "sessionFile");
  return typeof path === "string" && path.endsWith(".jsonl") ? path : void 0;
}
function runsAsJson(runs) {
  return runs.map((run) => ({
    runId: run.runId,
    agent: run.agent,
    status: run.status,
    ...run.error === void 0 ? {} : { error: run.error },
    elapsedMs: run.elapsedMs,
    startedAt: run.startedAt,
    ...run.lastActivity === void 0 ? {} : { lastActivity: run.lastActivity },
    ...run.task === void 0 ? {} : { task: run.task },
    ...run.model === void 0 ? {} : { model: run.model },
    ...run.toolCount === void 0 ? {} : { toolCount: run.toolCount },
    hasOutput: run.hasOutput,
    ...run.toolRunId === void 0 ? {} : { toolRunId: run.toolRunId },
    ...run.control === void 0 ? {} : { control: run.control }
  }));
}
var plugin = {
  apiVersion: 1,
  name: "Subagents",
  activate: () => ({
    agentFacts: {
      surfaces: [{ surface: "subagents", tools: ["subagent"] }],
      workPaths: [{ root: "session-dir", path: "subagent-artifacts" }, { root: "session-stem", path: "" }]
    },
    backgroundWork: async (session) => {
      const runs = await listSubagentRuns(dirname2(session.sessionFile), basename2(session.sessionFile, ".jsonl"), Date.now(), { parentActive: session.parentActive });
      return { running: runs.filter((run) => run.status === "running").length };
    },
    operations: {
      "runs.list": async (input) => {
        const sessionFile = sessionFileFrom(input);
        if (sessionFile === void 0) return { known: false, reason: "no-session" };
        const runs = await listSubagentRuns(dirname2(sessionFile), basename2(sessionFile, ".jsonl"), Date.now());
        return { known: true, runs: runsAsJson(runs) };
      },
      "runs.output": async (input) => {
        const sessionFile = sessionFileFrom(input);
        const runId = typeof input === "object" && input !== null ? Reflect.get(input, "runId") : void 0;
        if (sessionFile === void 0 || typeof runId !== "string" || runId === "") return { known: false, reason: "no-run" };
        const output = await readSubagentRunOutput(dirname2(sessionFile), runId, { parentSessionId: basename2(sessionFile, ".jsonl") });
        return output === void 0 ? { known: false, reason: "not-written" } : { known: true, output };
      }
    }
  })
};
var server_plugin_default = plugin;
export {
  server_plugin_default as default
};
