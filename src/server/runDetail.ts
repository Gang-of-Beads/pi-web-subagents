import { open, stat } from "node:fs/promises";
import type { JsonValue } from "@gang-of-beads/pi-web-plugin-api/server-plugin-api";
import { argumentsPreview, isRecord, listSubagentRuns, readWindow, type SubagentRunInfo } from "./runs.js";

/**
 * What an opened row reads about one run (`runs.detail`) and its whole conversation
 * (`runs.conversation`). Both are read only when a reader opens a row or presses
 * Conversation, never on the list's poll.
 *
 * Scope: a run is answered only when this session's own listing holds it, by the same
 * ownership rule the list uses, so the two cannot disagree; files are then opened by the
 * paths that listing resolved from directory entries, never by joining the caller's input.
 * When the run's `meta.json` names a parent session, it must be this one.
 */

export type RunRefusal = "no-session" | "no-run" | "not-this-session" | "no-transcript";

const TASK_HEAD_BYTES = 128 * 1024;
const TASK_BYTES = 16 * 1024;
const RESULT_BYTES = 64 * 1024;
const ERROR_CHARS = 4 * 1024;
/** `meta.json` is a few kilobytes; one bigger than this is not read. */
const META_BYTES = 1024 * 1024;
const CONVERSATION_READ_BYTES = 8 * 1024 * 1024;
const CONVERSATION_SHOWN_BYTES = 1024 * 1024;
const TOOL_RESULT_LINES = 20;
const TOOL_RESULT_CHARS = 2 * 1024;
/** What the subagent tool writes in place of a prompt it keeps out of its files. */
const REDACTED = "[prompt redacted]";
/** What pi-subagents writes before the task in the child's first message (`prompt(\`Task: ${task}\`)`). */
const TASK_PREFIX = "Task: ";

interface OwnedRun {
  readonly run: SubagentRunInfo;
  readonly meta: Record<string, unknown> | undefined;
}

/**
 * The run this session owns under `runId` (its listed id or the tool's id), or why not.
 * `sessionStem` is the session file's name without `.jsonl`, `<time>_<uuid>`.
 */
async function ownedRun(sessionDir: string, sessionStem: string, runId: string, signal: AbortSignal): Promise<OwnedRun | RunRefusal> {
  const runs = await listSubagentRuns(sessionDir, sessionStem, Date.now());
  signal.throwIfAborted();
  const run = runs.find((candidate) => candidate.runId === runId || candidate.toolRunId === runId);
  if (run === undefined) return "no-run";
  const meta = run.artifactPrefix === undefined ? undefined : await readJson(`${run.artifactPrefix}_meta.json`);
  const parentSessionId = meta?.["parentSessionId"];
  if (typeof parentSessionId === "string" && parentSessionId !== "" && sessionStem !== parentSessionId && !sessionStem.endsWith(`_${parentSessionId}`)) return "not-this-session";
  return { run, meta };
}

function refusal(reason: RunRefusal): JsonValue {
  return { known: false, reason };
}

/** The transcripts a run may have, the artifact one first: it carries the task the child's own session file may lack. */
function transcriptsOf(run: SubagentRunInfo): string[] {
  return [
    ...(run.artifactPrefix === undefined ? [] : [`${run.artifactPrefix}_transcript.jsonl`]),
    ...(run.transcriptPath === undefined ? [] : [run.transcriptPath]),
  ];
}

/**
 * An opened row: the task, the result of a finished run, its facts, its error (cut to its first
 * 4 K characters), and, when
 * `countMessages` asks (a page that draws a Conversation row), how many messages it holds.
 */
export async function readRunDetail(sessionDir: string, sessionStem: string, runId: string, countMessages: boolean, signal: AbortSignal): Promise<JsonValue> {
  const owned = await ownedRun(sessionDir, sessionStem, runId, signal);
  if (typeof owned === "string") return refusal(owned);
  const { run, meta } = owned;
  const task = await readTask(transcriptsOf(run));
  signal.throwIfAborted();
  const result = run.status === "running" ? undefined : await readResult(run);
  signal.throwIfAborted();
  const messages = countMessages ? await messageCount(transcriptsOf(run)) : undefined;
  const error = run.status === "failed" ? stringField(meta, "error") ?? run.error : undefined;
  return {
    known: true,
    status: run.status,
    task,
    ...(result === undefined ? {} : { result }),
    facts: factsOf(run, meta),
    ...(messages === undefined ? {} : { messages }),
    ...(error === undefined || error.trim() === "" ? {} : { error: error.length > ERROR_CHARS ? `${error.slice(0, ERROR_CHARS - 1)}…` : error }),
  };
}

function factsOf(run: SubagentRunInfo, meta: Record<string, unknown> | undefined): JsonValue {
  const usage = meta?.["usage"];
  const number = (key: string): number | undefined => {
    const value = isRecord(usage) ? usage[key] : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const cacheRead = number("cacheRead");
  const cacheWrite = number("cacheWrite");
  const model = stringField(meta, "model") ?? run.model;
  const facts: Record<string, JsonValue> = {};
  if (model !== undefined) facts["model"] = model;
  const tokensIn = number("input");
  const tokensOut = number("output");
  const cost = number("cost");
  const turns = number("turns");
  if (tokensIn !== undefined) facts["tokensIn"] = tokensIn;
  if (tokensOut !== undefined) facts["tokensOut"] = tokensOut;
  if (cacheRead !== undefined || cacheWrite !== undefined) facts["tokensCached"] = (cacheRead ?? 0) + (cacheWrite ?? 0);
  if (cost !== undefined) facts["cost"] = cost;
  if (turns !== undefined) facts["turns"] = turns;
  if (run.status !== "running") facts["durationMs"] = run.elapsedMs;
  return facts;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The task: the first user message that is not the tool's redacted prompt, without the
 * tool's leading "Task: ". In the artifact
 * transcript it sits after the system prompt record (measured: at most 83 KB in), so the
 * head read is 128 KiB of each transcript in turn.
 */
async function readTask(transcripts: readonly string[]): Promise<JsonValue> {
  for (const path of transcripts) {
    const head = await readWindow(path, TASK_HEAD_BYTES, "head");
    if (head === undefined) continue;
    for (const line of head.split("\n")) {
      const message = messageOf(line);
      const written = message === undefined ? undefined : userWordsOf(message);
      if (written === undefined) continue;
      const text = withoutTaskPrefix(written);
      const totalBytes = Buffer.byteLength(text);
      return { text: totalBytes > TASK_BYTES ? utf8Head(text, TASK_BYTES) : text, totalBytes, truncated: totalBytes > TASK_BYTES };
    }
  }
  return { absent: "not-recorded" };
}

async function readResult(run: SubagentRunInfo): Promise<JsonValue> {
  if (!run.hasOutput || run.artifactPrefix === undefined) return { absent: "not-written" };
  const path = `${run.artifactPrefix}_output.md`;
  const [text, stats] = await Promise.all([readWindow(path, RESULT_BYTES, "head"), stat(path).catch(() => undefined)]);
  if (text === undefined || stats === undefined) return { absent: "unreadable" };
  return { text, totalBytes: stats.size, truncated: stats.size > RESULT_BYTES };
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readWindow(path, META_BYTES, "head");
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

interface TranscriptMessage {
  readonly record: Record<string, unknown>;
  readonly role: unknown;
  readonly content: unknown;
  readonly message: Record<string, unknown>;
}

/** A transcript line's model message, in the `message` wrapper both the artifact and Pi's session format write. */
function messageOf(line: string): TranscriptMessage | undefined {
  if (line.trim() === "") return undefined;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(record)) return undefined;
  const message = record["message"];
  if (!isRecord(message)) return undefined;
  return { record, role: message["role"], content: message["content"], message };
}

function withoutTaskPrefix(text: string): string {
  return text.startsWith(TASK_PREFIX) ? text.slice(TASK_PREFIX.length) : text;
}

/**
 * A user message's words as written, or undefined when neither the task nor the Conversation
 * shows it: the tool's initial prompt, an empty message, or the redacted prompt (with or
 * without the tool's leading "Task: ").
 */
function userWordsOf(message: TranscriptMessage): string | undefined {
  if (message.record["sourceEventType"] === "initial_prompt" || message.role !== "user") return undefined;
  const text = textOf(message.content);
  const words = withoutTaskPrefix(text);
  return words.trim() === "" || words.trimStart().startsWith(REDACTED) ? undefined : text;
}

/** The first `bytes` UTF-8 bytes of `text`, cut back to a code-point boundary so no character is split. */
function utf8Head(text: string, bytes: number): string {
  const buffer = Buffer.from(text);
  let end = Math.min(bytes, buffer.length);
  while (end > 0 && end < buffer.length && (buffer.readUInt8(end) & 0xc0) === 0x80) end -= 1;
  return buffer.toString("utf8", 0, end);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string") texts.push(part["text"]);
  }
  return texts.join("\n\n");
}

type Turn =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool-call"; name: string; args: string }
  | { kind: "tool-result"; name: string; text: string; moreLines: number; failed: boolean };

/**
 * The whole conversation as turns: the user's words (the task, steering), the assistant's
 * text, each tool call in one line and each tool result clamped to its first lines. Thinking,
 * the system prompt and the redacted initial prompt are left out. Bounds: the last 8 MiB of
 * the file are read, and the newest turns that fit in 1 MiB are answered; when either cut
 * anything, `shownBytes` says how much of the file the answer starts from.
 */
export async function readRunConversation(sessionDir: string, sessionStem: string, runId: string, signal: AbortSignal): Promise<JsonValue> {
  const owned = await ownedRun(sessionDir, sessionStem, runId, signal);
  if (typeof owned === "string") return refusal(owned);
  for (const path of transcriptsOf(owned.run)) {
    const tail = await readTailBytes(path, CONVERSATION_READ_BYTES);
    signal.throwIfAborted();
    if (tail === undefined) continue;
    const turns: { turn: Turn; offset: number }[] = [];
    forEachLine(tail.buffer, (line, start) => {
      for (const turn of turnsOf(line)) turns.push({ turn, offset: tail.position + start });
    });
    let budget = CONVERSATION_SHOWN_BYTES;
    let first = turns.length;
    while (first > 0) {
      const entry = turns[first - 1];
      if (entry === undefined) break;
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
      truncated: cut,
    };
  }
  return refusal("no-transcript");
}

/**
 * How many transcript messages the Conversation draws from (each one that shows as at least one
 * turn), counted over the same last 8 MiB it reads. `truncated` says the file holds more than
 * that window, so the count is a floor.
 */
async function messageCount(transcripts: readonly string[]): Promise<JsonValue | undefined> {
  for (const path of transcripts) {
    const tail = await readTailBytes(path, CONVERSATION_READ_BYTES);
    if (tail === undefined) continue;
    let count = 0;
    forEachLine(tail.buffer, (line) => {
      if (turnsOf(line).length > 0) count += 1;
    });
    return { count, truncated: tail.position > 0 };
  }
  return undefined;
}

function forEachLine(buffer: Buffer, visit: (line: string, start: number) => void): void {
  let start = 0;
  while (start < buffer.length) {
    const newline = buffer.indexOf(10, start);
    const end = newline === -1 ? buffer.length : newline;
    visit(buffer.toString("utf8", start, end), start);
    start = end + 1;
  }
}

function turnBytes(turn: Turn): number {
  return Buffer.byteLength(turn.kind === "tool-call" ? `${turn.name}${turn.args}` : turn.text);
}

function turnsOf(line: string): Turn[] {
  const message = messageOf(line);
  if (message === undefined || message.record["sourceEventType"] === "initial_prompt") return [];
  if (message.role === "user") {
    const text = userWordsOf(message);
    return text === undefined ? [] : [{ kind: "user", text }];
  }
  if (message.role === "toolResult") {
    const name = typeof message.message["toolName"] === "string" ? message.message["toolName"] : "tool";
    return [{ kind: "tool-result", name, failed: message.message["isError"] === true, ...clampToolResult(textOf(message.content)) }];
  }
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  const turns: Turn[] = [];
  for (const part of message.content) {
    if (!isRecord(part)) continue;
    const text = part["text"];
    const name = part["name"];
    if (part["type"] === "text" && typeof text === "string" && text.trim() !== "") {
      const last = turns.at(-1);
      if (last?.kind === "assistant") last.text = `${last.text}\n\n${text}`;
      else turns.push({ kind: "assistant", text });
    } else if (part["type"] === "toolCall" && typeof name === "string" && name !== "") {
      turns.push({ kind: "tool-call", name, args: argumentsPreview(part["arguments"]) });
    }
  }
  return turns;
}

function clampToolResult(text: string): { text: string; moreLines: number } {
  const lines = text.split("\n");
  let shown = lines.slice(0, TOOL_RESULT_LINES).join("\n");
  const cutInLine = shown.length > TOOL_RESULT_CHARS;
  if (cutInLine) shown = shown.slice(0, TOOL_RESULT_CHARS);
  const shownLines = shown.split("\n").length;
  return { text: cutInLine ? `${shown}…` : shown, moreLines: lines.length - shownLines };
}

/** The last `bytes` of a file as bytes, with where they start, so each line keeps its offset in the file. */
async function readTailBytes(path: string, bytes: number): Promise<{ buffer: Buffer; position: number; size: number } | undefined> {
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const position = size - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return { buffer: buffer.subarray(0, bytesRead), position, size };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
