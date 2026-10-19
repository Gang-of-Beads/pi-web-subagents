import type { PluginSessionCommandOutcome } from "@gang-of-beads/pi-web-plugin-api/plugin-api";
import type { RunControl } from "./runRows.js";

/**
 * What an open running row offers, and what its note says after Steer or Stop.
 *
 * Both act through the extension's own commands, as typing them would:
 * `/subagents-steer <run-id> <words>` and `/subagents-stop <run-id>`. The
 * extension stops and steers only runs it holds detached; a run inside the
 * parent's reply ends with that reply, so its row offers neither and says so.
 * A run nobody can place shows both, and the extension's own answer speaks.
 */
export type RowControls = "steer-and-stop" | "inside-reply" | "needs-newer-host";

export function rowControls(control: RunControl, canRunCommands: boolean): RowControls {
  if (control === "foreground") return "inside-reply";
  return canRunCommands ? "steer-and-stop" : "needs-newer-host";
}

export type RunCommandName = "steer" | "stop";

/** The extension command each control sends, by its invocation name. */
export const RUN_COMMANDS: Readonly<Record<RunCommandName, string>> = { steer: "subagents-steer", stop: "subagents-stop" };

/**
 * The last command this device sent for one run. `listAtAnswer` is the list read
 * on screen when the answer came, so a quiet Stop can tell whether a read since
 * still shows the run working.
 */
export type RunNote =
  | { readonly kind: "pending"; readonly command: RunCommandName }
  | { readonly kind: "answered"; readonly command: RunCommandName; readonly outcome: PluginSessionCommandOutcome; readonly listAtAnswer: unknown };

export type NoteTone = "neutral" | "attention" | "problem";

export interface NoteLine {
  readonly text: string;
  readonly tone: NoteTone;
}

type NoteState = "stopping" | "sending" | "said" | "steer-sent" | "stop-ran" | "stop-ran-still-running" | "refused" | "waiting" | "unknown";

/**
 * One state per thing the note can mean. A command that ran and said nothing
 * claims no success for Stop: the note waits for a list read, and a read that
 * still shows the run working says so. A Steer that ran without an error was
 * taken by the extension, which is all the field needs to clear.
 */
function noteState(note: RunNote, listNow: unknown): NoteState {
  if (note.kind === "pending") return note.command === "stop" ? "stopping" : "sending";
  const outcome = note.outcome;
  if (outcome.kind === "ran") {
    if (outcome.notices.length > 0) return "said";
    if (note.command === "steer") return "steer-sent";
    return listNow === note.listAtAnswer ? "stop-ran" : "stop-ran-still-running";
  }
  if (outcome.kind === "refused") return "refused";
  if (outcome.kind === "waiting") return "waiting";
  return "unknown";
}

const NOTICE_TONE: Readonly<Record<"info" | "warning" | "error", NoteTone>> = { info: "neutral", warning: "attention", error: "problem" };

const NOTE_LINES: Readonly<Record<NoteState, (note: RunNote, agent: string) => NoteLine>> = {
  stopping: () => ({ text: "Stopping…", tone: "neutral" }),
  sending: () => ({ text: "Sending…", tone: "neutral" }),
  said: (note) => {
    const notices = note.kind === "answered" && note.outcome.kind === "ran" ? note.outcome.notices : [];
    const last = notices.at(-1);
    return last === undefined ? { text: "", tone: "neutral" } : { text: last.message, tone: NOTICE_TONE[last.level] ?? "neutral" };
  },
  "steer-sent": (_note, agent) => ({ text: `Sent to ${agent}.`, tone: "neutral" }),
  "stop-ran": () => ({ text: "Stopping…", tone: "neutral" }),
  "stop-ran-still-running": () => ({ text: "The command ran; the run still reads running.", tone: "attention" }),
  refused: (note) => ({ text: note.kind === "answered" && note.outcome.kind === "refused" ? note.outcome.words : "", tone: "problem" }),
  waiting: () => ({ text: "No answer yet from the session; the list shows what happened.", tone: "attention" }),
  unknown: () => ({ text: "No answer from the machine; the list shows what happened.", tone: "attention" }),
};

export function noteLine(note: RunNote, listNow: unknown, agent: string): NoteLine {
  return NOTE_LINES[noteState(note, listNow)](note, agent);
}

/** Whether the extension took the steer: the field clears only then, and keeps the words otherwise. */
export function steerTaken(outcome: PluginSessionCommandOutcome): boolean {
  return outcome.kind === "ran" && !outcome.notices.some((notice) => notice.level === "error");
}

/** Whether Stop is in flight for this run: its button is busy until the answer. */
export function stopPending(note: RunNote | undefined): boolean {
  return note?.kind === "pending" && note.command === "stop";
}
