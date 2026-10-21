import { LitElement, css, html, nothing, unsafeCSS, type CSSResultGroup, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { PluginHostUi } from "@gang-of-beads/pi-web-plugin-api/plugin-api";
import { factsLine, firstPartWords, formatAgo, messageCountWords, outcomeLine, type DetailView, type MessageCount, type RunFacts, type TextOrAbsent } from "./runDetail.js";
import { runPresentation, type SubagentRunRow } from "./runRows.js";

/**
 * The host pieces an opened row is drawn with. `renderButton` is what makes a row open at all;
 * markdown, its styles, the desktop line and the list's chevron are used when this host has them.
 */
export interface RunDetailUi {
  readonly renderButton: NonNullable<PluginHostUi["renderButton"]>;
  readonly renderMarkdownHtml: ((markdown: string) => string) | undefined;
  readonly textStyles: CSSResultGroup | undefined;
  readonly adoptSheets: PluginHostUi["adoptSheets"];
  readonly desktopQuery: string | undefined;
  readonly chevron: TemplateResult | undefined;
}

/** Opens the run's whole conversation; absent where this host cannot show it. `failed` says why the last open showed nothing. */
export interface ConversationButton {
  readonly busy: boolean;
  readonly failed: string | undefined;
  readonly open: () => void;
}

const ABSENT_WORDS: Readonly<Record<"task" | "result", Readonly<Record<"not-recorded" | "not-written" | "unreadable", string>>>> = {
  task: { "not-recorded": "Not recorded where this machine can read it.", "not-written": "Not recorded where this machine can read it.", unreadable: "Could not read the task." },
  result: { "not-recorded": "The run wrote no result.", "not-written": "The run wrote no result.", unreadable: "Could not read the result." },
};

/**
 * The body of an opened row, shaped as a small conversation (option B, chat-shaped): the task
 * in the reader's own tinted bubble, then for a running run its latest step as a live line and
 * the controls (slotted in by the panel), and for a finished one its result as bare formatted
 * text, how it ended, its facts. Last, Conversation as a full-width row that navigates, with
 * how many messages it holds. Long task and result text is clamped with Show all, which opens
 * it in place.
 */
export class SubagentRunDetail extends LitElement {
  @property({ attribute: false }) ui?: RunDetailUi;
  @property({ attribute: false }) row?: SubagentRunRow;
  @property({ attribute: false }) read: DetailView = { kind: "reading" };
  @property({ attribute: false }) stoppedHere = false;
  @property({ attribute: false }) now = 0;
  @property({ attribute: false }) conversation?: ConversationButton;
  @property({ attribute: false }) onReadAgain?: () => void;

  @state() private taskOpen = false;
  @state() private resultOpen = false;
  @state() private taskOverflows = false;
  @state() private resultOverflows = false;
  private markdown: { readonly source: string; readonly html: string } | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    const ui = this.ui;
    if (!changed.has("ui") || ui === undefined || !(this.renderRoot instanceof ShadowRoot)) return;
    ui.adoptSheets?.(this.renderRoot, [
      ...(ui.textStyles === undefined ? [] : [ui.textStyles]),
      ...(ui.desktopQuery === undefined ? [] : [css`@media ${unsafeCSS(ui.desktopQuery)} { :host { --subagent-result-lines: 24; } }`]),
    ]);
  }

  protected override updated(): void {
    if (!this.taskOpen) this.taskOverflows = this.overflows(".task");
    if (!this.resultOpen) this.resultOverflows = this.overflows(".result");
  }

  private overflows(selector: string): boolean {
    const element = this.renderRoot.querySelector(selector);
    return element !== null && element.scrollHeight > element.clientHeight + 1;
  }

  override render() {
    const ui = this.ui;
    const row = this.row;
    if (ui === undefined || row === undefined) return nothing;
    const read = this.read;
    const detail = read.kind === "detail" ? read.detail : undefined;
    const running = row.status === "running";
    return html`
      ${this.renderReadState(ui)}
      ${this.renderTask(ui, detail?.task)}
      ${running ? this.renderRunning(row) : this.renderFinished(ui, row, detail?.result, detail?.error, detail?.facts ?? { durationMs: row.elapsedMs })}
      ${this.renderConversation(ui, detail?.messages, running)}
    `;
  }

  private renderReadState(ui: RunDetailUi) {
    const read = this.read;
    if (read.kind === "refused") return html`<p class="muted">${read.words}</p>`;
    if (read.kind !== "failed") return nothing;
    return html`<div class="actions start"><p class="problem grow">Could not read this run.${read.words === undefined ? "" : ` ${read.words}`}</p>${ui.renderButton({ label: "Read again", run: () => { this.onReadAgain?.(); } })}</div>`;
  }

  private renderTask(ui: RunDetailUi, task: TextOrAbsent | undefined) {
    if (task === undefined) return html`<p class="muted">${this.read.kind === "reading" ? "Reading…" : "Not known."}</p>`;
    if ("absent" in task) return html`<p class="muted">${ABSENT_WORDS.task[task.absent]}</p>`;
    const cut = firstPartWords(task);
    return html`
      <div class="ask"><span class="who">task</span><p class="text task ${this.taskOpen ? "" : "clamped"}">${task.text}</p></div>
      ${this.renderToggle(ui, this.taskOpen, this.taskOverflows, () => { this.taskOpen = !this.taskOpen; })}
      ${cut === undefined || !this.taskOpen ? nothing : html`<p class="muted">${cut}</p>`}
    `;
  }

  private renderToggle(ui: RunDetailUi, open: boolean, overflows: boolean, toggle: () => void) {
    if (!open && !overflows) return nothing;
    return html`<div class="after">${ui.renderButton({ label: open ? "Show less" : "Show all", run: toggle })}</div>`;
  }

  private renderRunning(row: SubagentRunRow) {
    const ago = formatAgo(row.lastActivityAt, this.now);
    return html`
      <div class="live">
        <p class=${row.lastActivity === undefined ? "muted" : "step"}>${row.lastActivity ?? "No step recorded yet."}</p>
        ${ago === undefined ? nothing : html`<p class="when">${ago}</p>`}
      </div>
      <slot></slot>
    `;
  }

  private renderFinished(ui: RunDetailUi, row: SubagentRunRow, result: TextOrAbsent | undefined, error: string | undefined, facts: RunFacts) {
    const presentation = runPresentation(row, this.now);
    const outcome = outcomeLine(row, error, this.stoppedHere, this.now);
    return html`
      ${this.renderResult(ui, result)}
      ${outcome === undefined ? nothing : html`<p class="outcome ${outcome.tone}">${outcome.text}</p>`}
      <p class="muted facts">${factsLine(facts, presentation.label)}</p>
    `;
  }

  private renderResult(ui: RunDetailUi, result: TextOrAbsent | undefined) {
    if (result === undefined) return html`<p class="muted">${this.read.kind === "reading" ? "Reading…" : "Not known."}</p>`;
    if ("absent" in result) return html`<p class="muted">${ABSENT_WORDS.result[result.absent]}</p>`;
    const cut = firstPartWords(result);
    const body = ui.renderMarkdownHtml === undefined
      ? html`<p class="text">${result.text}</p>`
      : html`<div class="formatted">${unsafeHTML(this.markdownHtml(ui.renderMarkdownHtml, result.text))}</div>`;
    return html`
      <div class="result ${this.resultOpen ? "" : "clamped"}">${body}</div>
      ${this.renderToggle(ui, this.resultOpen, this.resultOverflows, () => { this.resultOpen = !this.resultOpen; })}
      ${cut === undefined ? nothing : html`<p class="muted">${cut}</p>`}
    `;
  }

  private renderConversation(ui: RunDetailUi, messages: MessageCount | undefined, running: boolean) {
    const conversation = this.conversation;
    if (conversation === undefined) return nothing;
    const failed = conversation.busy ? undefined : conversation.failed;
    const count = conversation.busy ? "Opening…" : failed ?? (messages === undefined ? "" : messageCountWords(messages, running));
    return html`<button class="nav" type="button" aria-busy=${conversation.busy ? "true" : "false"} ?disabled=${conversation.busy} @click=${conversation.open}>
      <span class="name">Conversation</span><span class="count ${failed === undefined ? "" : "problem"}">${count}</span>${ui.chevron ?? nothing}
    </button>`;
  }

  /** The list redraws every few seconds; the same result is rendered to HTML once. */
  private markdownHtml(render: (markdown: string) => string, source: string): string {
    if (this.markdown?.source !== source) this.markdown = { source, html: render(source) };
    return this.markdown.html;
  }

  static override styles = css`
    :host(subagent-run-detail) { display: flex; flex-direction: column; gap: var(--pi-space-5); min-width: 0; overflow-wrap: anywhere; }
    .ask { padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-msg-user-border, var(--pi-border)); border-radius: var(--pi-radius-lg); background: var(--pi-msg-user-bg, var(--pi-surface-raised)); line-height: var(--pi-leading-normal); }
    .who { display: block; margin-bottom: var(--pi-space-1); color: var(--pi-text-secondary); font: var(--pi-text-2xs) var(--pi-font-mono); }
    .text { margin: 0; color: var(--pi-text); white-space: pre-wrap; overflow-wrap: anywhere; }
    .task.clamped { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; }
    .after { display: flex; justify-content: flex-end; margin-top: calc(-1 * var(--pi-space-2)); }
    .live { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--pi-space-1) var(--pi-space-4); align-items: baseline; }
    .live::before { content: ""; width: var(--pi-dot-md); height: var(--pi-dot-md); border-radius: 50%; background: var(--pi-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pi-success) 33%, transparent); transform: translateY(-1px); }
    .step { margin: 0; color: var(--pi-text-secondary); font: var(--pi-text-xs) var(--pi-font-mono); line-height: var(--pi-leading-normal); overflow-wrap: anywhere; }
    .when { grid-column: 2; margin: 0; color: var(--pi-dim); font-size: var(--pi-text-xs); }
    .result { min-width: 0; }
    .result.clamped { max-height: calc(var(--subagent-result-lines, 14) * 1.45em); overflow: hidden; -webkit-mask-image: linear-gradient(to bottom, #000 75%, transparent); mask-image: linear-gradient(to bottom, #000 75%, transparent); }
    .muted { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: var(--pi-leading-normal); overflow-wrap: anywhere; }
    .facts { font-variant-numeric: tabular-nums; }
    .outcome { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--pi-text); }
    .outcome.problem { padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-danger); border-radius: var(--pi-radius-md); font: var(--pi-text-xs) var(--pi-font-mono); line-height: var(--pi-leading-normal); }
    .outcome.problem, .problem { color: var(--pi-danger); }
    .problem { margin: 0; }
    .grow { flex: 1 1 12rem; min-width: 0; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--pi-space-4); }
    .actions.start { justify-content: flex-start; }
    .nav { box-sizing: border-box; display: flex; align-items: center; gap: var(--pi-space-4); width: calc(100% + 2 * var(--pi-space-5)); min-height: var(--pi-control-height-touch); margin: 0 calc(-1 * var(--pi-space-5)) calc(-1 * var(--pi-space-5)); padding: 0 var(--pi-space-5); border: 0; border-top: 1px solid var(--pi-border-muted); background: transparent; color: var(--pi-text); font: inherit; text-align: start; cursor: pointer; }
    .nav:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: calc(-1 * var(--pi-focus-ring-width)); }
    .nav:disabled { cursor: progress; }
    .nav .name { font-weight: var(--pi-weight-medium); }
    .nav .count { flex: 1 1 auto; min-width: 0; color: var(--pi-dim); font-size: var(--pi-text-xs); }
    .nav .count.problem { color: var(--pi-danger); }
    .nav .disclosure-icon { color: var(--pi-muted); }
  `;
}

export function defineRunDetail(): void {
  if (customElements.get("subagent-run-detail") === undefined) customElements.define("subagent-run-detail", SubagentRunDetail);
}

declare global {
  interface HTMLElementTagNameMap {
    "subagent-run-detail": SubagentRunDetail;
  }
}
