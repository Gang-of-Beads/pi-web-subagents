import { formatElapsed, runPresentation, type SubagentRunRow } from "./runRows.js";
import type { NoteLine } from "./runControls.js";

/**
 * What an opened row shows beyond the list's own facts, read from `runs.detail`, and the
 * whole conversation read from `runs.conversation`. Each answer is checked field by field:
 * a newer server half may add fields, and one this plugin cannot read is not shown as if
 * it were empty.
 */

/** Some text the server read, and whether it cut it. */
export interface TextRead {
  readonly text: string;
  readonly totalBytes: number;
  readonly truncated: boolean;
}

/** Why a piece is missing: never recorded where this machine can read it, never written, or unreadable. */
export type Absence = "not-recorded" | "not-written" | "unreadable";

export type TextOrAbsent = TextRead | { readonly absent: Absence };

export interface RunFacts {
  readonly model?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  /** Cache read plus cache write. */
  readonly tokensCached?: number;
  readonly cost?: number;
  readonly turns?: number;
  readonly durationMs?: number;
}

/** How many messages the Conversation draws from; `truncated` when the server counted only the newest part. */
export interface MessageCount {
  readonly count: number;
  readonly truncated: boolean;
}

export interface RunDetail {
  readonly task: TextOrAbsent;
  /** Absent while the run works: it has no result yet. */
  readonly result?: TextOrAbsent;
  readonly facts: RunFacts;
  /** A failed run's whole error. */
  readonly error?: string;
  /** Absent from an older server half, or when no transcript could be read. */
  readonly messages?: MessageCount;
}

/** A read of one run as the opened row holds it, under the status it was read for. */
export type DetailView =
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly words?: string }
  | { readonly kind: "refused"; readonly words: string }
  | { readonly kind: "detail"; readonly detail: RunDetail };

type RunRefusal = "no-session" | "no-run" | "not-this-session" | "no-transcript";

const REFUSAL_WORDS: Readonly<Record<RunRefusal, string>> = {
  "no-session": "No session is open on this page.",
  "no-run": "This session's runs no longer include this one.",
  "not-this-session": "This run belongs to another session.",
  "no-transcript": "This machine has no conversation recorded for this run.",
};

const UNREADABLE = "This machine could not read this run.";

function isRunRefusal(reason: unknown): reason is RunRefusal {
  return typeof reason === "string" && Object.hasOwn(REFUSAL_WORDS, reason);
}

function refusalWords(answer: object): string {
  const reason: unknown = Reflect.get(answer, "reason");
  return isRunRefusal(reason) ? REFUSAL_WORDS[reason] : UNREADABLE;
}

/** What `runs.detail` answered: the detail, a stated refusal, or failed when the answer cannot be read. */
export function detailViewOf(answer: unknown): DetailView {
  if (typeof answer !== "object" || answer === null) return { kind: "failed" };
  if (Reflect.get(answer, "known") !== true) return { kind: "refused", words: refusalWords(answer) };
  const task = textOrAbsentOf(Reflect.get(answer, "task"));
  if (task === undefined) return { kind: "failed" };
  const result = textOrAbsentOf(Reflect.get(answer, "result"));
  const error: unknown = Reflect.get(answer, "error");
  const messages = messageCountOf(Reflect.get(answer, "messages"));
  return {
    kind: "detail",
    detail: {
      task,
      ...(result === undefined ? {} : { result }),
      facts: factsOf(Reflect.get(answer, "facts")),
      ...(typeof error === "string" && error !== "" ? { error } : {}),
      ...(messages === undefined ? {} : { messages }),
    },
  };
}

function messageCountOf(value: unknown): MessageCount | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const count: unknown = Reflect.get(value, "count");
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? { count, truncated: Reflect.get(value, "truncated") === true } : undefined;
}

/** "212 messages", "at least 212 messages", and "so far" while the run works: the count as the row read it. */
export function messageCountWords(messages: MessageCount, running: boolean): string {
  const counted = `${String(messages.count)} ${messages.count === 1 ? "message" : "messages"}`;
  return `${messages.truncated ? `at least ${counted}` : counted}${running ? " so far" : ""}`;
}

function textOrAbsentOf(value: unknown): TextOrAbsent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const absent: unknown = Reflect.get(value, "absent");
  if (absent === "not-recorded" || absent === "not-written" || absent === "unreadable") return { absent };
  const text: unknown = Reflect.get(value, "text");
  const totalBytes: unknown = Reflect.get(value, "totalBytes");
  const truncated: unknown = Reflect.get(value, "truncated");
  if (typeof text !== "string") return undefined;
  return { text, totalBytes: typeof totalBytes === "number" ? totalBytes : text.length, truncated: truncated === true };
}

function factsOf(value: unknown): RunFacts {
  if (typeof value !== "object" || value === null) return {};
  const number = (key: string): number | undefined => {
    const field: unknown = Reflect.get(value, key);
    return typeof field === "number" && Number.isFinite(field) ? field : undefined;
  };
  const model: unknown = Reflect.get(value, "model");
  const tokensIn = number("tokensIn");
  const tokensOut = number("tokensOut");
  const tokensCached = number("tokensCached");
  const cost = number("cost");
  const turns = number("turns");
  const durationMs = number("durationMs");
  return {
    ...(typeof model === "string" && model !== "" ? { model } : {}),
    ...(tokensIn === undefined ? {} : { tokensIn }),
    ...(tokensOut === undefined ? {} : { tokensOut }),
    ...(tokensCached === undefined ? {} : { tokensCached }),
    ...(cost === undefined ? {} : { cost }),
    ...(turns === undefined ? {} : { turns }),
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

/** One token count a reader can take in at a glance: `212`, `111k`, `18.9M`. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 999_500) return `${String(Math.round(count / 1000))}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function byteSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** One muted line: model, tokens, cost, turns, duration and the outcome; a part with no value is left out. */
export function factsLine(facts: RunFacts, outcome: string): string {
  const parts = [
    facts.model,
    facts.tokensIn === undefined ? undefined : `${formatTokens(facts.tokensIn)} in`,
    facts.tokensOut === undefined ? undefined : `${formatTokens(facts.tokensOut)} out`,
    facts.tokensCached === undefined ? undefined : `${formatTokens(facts.tokensCached)} cached`,
    facts.cost === undefined ? undefined : `$${facts.cost.toFixed(2)}`,
    facts.turns === undefined ? undefined : `${String(facts.turns)} ${facts.turns === 1 ? "turn" : "turns"}`,
    facts.durationMs === undefined ? undefined : formatElapsed(facts.durationMs),
    outcome,
  ];
  return parts.filter((part) => part !== undefined && part !== "").join(" · ");
}

/** "Showing the first 64 KiB of 80 KiB." when the server cut the text, otherwise nothing. */
export function firstPartWords(read: TextRead): string | undefined {
  return read.truncated ? `Showing the first ${byteSize(new TextEncoder().encode(read.text).length)} of ${byteSize(read.totalBytes)}.` : undefined;
}

type OutcomeKind = "none" | "failed" | "stopped-here" | "stopped" | "lost" | "unknown";

/** Which outcome line an opened finished row carries; Done and Working carry none. */
function outcomeKind(status: SubagentRunRow["status"], stoppedHere: boolean): OutcomeKind {
  if (status === "stopped") return stoppedHere ? "stopped-here" : "stopped";
  if (status === "failed" || status === "lost" || status === "unknown") return status;
  return "none";
}

const OUTCOME_LINES: Readonly<Record<OutcomeKind, (row: SubagentRunRow, error: string | undefined, now: number) => NoteLine | undefined>> = {
  none: () => undefined,
  failed: (_row, error) => ({ text: error ?? "It failed without saying why.", tone: "problem" }),
  "stopped-here": () => ({ text: "Stopped from this page.", tone: "neutral" }),
  stopped: () => ({ text: "Stopped.", tone: "neutral" }),
  lost: (row, _error, now) => ({
    text: `${runPresentation(row, now).detail}.${row.lastActivity === undefined ? "" : ` Its last step: ${row.lastActivity}`}`,
    tone: "problem",
  }),
  unknown: () => ({ text: "This machine has no outcome for it.", tone: "neutral" }),
};

/**
 * The line under a finished run's result that says how it ended, when Done does not. A Stop
 * this device sent says so; a stop by the parent agent or a workflow is just "Stopped.".
 */
export function outcomeLine(row: SubagentRunRow, error: string | undefined, stoppedHere: boolean, now: number): NoteLine | undefined {
  return OUTCOME_LINES[outcomeKind(row.status, stoppedHere)](row, error ?? row.error, now);
}

/** "41s ago", "3m ago", "2h ago": how long since the step, on this page's clock. */
export function formatAgo(at: string | undefined, now: number): string | undefined {
  const ms = at === undefined ? Number.NaN : now - Date.parse(at);
  if (!Number.isFinite(ms)) return undefined;
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  return `${String(Math.floor(minutes / 60))}h ago`;
}

export type ConversationTurn =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "assistant"; readonly text: string }
  | { readonly kind: "tool-call"; readonly name: string; readonly args: string }
  | { readonly kind: "tool-result"; readonly name: string; readonly text: string; readonly moreLines: number; readonly failed: boolean };

/** `words` is the host's account of a failed request, e.g. an operation an older server half does not have. */
export type ConversationView =
  | { readonly kind: "failed"; readonly words?: string }
  | { readonly kind: "refused"; readonly words: string }
  | { readonly kind: "conversation"; readonly turns: readonly ConversationTurn[]; readonly cut: string | undefined };

/** What `runs.conversation` answered, with the line that says how much is shown when the server cut it. */
export function conversationViewOf(answer: unknown): ConversationView {
  if (typeof answer !== "object" || answer === null) return { kind: "failed" };
  if (Reflect.get(answer, "known") !== true) return { kind: "refused", words: refusalWords(answer) };
  const raw: unknown = Reflect.get(answer, "turns");
  if (!Array.isArray(raw)) return { kind: "failed" };
  const turns: ConversationTurn[] = [];
  for (const value of raw) {
    const turn = turnOf(value);
    if (turn !== undefined) turns.push(turn);
  }
  const totalBytes: unknown = Reflect.get(answer, "totalBytes");
  const shownBytes: unknown = Reflect.get(answer, "shownBytes");
  const cut = Reflect.get(answer, "truncated") === true && typeof totalBytes === "number" && typeof shownBytes === "number"
    ? `Showing the last ${byteSize(shownBytes)} of ${byteSize(totalBytes)}`
    : undefined;
  return { kind: "conversation", turns, cut };
}

function turnOf(value: unknown): ConversationTurn | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const kind: unknown = Reflect.get(value, "kind");
  const text: unknown = Reflect.get(value, "text");
  const name: unknown = Reflect.get(value, "name");
  if ((kind === "user" || kind === "assistant") && typeof text === "string") return { kind, text };
  if (kind === "tool-call" && typeof name === "string") {
    const args: unknown = Reflect.get(value, "args");
    return { kind, name, args: typeof args === "string" ? args : "" };
  }
  if (kind === "tool-result" && typeof name === "string" && typeof text === "string") {
    const moreLines: unknown = Reflect.get(value, "moreLines");
    return { kind, name, text, moreLines: typeof moreLines === "number" ? moreLines : 0, failed: Reflect.get(value, "failed") === true };
  }
  return undefined;
}

/** How a tool call ended, as its one-line chip says it. */
export type CallOutcome =
  | { readonly kind: "running" }
  | { readonly kind: "no-result" }
  | { readonly kind: "failed"; readonly text: string; readonly moreLines: number }
  | { readonly kind: "lines"; readonly lines: number };

/** What the Conversation draws: the reader's words, the agent's text, and each tool call with how it ended. */
export type ConversationItem =
  | { readonly kind: "user"; readonly text: string; readonly steer: boolean }
  | { readonly kind: "assistant"; readonly text: string }
  | { readonly kind: "call"; readonly name: string; readonly args: string; readonly outcome: CallOutcome };

interface OpenCall {
  readonly name: string;
  readonly args: string;
  outcome: CallOutcome | undefined;
}

/**
 * The turns as the Conversation draws them. Each tool result joins the oldest open call of its
 * tool (calls made together answer in turn), a result with no open call of its tool (its call
 * was cut off, or named no tool) stands as its own chip, and a call with no result is the live
 * step while the run works. The first user message shown is the task (or, once the start is cut
 * off, the oldest words kept) and later ones are steering.
 */
export function conversationItems(turns: readonly ConversationTurn[], running: boolean): ConversationItem[] {
  const items: (ConversationItem | OpenCall)[] = [];
  const open: OpenCall[] = [];
  let users = 0;
  for (const turn of turns) {
    if (turn.kind === "user") items.push({ kind: "user", text: turn.text, steer: users++ > 0 });
    else if (turn.kind === "assistant") items.push({ kind: "assistant", text: turn.text });
    else if (turn.kind === "tool-call") {
      const call: OpenCall = { name: turn.name, args: turn.args, outcome: undefined };
      open.push(call);
      items.push(call);
    } else {
      const index = open.findIndex((call) => call.name === turn.name);
      const call = index === -1 ? undefined : open.splice(index, 1)[0];
      const outcome = callOutcomeOf(turn);
      if (call === undefined) items.push({ name: turn.name, args: "", outcome });
      else call.outcome = outcome;
    }
  }
  const unanswered: CallOutcome = { kind: running ? "running" : "no-result" };
  return items.map((item) => ("kind" in item ? item : { kind: "call", name: item.name, args: item.args, outcome: item.outcome ?? unanswered }));
}

function callOutcomeOf(result: Extract<ConversationTurn, { kind: "tool-result" }>): CallOutcome {
  if (result.failed) return { kind: "failed", text: result.text, moreLines: result.moreLines };
  return { kind: "lines", lines: (result.text === "" ? 0 : result.text.split("\n").length) + result.moreLines };
}
