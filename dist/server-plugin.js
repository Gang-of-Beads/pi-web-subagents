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
  const cached = parentRecordsCache.get(sessionFile);
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
  parentRecordsCache.set(sessionFile, { size: stats.size, mtimeMs: stats.mtimeMs, ids, notified });
  return { ids, notified };
}
function emptyNotifiedOutcomes() {
  return { byToolRunId: /* @__PURE__ */ new Map(), byWorkflowChildRunId: /* @__PURE__ */ new Map(), toolRunIdByDirectory: /* @__PURE__ */ new Map() };
}
function notifiedOutcomeOf(notified, runId) {
  return notified.byToolRunId.get(runId) ?? notified.byWorkflowChildRunId.get(runId);
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
    if (typeof runId !== "string" || runId === "") continue;
    const sessionValue = run["sessionValue"];
    const directory = typeof sessionValue === "string" ? childDirectoryOf(sessionValue, parentSessionId) : void 0;
    if (directory !== void 0) notified.toolRunIdByDirectory.set(directory, runId);
    collectNotifiedOutcome(run, notified.byToolRunId);
    const childRuns = run["childRuns"];
    if (!Array.isArray(childRuns)) continue;
    for (const child of childRuns) {
      if (isRecord(child)) collectNotifiedOutcome(child, notified.byWorkflowChildRunId);
    }
  }
}
function collectNotifiedOutcome(entry, outcomes) {
  const runId = entry["runId"];
  const rawStatus = entry["status"];
  if (typeof runId !== "string" || runId === "") return;
  const status = typeof rawStatus === "string" && Object.hasOwn(NOTIFIED_STATUS, rawStatus) ? NOTIFIED_STATUS[rawStatus] : void 0;
  if (status === void 0) return;
  const durationMs = entry["durationMs"];
  outcomes.set(runId, { status, ...typeof durationMs === "number" ? { durationMs } : {} });
}
function childDirectoryOf(sessionFile, parentSessionId) {
  const runDir = dirname(dirname(sessionFile));
  return basename(dirname(runDir)) === parentSessionId && basename(dirname(sessionFile)).startsWith("run-") ? basename(runDir) : void 0;
}
var parentRecordsCache = /* @__PURE__ */ new Map();
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
  const outcome = notifiedOutcomeOf(notified, linkedRunId ?? runId);
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
  const toolRunId = linkedRunId ?? (running === void 0 ? void 0 : runId);
  const toolLiveArtifact = toolRunId === void 0 ? void 0 : runningByRunId.get(toolRunId);
  const liveArtifact = toolLiveArtifact ?? running;
  const stepPath = liveArtifact?.transcriptPath ?? transcript;
  const step = (status === "running" || status === "lost") && stepPath !== void 0 ? await latestStep(stepPath, status === "running") : void 0;
  const control = status === "running" ? await runControl(toolLiveArtifact) : void 0;
  const artifactPrefix = artifact?.prefix ?? (liveArtifact === void 0 ? void 0 : liveArtifact.transcriptPath.slice(0, -TRANSCRIPT_SUFFIX.length));
  return {
    runId: artifactRunId,
    agent,
    status,
    ...error === void 0 ? {} : { error },
    elapsedMs,
    startedAt,
    ...step === void 0 ? {} : { lastActivity: step.text },
    ...step?.at === void 0 ? {} : { lastActivityAt: step.at },
    ...label === void 0 ? {} : { task: label },
    ...artifact?.model === void 0 ? {} : { model: artifact.model },
    ...artifact?.toolCount === void 0 ? {} : { toolCount: artifact.toolCount },
    hasOutput: artifact?.hasOutput === true,
    ...toolRunId === void 0 ? {} : { toolRunId },
    ...control === void 0 ? {} : { control },
    ...artifactPrefix === void 0 ? {} : { artifactPrefix },
    ...transcript === void 0 ? {} : { transcriptPath: transcript }
  };
}
var TRANSCRIPT_SUFFIX = "_transcript.jsonl";
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
var STEP_CHARS = 200;
var stepCache = /* @__PURE__ */ new Map();
var STEP_CACHE_ENTRIES = 2048;
function rememberStep(transcript, entry) {
  stepCache.delete(transcript);
  stepCache.set(transcript, entry);
  const oldest = stepCache.keys().next();
  if (stepCache.size > STEP_CACHE_ENTRIES && oldest.done !== true) stepCache.delete(oldest.value);
}
async function latestStep(transcript, live) {
  const cached = stepCache.get(transcript);
  if (cached !== void 0) rememberStep(transcript, cached);
  if (!live && cached !== void 0) return cached.step;
  const stats = await statOrUndefined(transcript);
  if (stats === void 0) return void 0;
  if (cached !== void 0 && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) return cached.step;
  const text = await readWindow(transcript, TAIL_BYTES, "tail");
  if (text === void 0) return cached?.step;
  let step;
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  for (const line of lines.reverse()) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    step = stepOf(parsed);
    if (step !== void 0) break;
  }
  step ??= cached?.step;
  rememberStep(transcript, { size: stats.size, mtimeMs: stats.mtimeMs, step });
  return step;
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function stepOf(entry) {
  if (!isRecord(entry)) return void 0;
  const at = recordTime(entry);
  const withTime = (text) => at === void 0 ? { text } : { text, at };
  if (entry["recordType"] === "tool_start") {
    const toolName = entry["toolName"];
    const preview = entry["argsPreview"];
    if (typeof toolName !== "string" || toolName === "") return void 0;
    return withTime(typeof preview === "string" && preview.trim() !== "" ? clip(`${toolName}: ${oneLine(preview)}`, STEP_CHARS) : toolName);
  }
  const message = entry["message"];
  const holder = isRecord(message) ? message : entry;
  if (holder["role"] !== "assistant") return void 0;
  const content = holder["content"];
  if (!Array.isArray(content)) return void 0;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part = content[index];
    if (!isRecord(part)) continue;
    const name = part["name"];
    if (part["type"] === "toolCall" && typeof name === "string" && name !== "") {
      const preview = argumentsPreview(part["arguments"]);
      return withTime(preview === "" ? name : clip(`${name}: ${preview}`, STEP_CHARS));
    }
    const text = part["text"];
    if (part["type"] === "text" && typeof text === "string" && text.trim() !== "") return withTime(summarize(text, STEP_CHARS));
  }
  return void 0;
}
function recordTime(entry) {
  const raw = entry["timestamp"];
  const ms = typeof raw === "string" ? Date.parse(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : void 0;
}
function argumentsPreview(args) {
  if (!isRecord(args)) return "";
  const first = Object.values(args).find((value) => typeof value === "string" && value.trim() !== "");
  const text = typeof first === "string" ? first : Object.keys(args).length === 0 ? "" : JSON.stringify(args);
  return clip(oneLine(text), STEP_CHARS);
}
function oneLine(text) {
  return text.replace(/\s+/gu, " ").trim();
}
function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}
function summarize(text, max = 120) {
  return clip(text.trim().split("\n")[0] ?? "", max);
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
      prefix: join(artifactsDir, name.slice(0, -"_meta.json".length)),
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
    const step = stepOf(parsed);
    if (step !== void 0) steps.push(step.text);
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

// src/server/runDetail.ts
import { open as open2, stat as stat2 } from "node:fs/promises";
var TASK_HEAD_BYTES = 128 * 1024;
var TASK_BYTES = 16 * 1024;
var RESULT_BYTES = 64 * 1024;
var ERROR_CHARS = 4 * 1024;
var META_BYTES = 1024 * 1024;
var CONVERSATION_READ_BYTES = 8 * 1024 * 1024;
var CONVERSATION_SHOWN_BYTES = 1024 * 1024;
var TOOL_RESULT_LINES = 20;
var TOOL_RESULT_CHARS = 2 * 1024;
var REDACTED = "[prompt redacted]";
var TASK_PREFIX = "Task: ";
async function ownedRun(sessionDir, sessionStem, runId, signal) {
  const runs = await listSubagentRuns(sessionDir, sessionStem, Date.now());
  signal.throwIfAborted();
  const run = runs.find((candidate) => candidate.runId === runId || candidate.toolRunId === runId);
  if (run === void 0) return "no-run";
  const meta = run.artifactPrefix === void 0 ? void 0 : await readJson(`${run.artifactPrefix}_meta.json`);
  const parentSessionId = meta?.["parentSessionId"];
  if (typeof parentSessionId === "string" && parentSessionId !== "" && sessionStem !== parentSessionId && !sessionStem.endsWith(`_${parentSessionId}`)) return "not-this-session";
  return { run, meta };
}
function refusal(reason) {
  return { known: false, reason };
}
function transcriptsOf(run) {
  return [
    ...run.artifactPrefix === void 0 ? [] : [`${run.artifactPrefix}_transcript.jsonl`],
    ...run.transcriptPath === void 0 ? [] : [run.transcriptPath]
  ];
}
async function readRunDetail(sessionDir, sessionStem, runId, countMessages, signal) {
  const owned = await ownedRun(sessionDir, sessionStem, runId, signal);
  if (typeof owned === "string") return refusal(owned);
  const { run, meta } = owned;
  const task = await readTask(transcriptsOf(run));
  signal.throwIfAborted();
  const result = run.status === "running" ? void 0 : await readResult(run);
  signal.throwIfAborted();
  const messages = countMessages ? await messageCount(transcriptsOf(run)) : void 0;
  const error = run.status === "failed" ? stringField(meta, "error") ?? run.error : void 0;
  return {
    known: true,
    status: run.status,
    task,
    ...result === void 0 ? {} : { result },
    facts: factsOf(run, meta),
    ...messages === void 0 ? {} : { messages },
    ...error === void 0 || error.trim() === "" ? {} : { error: error.length > ERROR_CHARS ? `${error.slice(0, ERROR_CHARS - 1)}\u2026` : error }
  };
}
function factsOf(run, meta) {
  const usage = meta?.["usage"];
  const number = (key) => {
    const value = isRecord(usage) ? usage[key] : void 0;
    return typeof value === "number" && Number.isFinite(value) ? value : void 0;
  };
  const cacheRead = number("cacheRead");
  const cacheWrite = number("cacheWrite");
  const model = stringField(meta, "model") ?? run.model;
  const facts = {};
  if (model !== void 0) facts["model"] = model;
  const tokensIn = number("input");
  const tokensOut = number("output");
  const cost = number("cost");
  const turns = number("turns");
  if (tokensIn !== void 0) facts["tokensIn"] = tokensIn;
  if (tokensOut !== void 0) facts["tokensOut"] = tokensOut;
  if (cacheRead !== void 0 || cacheWrite !== void 0) facts["tokensCached"] = (cacheRead ?? 0) + (cacheWrite ?? 0);
  if (cost !== void 0) facts["cost"] = cost;
  if (turns !== void 0) facts["turns"] = turns;
  if (run.status !== "running") facts["durationMs"] = run.elapsedMs;
  return facts;
}
function stringField(record, key) {
  const value = record?.[key];
  return typeof value === "string" ? value : void 0;
}
async function readTask(transcripts) {
  for (const path of transcripts) {
    const head = await readWindow(path, TASK_HEAD_BYTES, "head");
    if (head === void 0) continue;
    for (const line of head.split("\n")) {
      const message = messageOf(line);
      const written = message === void 0 ? void 0 : userWordsOf(message);
      if (written === void 0) continue;
      const text = withoutTaskPrefix(written);
      const totalBytes = Buffer.byteLength(text);
      return { text: totalBytes > TASK_BYTES ? utf8Head(text, TASK_BYTES) : text, totalBytes, truncated: totalBytes > TASK_BYTES };
    }
  }
  return { absent: "not-recorded" };
}
async function readResult(run) {
  if (!run.hasOutput || run.artifactPrefix === void 0) return { absent: "not-written" };
  const path = `${run.artifactPrefix}_output.md`;
  const [text, stats] = await Promise.all([readWindow(path, RESULT_BYTES, "head"), stat2(path).catch(() => void 0)]);
  if (text === void 0 || stats === void 0) return { absent: "unreadable" };
  return { text, totalBytes: stats.size, truncated: stats.size > RESULT_BYTES };
}
async function readJson(path) {
  const text = await readWindow(path, META_BYTES, "head");
  if (text === void 0) return void 0;
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function messageOf(line) {
  if (line.trim() === "") return void 0;
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return void 0;
  }
  if (!isRecord(record)) return void 0;
  const message = record["message"];
  if (!isRecord(message)) return void 0;
  return { record, role: message["role"], content: message["content"], message };
}
function withoutTaskPrefix(text) {
  return text.startsWith(TASK_PREFIX) ? text.slice(TASK_PREFIX.length) : text;
}
function userWordsOf(message) {
  if (message.record["sourceEventType"] === "initial_prompt" || message.role !== "user") return void 0;
  const text = textOf(message.content);
  const words = withoutTaskPrefix(text);
  return words.trim() === "" || words.trimStart().startsWith(REDACTED) ? void 0 : text;
}
function utf8Head(text, bytes) {
  const buffer = Buffer.from(text);
  let end = Math.min(bytes, buffer.length);
  while (end > 0 && end < buffer.length && (buffer.readUInt8(end) & 192) === 128) end -= 1;
  return buffer.toString("utf8", 0, end);
}
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts = [];
  for (const part of content) {
    if (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string") texts.push(part["text"]);
  }
  return texts.join("\n\n");
}
async function readRunConversation(sessionDir, sessionStem, runId, signal) {
  const owned = await ownedRun(sessionDir, sessionStem, runId, signal);
  if (typeof owned === "string") return refusal(owned);
  for (const path of transcriptsOf(owned.run)) {
    const tail = await readTailBytes(path, CONVERSATION_READ_BYTES);
    signal.throwIfAborted();
    if (tail === void 0) continue;
    const turns = [];
    forEachLine(tail.buffer, (line, start) => {
      for (const turn of turnsOf(line)) turns.push({ turn, offset: tail.position + start });
    });
    let budget = CONVERSATION_SHOWN_BYTES;
    let first = turns.length;
    while (first > 0) {
      const entry = turns[first - 1];
      if (entry === void 0) break;
      budget -= turnBytes(entry.turn);
      if (budget < 0) break;
      first -= 1;
    }
    const cut = first > 0 || tail.position > 0;
    const shownFrom = turns[first]?.offset ?? tail.size;
    return {
      known: true,
      turns: turns.slice(first).map((entry) => entry.turn),
      totalBytes: tail.size,
      shownBytes: cut ? tail.size - shownFrom : tail.size,
      truncated: cut
    };
  }
  return refusal("no-transcript");
}
async function messageCount(transcripts) {
  for (const path of transcripts) {
    const tail = await readTailBytes(path, CONVERSATION_READ_BYTES);
    if (tail === void 0) continue;
    let count = 0;
    forEachLine(tail.buffer, (line) => {
      if (turnsOf(line).length > 0) count += 1;
    });
    return { count, truncated: tail.position > 0 };
  }
  return void 0;
}
function forEachLine(buffer, visit) {
  let start = 0;
  while (start < buffer.length) {
    const newline = buffer.indexOf(10, start);
    const end = newline === -1 ? buffer.length : newline;
    visit(buffer.toString("utf8", start, end), start);
    start = end + 1;
  }
}
function turnBytes(turn) {
  return Buffer.byteLength(turn.kind === "tool-call" ? `${turn.name}${turn.args}` : turn.text);
}
function turnsOf(line) {
  const message = messageOf(line);
  if (message === void 0 || message.record["sourceEventType"] === "initial_prompt") return [];
  if (message.role === "user") {
    const text = userWordsOf(message);
    return text === void 0 ? [] : [{ kind: "user", text }];
  }
  if (message.role === "toolResult") {
    const name = typeof message.message["toolName"] === "string" ? message.message["toolName"] : "tool";
    return [{ kind: "tool-result", name, failed: message.message["isError"] === true, ...clampToolResult(textOf(message.content)) }];
  }
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  const turns = [];
  for (const part of message.content) {
    if (!isRecord(part)) continue;
    const text = part["text"];
    const name = part["name"];
    if (part["type"] === "text" && typeof text === "string" && text.trim() !== "") {
      const last = turns.at(-1);
      if (last?.kind === "assistant") last.text = `${last.text}

${text}`;
      else turns.push({ kind: "assistant", text });
    } else if (part["type"] === "toolCall" && typeof name === "string" && name !== "") {
      turns.push({ kind: "tool-call", name, args: argumentsPreview(part["arguments"]) });
    }
  }
  return turns;
}
function clampToolResult(text) {
  const lines = text.split("\n");
  let shown = lines.slice(0, TOOL_RESULT_LINES).join("\n");
  const cutInLine = shown.length > TOOL_RESULT_CHARS;
  if (cutInLine) shown = shown.slice(0, TOOL_RESULT_CHARS);
  const shownLines = shown.split("\n").length;
  return { text: cutInLine ? `${shown}\u2026` : shown, moreLines: lines.length - shownLines };
}
async function readTailBytes(path, bytes) {
  let handle;
  try {
    handle = await open2(path, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const position = size - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return { buffer: buffer.subarray(0, bytesRead), position, size };
  } catch {
    return void 0;
  } finally {
    await handle?.close().catch(() => void 0);
  }
}

// src/server-plugin.ts
function sessionFileFrom(input) {
  if (typeof input !== "object" || input === null) return void 0;
  const path = Reflect.get(input, "sessionFile");
  return typeof path === "string" && path.endsWith(".jsonl") ? path : void 0;
}
function runRequestFrom(input) {
  const sessionFile = sessionFileFrom(input);
  if (sessionFile === void 0) return "no-session";
  const runId = typeof input === "object" && input !== null ? Reflect.get(input, "runId") : void 0;
  return typeof runId !== "string" || !isSafeRunId(runId) ? "no-run" : { sessionFile, runId };
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
    ...run.lastActivityAt === void 0 ? {} : { lastActivityAt: run.lastActivityAt },
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
      },
      "runs.detail": async (input, { signal }) => {
        const request = runRequestFrom(input);
        if (typeof request === "string") return { known: false, reason: request };
        const countMessages = typeof input === "object" && input !== null && Reflect.get(input, "countMessages") === true;
        return readRunDetail(dirname2(request.sessionFile), basename2(request.sessionFile, ".jsonl"), request.runId, countMessages, signal);
      },
      "runs.conversation": async (input, { signal }) => {
        const request = runRequestFrom(input);
        if (typeof request === "string") return { known: false, reason: request };
        return readRunConversation(dirname2(request.sessionFile), basename2(request.sessionFile, ".jsonl"), request.runId, signal);
      }
    }
  })
};
var server_plugin_default = plugin;
export {
  server_plugin_default as default
};
