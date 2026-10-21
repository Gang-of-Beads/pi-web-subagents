import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import type { PluginHostUi } from "@gang-of-beads/pi-web-plugin-api/plugin-api";
import type { NoteLine, RowControls } from "./runControls.js";

/** The host components an open row is built from; a host without them draws rows flat. */
export type RunControlsUi = Required<Pick<PluginHostUi, "renderButton" | "renderMessageField">>;

/**
 * The controls of an open running row: the Steer field with its send key, and Stop at the end
 * of that line; under it the note, on a phone and a desktop alike. Laid out here, in this
 * plugin's own shadow root, because raw markup in a row body gets only the host's base text
 * style. The steer draft lives in the host's field, so closing the row discards it.
 */
export class SubagentRunControls extends LitElement {
  @property({ attribute: false }) ui?: RunControlsUi;
  @property({ attribute: false }) controls: RowControls = "needs-newer-host";
  @property({ attribute: false }) agent = "subagent";
  @property({ attribute: false }) note?: NoteLine;
  @property({ attribute: false }) stopBusy = false;
  @property({ attribute: false }) onSteer?: (text: string) => Promise<boolean>;
  @property({ attribute: false }) onStop?: () => void;

  override render() {
    const drawings: Record<RowControls, () => unknown> = {
      "steer-and-stop": () => this.renderSteerAndStop(),
      "inside-reply": () => html`<p class="note">Runs inside the current reply; it stops with the session's Stop.</p>`,
      "needs-newer-host": () => html`<p class="note">Steer and Stop need a newer PI WEB on this machine.</p>`,
    };
    return drawings[this.controls]();
  }

  private renderSteerAndStop() {
    const ui = this.ui;
    if (ui === undefined) return null;
    const note = this.note;
    return html`
      <div class="steer">
        ${ui.renderMessageField({
          label: `Steer ${this.agent}`,
          placeholder: "Steer this subagent…",
          sendLabel: "Send steer",
          send: (text) => this.onSteer?.(text) ?? Promise.resolve(false),
        })}
        ${ui.renderButton({ label: "Stop", tone: "danger", busy: this.stopBusy, run: () => { this.onStop?.(); } })}
      </div>
      <p class="note ${note?.tone ?? "neutral"}" role="status">${note?.text ?? ""}</p>
    `;
  }

  static override styles = css`
    :host { display: flex; flex-direction: column; gap: var(--pi-space-3); }
    .steer { display: flex; align-items: center; gap: var(--pi-space-3); }
    .steer > :first-child { flex: 1 1 auto; min-width: 0; }
    .note { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: var(--pi-leading-normal); overflow-wrap: anywhere; }
    .note:empty { margin-top: calc(-1 * var(--pi-space-3)); }
    .note.attention { color: var(--pi-warning); }
    .note.problem { color: var(--pi-danger); }
  `;
}

export function defineRunControls(): void {
  if (customElements.get("subagent-run-controls") === undefined) customElements.define("subagent-run-controls", SubagentRunControls);
}

declare global {
  interface HTMLElementTagNameMap {
    "subagent-run-controls": SubagentRunControls;
  }
}
