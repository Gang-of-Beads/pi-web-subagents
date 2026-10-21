import type { HtmlTemplateTag, PiWebPlugin, PluginActivationContext, PluginRowExpansion, PluginSessionCommandOutcome, WorkspacePanelContext } from "@gang-of-beads/pi-web-plugin-api/plugin-api";
import { subagentListModel, type RunExpansionOf, type SubagentListState, type SubagentRunRow } from "./runRows.js";
import { noteLine, rowControls, RUN_COMMANDS, steerTaken, stopPending, type RunCommandName, type RunNote } from "./runControls.js";
import { defineRunControls, type RunControlsUi } from "./runControlsElement.js";
import { defineRunDetail, type ConversationButton, type RunDetailUi } from "./runDetailElement.js";
import { defineConversation, type ConversationUi } from "./conversationElement.js";
import { conversationViewOf, detailViewOf, type ConversationView, type DetailView } from "./runDetail.js";
import { RunsRead, type RunsView } from "./runsRead.js";
import { followedAfter, runsActivityOf, runsPollingDecision, UNSEEN_ANSWERS_BEFORE_STOP, type FollowedActivity, type RunsActivity } from "./runsPolling.js";
import { defineOnScreenMarker } from "./onScreenMarker.js";
import { defineSupervisorCard } from "./supervisorCardElement.js";
import { replyStanding, supervisorRequest } from "./supervisorRequest.js";
import { noticeSummary } from "./noticeSummary.js";

const NOTICE_TAGS = [
  "subagent-notify",
  "subagent-incremental-child-notify",
  "subagent_control_notice",
  "subagent_steering_notice",
  "subagent_supervisor_reply",
  "subagent-compaction-resume",
];

/**
 * The runs this session started, listed in the browser.
 *
 * The reader lives in this plugin's server half, so the whole feature - facts,
 * operation and panel - is one unit. Reads are per session (`RunsRead`): a list
 * fetched for one conversation must never render under another (the scope rule
 * the host surfaces follow).
 */
function selectedSessionField(context: WorkspacePanelContext, field: "path" | "id"): string | undefined {
  const state: unknown = context.state;
  if (typeof state !== "object" || state === null) return undefined;
  const selected: unknown = Reflect.get(state, "selectedSession");
  if (typeof selected !== "object" || selected === null) return undefined;
  const value: unknown = Reflect.get(selected, field);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function sessionFileOf(context: WorkspacePanelContext): string | undefined {
  return selectedSessionField(context, "path");
}

/** The host components an open row needs, when this host has all of them. */
function runControlsUiOf(ui: PluginActivationContext["ui"]): RunControlsUi | undefined {
  const renderButton = ui?.renderButton;
  const renderMessageField = ui?.renderMessageField;
  return renderButton === undefined || renderMessageField === undefined ? undefined : { renderButton, renderMessageField };
}

/** What an opened row draws with, on a host that opens rows at all. */
function runDetailUiOf(ui: PluginActivationContext["ui"], renderButton: RunControlsUi["renderButton"]): RunDetailUi {
  return {
    renderButton,
    renderMarkdownHtml: typeof ui?.renderMarkdownHtml === "function" ? ui.renderMarkdownHtml : undefined,
    textStyles: ui?.textStyles,
    adoptSheets: ui?.adoptSheets,
    desktopQuery: ui?.breakpoints?.desktopSideBySide,
    chevron: ui?.renderDisclosureIcon?.(true),
  };
}

/** What the Conversation dialog draws with; without a dialog or markdown there is no Conversation row. */
function conversationUiOf(ui: PluginActivationContext["ui"]): ConversationUi | undefined {
  if (typeof ui?.showDialog !== "function" || typeof ui.renderMarkdownHtml !== "function") return undefined;
  return { renderMarkdownHtml: ui.renderMarkdownHtml, textStyles: ui.textStyles, adoptSheets: ui.adoptSheets };
}

const READING: DetailView = { kind: "reading" };
const READ_FAILED: { readonly kind: "failed" } = { kind: "failed" };

/** One opened row's detail read and the run status it was read under; another status reads again. */
interface DetailEntry {
  readonly status: SubagentRunRow["status"];
  readonly view: DetailView;
}

function renderRuns(html: HtmlTemplateTag, ui: PluginActivationContext["ui"], view: RunsView | undefined, expansionOf: RunExpansionOf | undefined) {
  if (ui?.renderList === undefined) return html`<p class="muted">This list needs a newer PI WEB on this device.</p>`;
  return ui.renderList(subagentListModel(view?.state, view?.refreshFailed === true, expansionOf, Date.now()));
}

/** How often a running row's elapsed time moves on screen; a redraw, never a read. */
const ELAPSED_REDRAW_MS = 1000;

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Subagents",
  activate: (context: PluginActivationContext) => {
    const { html, svg } = context;
    const callOperation = context.callOperation;
    let requestUpdate: () => void = () => undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    let elapsedRedraw: ReturnType<typeof setInterval> | undefined;
    let followed: { readonly sessionFile: string; readonly activity: RunsActivity } | undefined;
    let unseenAnswers = 0;
    let panelShown: boolean | undefined;
    /** `machine\nsessionFile` of the session the host last asked this plugin about: an answer for another is not shown. */
    let selectedSession: string | undefined;
    const failedRead = (error: unknown): { readonly kind: "failed"; readonly words?: string } => {
      const words = context.ui?.describeError(error);
      return words === undefined ? READ_FAILED : { kind: "failed", words };
    };
    /**
     * The one read path for the opened row and its Conversation: a page without operations
     * answers the plain failed view, and only the operation's own rejection gets the host's words.
     */
    const readView = <View>(operation: string, input: unknown, viewOf: (answer: unknown) => View): Promise<View | ReturnType<typeof failedRead>> => (callOperation === undefined
      ? Promise.resolve(READ_FAILED)
      : callOperation(operation, input).then(viewOf, failedRead));
    const runs = new RunsRead(
      (sessionFile) => (callOperation === undefined ? Promise.reject(new Error("no operations")) : callOperation("runs.list", { sessionFile })),
      () => {
        unseenAnswers += 1;
        requestUpdate();
      },
    );
    const stopPolling = (): void => {
      clearInterval(polling);
      polling = undefined;
    };
    /** Redraws while the panel is on screen with a running row, so its elapsed time moves without a read. */
    const keepElapsedMoving = (moving: boolean): void => {
      if (moving && panelShown !== false) {
        elapsedRedraw ??= setInterval(() => { requestUpdate(); }, ELAPSED_REDRAW_MS);
        return;
      }
      clearInterval(elapsedRedraw);
      elapsedRedraw = undefined;
    };
    /**
     * Each answer asks the host to draw, and that draw follows again while the panel or its
     * badge is on screen. Answers nobody drew mean nothing shows the runs any more (the chat is
     * open): stop, and forget what was seen so the next look reads. A read still on its way is
     * no evidence either way, so a stalled read never stops a watched poll.
     */
    const poll = (): void => {
      if (unseenAnswers >= UNSEEN_ANSWERS_BEFORE_STOP) {
        stopPolling();
        followed = undefined;
        return;
      }
      runs.tick();
    };
    context.on?.("session-activity-settled", () => { followed = undefined; });
    const onScreen = (shown: boolean): void => {
      if (panelShown === shown) return;
      panelShown = shown;
      if (shown) requestUpdate();
      else keepElapsedMoving(false);
    };
    const shownFor = (panel: WorkspacePanelContext): SubagentListState | undefined => {
      const sessionFile = sessionFileOf(panel);
      return sessionFile === undefined ? undefined : runs.view(sessionFile)?.state;
    };

    /**
     * Read the session the host is showing. The panel's render and the tab's badge both ask, so
     * the poll follows the selected session even while the panel is closed; it used to stay on
     * the last session the panel drew (reads F7). A render of the panel while it is off screen
     * is not a look: it reads nothing and keeps nothing alive.
     */
    const follow = (panel: WorkspacePanelContext, looking = true): string | undefined => {
      const sessionFile = sessionFileOf(panel);
      selectedSession = sessionFile === undefined ? undefined : `${panel.machine.id}\n${sessionFile}`;
      if (sessionFile === undefined) return undefined;
      requestUpdate = () => { panel.host.requestRender(); };
      if (!looking) return sessionFile;
      unseenAnswers = 0;
      const switched = runs.select(sessionFile);
      const previous: FollowedActivity = followed?.sessionFile === sessionFile ? followed.activity : "unfollowed";
      const activity = runsActivityOf(panel.state?.status);
      const decision = runsPollingDecision(previous, activity);
      followed = { sessionFile, activity: followedAfter(previous, activity) };
      if (decision.read && !switched) runs.refresh();
      if (decision.poll) polling ??= setInterval(poll, 3000);
      else stopPolling();
      return sessionFile;
    };

    /**
     * Open rows and command notes, per device, keyed by machine, session and run: a
     * session switch shows the other session's rows closed, and a note never
     * lands on another session's run.
     */
    const openRuns = new Set<string>();
    const runNotes = new Map<string, RunNote>();
    const controlsUi = runControlsUiOf(context.ui);
    const detailUi = controlsUi === undefined ? undefined : runDetailUiOf(context.ui, controlsUi.renderButton);
    const conversationUi = conversationUiOf(context.ui);
    /**
     * What each opened row read about its run, by the same key as `openRuns`: read when the row
     * opens, kept when it closes, read again when the run's status changes (a running run that
     * finishes gets its result). One read in flight per key; a reload forgets them all.
     */
    const details = new Map<string, DetailEntry>();
    const conversationsReading = new Set<string>();
    const conversationFailures = new Map<string, string>();

    const readDetail = (panel: WorkspacePanelContext, key: string, sessionFile: string, row: SubagentRunRow): void => {
      const reading: DetailEntry = { status: row.status, view: READING };
      details.set(key, reading);
      void readView("runs.detail", { sessionFile, runId: row.runId, countMessages: conversationUi !== undefined }, detailViewOf).then((view) => {
        if (details.get(key) !== reading) return;
        details.set(key, { status: row.status, view });
        panel.host.requestRender();
      });
    };

    /** Reads the run's conversation and shows it, unless the reader has left that session by the time it answers. */
    const openConversation = (panel: WorkspacePanelContext, key: string, sessionFile: string, row: SubagentRunRow, ui: ConversationUi): void => {
      const hostUi = context.ui;
      if (hostUi === undefined) return;
      const read = (): Promise<ConversationView> => readView("runs.conversation", { sessionFile, runId: row.runId }, conversationViewOf);
      const openDialog = (view: ConversationView): void => {
        try {
          const dialog = hostUi.showDialog({
            label: `${row.agent} conversation`,
            presentation: "fullscreen",
            content: html`<subagent-conversation
              .ui=${ui}
              .agent=${row.agent}
              .view=${view}
              .refresh=${row.status === "running" ? read : undefined}
              .close=${() => { dialog.close(); }}
            ></subagent-conversation>`,
          });
        } catch (error) {
          conversationFailures.set(key, `Could not open it. ${hostUi.describeError(error)}`);
        }
      };
      const askedFor = `${panel.machine.id}\n${sessionFile}`;
      conversationsReading.add(key);
      conversationFailures.delete(key);
      panel.host.requestRender();
      void read().then((view) => {
        conversationsReading.delete(key);
        if (selectedSession === askedFor) openDialog(view);
        panel.host.requestRender();
      });
    };

    const runCommand = async (panel: WorkspacePanelContext, key: string, sessionFile: string, command: RunCommandName, args: string): Promise<PluginSessionCommandOutcome> => {
      const session = panel.session;
      const sessionId = selectedSessionField(panel, "id");
      runNotes.set(key, { kind: "pending", command });
      panel.host.requestRender();
      const outcome: PluginSessionCommandOutcome = session === undefined || sessionId === undefined
        ? { kind: "refused", reason: "no-session", words: "No session is open on this page." }
        : await session.runCommand({ sessionId, name: RUN_COMMANDS[command], args }).catch((): PluginSessionCommandOutcome => ({ kind: "unknown", words: "" }));
      runNotes.set(key, { kind: "answered", command, outcome, listAtAnswer: runs.view(sessionFile)?.state });
      runs.refresh();
      panel.host.requestRender();
      return outcome;
    };

    const expansionFor = (panel: WorkspacePanelContext, sessionFile: string, ui: RunControlsUi, rowUi: RunDetailUi) => (row: SubagentRunRow): PluginRowExpansion => {
      const key = `${panel.machine.id}\n${sessionFile}\n${row.runId}`;
      const commandRunId = row.toolRunId ?? row.runId;
      return {
        expanded: openRuns.has(key),
        onToggle: () => {
          if (!openRuns.delete(key)) openRuns.add(key);
          panel.host.requestRender();
        },
        body: () => {
          const note = runNotes.get(key);
          const entry = details.get(key);
          if (entry === undefined || entry.status !== row.status) readDetail(panel, key, sessionFile, row);
          const conversation: ConversationButton | undefined = conversationUi === undefined ? undefined : {
            busy: conversationsReading.has(key),
            failed: conversationFailures.get(key),
            open: () => { if (!conversationsReading.has(key)) openConversation(panel, key, sessionFile, row, conversationUi); },
          };
          const running = row.status === "running";
          return html`<subagent-run-detail
            .ui=${rowUi}
            .row=${row}
            .read=${details.get(key)?.view ?? READING}
            .stoppedHere=${note?.command === "stop" && !(note.kind === "answered" && note.outcome.kind === "refused")}
            .now=${running ? Date.now() : 0}
            .conversation=${conversation}
            .onReadAgain=${() => { readDetail(panel, key, sessionFile, row); panel.host.requestRender(); }}
          >${running ? html`<subagent-run-controls
            .ui=${ui}
            .controls=${rowControls(row.control, panel.session !== undefined)}
            .agent=${row.agent}
            .note=${note === undefined ? undefined : noteLine(note, runs.view(sessionFile)?.state, row.agent)}
            .stopBusy=${stopPending(note)}
            .onSteer=${async (text: string) => steerTaken(await runCommand(panel, key, sessionFile, "steer", `${commandRunId} ${text}`))}
            .onStop=${() => { void runCommand(panel, key, sessionFile, "stop", commandRunId); }}
          ></subagent-run-controls>` : null}</subagent-run-detail>`;
        },
      };
    };

    const ensure = (panel: WorkspacePanelContext): RunsView | undefined => {
      const sessionFile = follow(panel, panelShown !== false);
      if (sessionFile === undefined) return { state: { kind: "unknown", reason: "Open a session to see its subagents." }, refreshFailed: false };
      return runs.view(sessionFile);
    };

    defineSupervisorCard();
    defineOnScreenMarker();
    defineRunControls();
    defineRunDetail();
    defineConversation();
    return {
      contributions: {
        messageRenderers: [
          {
            id: "message.supervisor-request",
            tag: "subagent_supervisor_request",
            render: (view) => {
              const request = supervisorRequest(view.payload);
              return html`<pi-subagent-supervisor-card
                .request=${request}
                .standing=${replyStanding(request, view.followingRows ?? [], view.followingUserTexts ?? [])}
                .onSend=${view.sendMessage}
                .onInsert=${view.insertIntoComposer}
              ></pi-subagent-supervisor-card>`;
            },
          },
          ...NOTICE_TAGS.map((tag) => ({
            id: `message.${tag.replace(/_/gu, "-")}`,
            tag,
            render: (view: { payload: unknown }) => {
              const summary = noticeSummary(tag, view.payload);
              return html`<strong>${summary.title}</strong>${summary.detail === undefined ? null : html`<small>${summary.detail}</small>`}`;
            },
          })),
        ],
        workspacePanels: [
          {
            id: "workspace.subagents",
            title: "Subagents",
            fronts: "subagents",
            icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"></circle><circle cx="5" cy="19" r="2.5"></circle><circle cx="19" cy="19" r="2.5"></circle><path d="M12 7.5v4"></path><path d="M12 11.5 6.5 16.8"></path><path d="M12 11.5l5.5 5.3"></path></svg>`,
            order: 60,
            badge: (panel) => {
              follow(panel);
              const state = shownFor(panel);
              return state?.kind === "rows" && state.running > 0 ? state.running : undefined;
            },
            render: (panel) => {
              const sessionFile = sessionFileOf(panel);
              const expansionOf = controlsUi === undefined || detailUi === undefined || sessionFile === undefined ? undefined : expansionFor(panel, sessionFile, controlsUi, detailUi);
              const view = ensure(panel);
              keepElapsedMoving(view?.state?.kind === "rows" && view.state.running > 0);
              return html`<pi-subagents-on-screen .onChange=${onScreen}></pi-subagents-on-screen>${renderRuns(html, context.ui, view, expansionOf)}`;
            },
          },
        ],
      },
      dispose: () => {
        stopPolling();
        keepElapsedMoving(false);
      },
    };
  },
};

export default plugin;
