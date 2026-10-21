import { LitElement, css, html, nothing, type CSSResultGroup, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { PluginHostUi } from "@gang-of-beads/pi-web-plugin-api/plugin-api";
import { conversationItems, type CallOutcome, type ConversationItem, type ConversationView } from "./runDetail.js";

/** The host pieces the conversation is drawn with; without showDialog and renderMarkdownHtml there is no Conversation row, and text styles are adopted when present. */
export interface ConversationUi {
  readonly renderMarkdownHtml: (markdown: string) => string;
  readonly textStyles: CSSResultGroup | undefined;
  readonly adoptSheets: PluginHostUi["adoptSheets"];
}

const BACK_ICON = html`<svg class="key-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 6l-6 6 6 6"></path></svg>`;
const REFRESH_ICON = html`<svg class="key-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>`;

/** The word at the end of a tool call's chip. */
function callSummary(outcome: CallOutcome): string {
  switch (outcome.kind) {
    case "running": return "running";
    case "no-result": return "no result";
    case "failed": return "failed";
    case "lines": return outcome.lines === 0 ? "no output" : `${String(outcome.lines)} ${outcome.lines === 1 ? "line" : "lines"}`;
  }
}

/**
 * A run's whole conversation in a full-screen dialog (option B, chat-shaped): the app bar
 * template (a back key, the centred title, a Refresh key for a run that was working when it
 * opened) over its own scroll view, opened at the newest turn. The reader's words are bubbles,
 * the agent's text is bare formatted text, each tool call is a one-line chip saying how it
 * ended, and only a failed result is shown open under its chip. It is a snapshot of when it
 * opened, and says when that was for a working run.
 */
export class SubagentConversation extends LitElement {
  @property({ attribute: false }) ui?: ConversationUi;
  @property({ attribute: false }) agent = "subagent";
  @property({ attribute: false }) view: ConversationView = { kind: "failed" };
  @property({ attribute: false }) refresh?: () => Promise<ConversationView>;
  @property({ attribute: false }) close?: () => void;

  @state() private refreshing = false;
  @state() private readAt = new Date();

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("view")) this.readAt = new Date();
    const ui = this.ui;
    if (!changed.has("ui") || ui?.textStyles === undefined || !(this.renderRoot instanceof ShadowRoot)) return;
    ui.adoptSheets?.(this.renderRoot, [ui.textStyles]);
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has("view")) return;
    const scroller = this.renderRoot.querySelector(".scroll");
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
  }

  override render() {
    const ui = this.ui;
    if (ui === undefined) return nothing;
    const view = this.view;
    const refresh = this.refresh;
    const heading = `${this.agent} · conversation`;
    return html`
      <header>
        <button class="key" type="button" aria-label="Back" title="Back" @click=${() => { this.close?.(); }}>${BACK_ICON}</button>
        <h2 class="title">${heading}</h2>
        ${refresh === undefined
          ? html`<span class="key-space"></span>`
          : html`<button class="key" type="button" aria-label="Refresh" title="Refresh" aria-busy=${this.refreshing ? "true" : "false"} ?disabled=${this.refreshing} @click=${() => { void this.refreshNow(refresh); }}>${REFRESH_ICON}</button>`}
      </header>
      <div class="scroll" role="log" aria-label=${heading}>
        <div class="column">${this.renderBody(ui, view, refresh !== undefined)}</div>
      </div>
    `;
  }

  private async refreshNow(refresh: () => Promise<ConversationView>): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.view = await refresh();
    } finally {
      this.refreshing = false;
    }
  }

  private renderBody(ui: ConversationUi, view: ConversationView, running: boolean) {
    if (view.kind === "failed") return html`<p class="note problem">Could not read this run.${view.words === undefined ? "" : ` ${view.words}`}</p>`;
    if (view.kind === "refused") return html`<p class="note">${view.words}</p>`;
    const snapshot = running ? `snapshot at ${this.readAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : undefined;
    const line = [view.cut, snapshot].filter((part) => part !== undefined).join(" · ");
    return html`
      ${line === "" ? nothing : html`<p class="cut">${line}</p>`}
      ${view.turns.length === 0
        ? html`<p class="note">No messages recorded yet.</p>`
        : conversationItems(view.turns, running).map((item) => this.renderItem(ui, item))}
    `;
  }

  private renderItem(ui: ConversationUi, item: ConversationItem) {
    switch (item.kind) {
      case "user": return html`<div class="bubble">${item.steer ? html`<span class="who">steer</span>` : nothing}<p class="plain">${item.text}</p></div>`;
      case "assistant": return html`<div class="agent"><span class="who">${this.agent}</span><div class="formatted">${unsafeHTML(ui.renderMarkdownHtml(item.text))}</div></div>`;
      case "call": return html`
        <div class="call ${item.outcome.kind}">
          <span class="name">→ ${item.name}</span><span class="args">${item.args}</span><span class="sum">${callSummary(item.outcome)}</span>
        </div>
        ${item.outcome.kind === "failed" && item.outcome.text.trim() !== "" ? html`<pre class="peek">${item.outcome.text}${item.outcome.moreLines > 0 ? `\n… ${String(item.outcome.moreLines)} more ${item.outcome.moreLines === 1 ? "line" : "lines"}` : ""}</pre>` : nothing}`;
    }
  }

  static override styles = css`
    :host(subagent-conversation) { box-sizing: border-box; display: flex; flex-direction: column; flex: 1 1 auto; height: 100%; min-height: 0; min-width: 0; padding-bottom: env(safe-area-inset-bottom); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); }
    header { box-sizing: border-box; flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-4); min-height: var(--pi-panel-header-height, 44px); padding-inline: var(--pi-bar-inset, var(--pi-space-4)); border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    .title { flex: 1 1 auto; min-width: 0; margin: 0; overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); line-height: var(--pi-panel-header-control-height, 36px); }
    .key, .key-space { box-sizing: border-box; flex: 0 0 auto; width: var(--pi-panel-header-control-height, 36px); height: var(--pi-panel-header-control-height, 36px); }
    .key { position: relative; display: inline-grid; place-items: center; padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .key:disabled { cursor: progress; opacity: var(--pi-disabled-opacity); }
    .key:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight, 1px); }
    @media (pointer: coarse) { .key::after { content: ""; position: absolute; inset: -5px; } }
    .key-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .scroll { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: var(--pi-space-6) var(--pi-chat-gutter, var(--pi-space-4)); }
    .column { box-sizing: border-box; display: flex; flex-direction: column; gap: var(--pi-space-5); width: 100%; max-width: 760px; margin: auto auto 0; min-width: 0; font-size: var(--pi-text-base); line-height: var(--pi-leading-normal); }
    .cut { align-self: center; margin: 0; color: var(--pi-dim); font-size: var(--pi-text-xs); text-align: center; }
    .bubble { box-sizing: border-box; align-self: flex-end; max-width: 85%; min-width: 0; padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-msg-user-border, var(--pi-border)); border-radius: var(--pi-radius-lg); background: var(--pi-msg-user-bg, var(--pi-surface-raised)); overflow-wrap: anywhere; }
    .who { display: block; margin-bottom: var(--pi-space-1); color: var(--pi-text-secondary); font: var(--pi-text-2xs) var(--pi-font-mono); }
    .agent { min-width: 0; }
    .agent .who { margin-bottom: var(--pi-space-2); color: var(--pi-muted); }
    .plain { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .call { box-sizing: border-box; display: flex; align-items: center; gap: var(--pi-space-4); min-width: 0; padding: var(--pi-space-3) var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text-secondary); font: var(--pi-text-xs) var(--pi-font-mono); }
    .call .name { flex: 0 0 auto; color: var(--pi-muted); }
    .call .args { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .call .sum { flex: 0 0 auto; color: var(--pi-dim); font-family: var(--pi-font-ui); }
    .call.failed .sum { color: var(--pi-danger); }
    .call.running { border-color: var(--pi-success-border, var(--pi-border)); background: var(--pi-success-bg, var(--pi-surface)); }
    .call.running .name, .call.running .sum { color: var(--pi-success); }
    .call.running::before { content: ""; flex: 0 0 auto; width: var(--pi-dot-md); height: var(--pi-dot-md); border-radius: 50%; background: var(--pi-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pi-success) 33%, transparent); }
    pre.peek { box-sizing: border-box; max-width: 100%; margin: calc(-1 * var(--pi-space-2)) 0 0 var(--pi-space-6); padding: var(--pi-space-3) var(--pi-space-5); border: 0; border-left: 2px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text-secondary); font: var(--pi-text-xs) var(--pi-font-mono); line-height: var(--pi-leading-normal); white-space: pre-wrap; overflow-wrap: anywhere; }
    .note { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .problem { color: var(--pi-danger); }
  `;
}

export function defineConversation(): void {
  if (customElements.get("subagent-conversation") === undefined) customElements.define("subagent-conversation", SubagentConversation);
}

declare global {
  interface HTMLElementTagNameMap {
    "subagent-conversation": SubagentConversation;
  }
}
