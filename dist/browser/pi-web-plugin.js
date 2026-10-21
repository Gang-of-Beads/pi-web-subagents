var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i6 = decorators.length - 1, decorator; i6 >= 0; i6--)
    if (decorator = decorators[i6])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// src/runRows.ts
function subagentListState(answer) {
  if (typeof answer !== "object" || answer === null) return { kind: "unknown", reason: "The machine did not answer." };
  if (Reflect.get(answer, "known") !== true) {
    const reason = Reflect.get(answer, "reason");
    return { kind: "unknown", reason: reason === "no-session" ? "Open a session to see its subagents." : "This machine could not read the runs." };
  }
  const raw = Reflect.get(answer, "runs");
  if (!Array.isArray(raw)) return { kind: "unknown", reason: "This machine answered without a run list." };
  const rows = raw.filter(isRunRow).map((row) => ({ ...row, control: runControlOf(Reflect.get(row, "control")) }));
  if (rows.length === 0) return { kind: "empty" };
  return { kind: "rows", rows, running: rows.filter((row) => row.status === "running").length };
}
function runPresentation(row, now = Date.now()) {
  const startedAtMs = Date.parse(row.startedAt);
  const elapsed = formatElapsed(row.status === "running" && Number.isFinite(startedAtMs) ? Math.max(0, now - startedAtMs) : row.elapsedMs);
  const activity = row.lastActivity === void 0 || row.lastActivity === "" ? void 0 : row.lastActivity;
  if (row.status === "running") {
    return { label: "Working", tone: "running", detail: activity === void 0 ? `${elapsed} so far` : `${elapsed} \xB7 ${activity}` };
  }
  if (row.status === "done") return { label: "Done", tone: "settled", detail: `${elapsed}${row.hasOutput ? "" : " \xB7 no output written"}` };
  if (row.status === "stopped") return { label: "Stopped", tone: "settled", detail: elapsed };
  const reason = row.error ?? activity;
  if (row.status === "failed") return { label: "Failed", tone: "problem", detail: `${elapsed}${reason === void 0 || reason === "" ? "" : ` \xB7 ${reason}`}` };
  if (row.status === "lost") {
    return { label: "Lost", tone: "problem", detail: `Wrote for ${elapsed}, then went silent without an outcome` };
  }
  return { label: "Unknown", tone: "unknown", detail: "Started; this machine has no outcome for it" };
}
var ROW_SIDE = {
  running: (presentation) => ({ status: { label: presentation.label, tone: "good" } }),
  settled: (presentation) => ({ value: presentation.label }),
  problem: (presentation) => ({ status: { label: presentation.label, tone: "problem" } }),
  unknown: (presentation) => ({ status: { label: presentation.label, tone: "neutral" } })
};
function listRow(row, now, expansionOf) {
  const presentation = runPresentation(row, now);
  return {
    id: row.runId,
    title: row.task === void 0 ? row.agent : `${row.agent}: ${row.task}`,
    ...ROW_SIDE[presentation.tone](presentation),
    detail: presentation.detail,
    ...expansionOf === void 0 ? {} : { expansion: expansionOf(row) }
  };
}
var STALE_EMPTY = "Could not refresh. The last read found no subagents in this session.";
var LIST_WORDS = {
  empty: "This session has started no subagents.",
  reading: "Reading this session's subagents\u2026",
  failed: "This machine could not read the runs.",
  stale: "Could not refresh - showing the last read."
};
function subagentListModel(state, refreshFailed, expansionOf, now = Date.now()) {
  if (state === void 0) return { read: "reading", groups: [], words: LIST_WORDS };
  if (state.kind === "unknown") return { read: "failed", groups: [], words: { ...LIST_WORDS, failed: state.reason } };
  if (state.kind === "empty" && refreshFailed) return { read: "failed", groups: [], words: { ...LIST_WORDS, failed: STALE_EMPTY } };
  const rows = state.kind === "rows" ? state.rows : [];
  return {
    read: refreshFailed ? "failed" : "ready",
    words: LIST_WORDS,
    groups: [
      { id: "running", heading: "Running", rows: rows.filter((row) => row.status === "running").map((row) => listRow(row, now, expansionOf)) },
      { id: "finished", heading: "Finished", rows: rows.filter((row) => row.status !== "running").map((row) => listRow(row, now, expansionOf)) }
    ]
  };
}
function formatElapsed(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "unknown";
  const seconds = Math.round(milliseconds / 1e3);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
function runControlOf(value) {
  return value === "async" || value === "foreground" ? value : "unknown";
}
function isRunRow(value) {
  if (typeof value !== "object" || value === null) return false;
  const runId = Reflect.get(value, "runId");
  const agent = Reflect.get(value, "agent");
  const status = Reflect.get(value, "status");
  const toolRunId = Reflect.get(value, "toolRunId");
  const error = Reflect.get(value, "error");
  const lastActivityAt = Reflect.get(value, "lastActivityAt");
  return typeof runId === "string" && (lastActivityAt === void 0 || typeof lastActivityAt === "string") && (toolRunId === void 0 || typeof toolRunId === "string") && (error === void 0 || typeof error === "string") && typeof agent === "string" && (status === "running" || status === "done" || status === "failed" || status === "stopped" || status === "lost" || status === "unknown");
}

// src/runControls.ts
function rowControls(control, canRunCommands) {
  if (control === "foreground") return "inside-reply";
  return canRunCommands ? "steer-and-stop" : "needs-newer-host";
}
var RUN_COMMANDS = { steer: "subagents-steer", stop: "subagents-stop" };
function noteState(note, listNow) {
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
var NOTICE_TONE = { info: "neutral", warning: "attention", error: "problem" };
var NOTE_LINES = {
  stopping: () => ({ text: "Stopping\u2026", tone: "neutral" }),
  sending: () => ({ text: "Sending\u2026", tone: "neutral" }),
  said: (note) => {
    const notices = note.kind === "answered" && note.outcome.kind === "ran" ? note.outcome.notices : [];
    const last = notices.at(-1);
    return last === void 0 ? { text: "", tone: "neutral" } : { text: last.message, tone: NOTICE_TONE[last.level] ?? "neutral" };
  },
  "steer-sent": (_note, agent) => ({ text: `Sent to ${agent}.`, tone: "neutral" }),
  "stop-ran": () => ({ text: "Stopping\u2026", tone: "neutral" }),
  "stop-ran-still-running": () => ({ text: "The command ran; the run still reads running.", tone: "attention" }),
  refused: (note) => ({ text: note.kind === "answered" && note.outcome.kind === "refused" ? note.outcome.words : "", tone: "problem" }),
  waiting: () => ({ text: "No answer yet from the session; the list shows what happened.", tone: "attention" }),
  unknown: () => ({ text: "No answer from the machine; the list shows what happened.", tone: "attention" })
};
function noteLine(note, listNow, agent) {
  return NOTE_LINES[noteState(note, listNow)](note, agent);
}
function steerTaken(outcome) {
  return outcome.kind === "ran" && !outcome.notices.some((notice) => notice.level === "error");
}
function stopPending(note) {
  return note?.kind === "pending" && note.command === "stop";
}

// node_modules/@lit/reactive-element/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = /* @__PURE__ */ Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t4, e7, o7) {
    if (this._$cssResult$ = true, o7 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t4, this.t = e7;
  }
  get styleSheet() {
    let t4 = this.o;
    const s4 = this.t;
    if (e && void 0 === t4) {
      const e7 = void 0 !== s4 && 1 === s4.length;
      e7 && (t4 = o.get(s4)), void 0 === t4 && ((this.o = t4 = new CSSStyleSheet()).replaceSync(this.cssText), e7 && o.set(s4, t4));
    }
    return t4;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t4) => new n("string" == typeof t4 ? t4 : t4 + "", void 0, s);
var i = (t4, ...e7) => {
  const o7 = 1 === t4.length ? t4[0] : e7.reduce((e8, s4, o8) => e8 + ((t5) => {
    if (true === t5._$cssResult$) return t5.cssText;
    if ("number" == typeof t5) return t5;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t5 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s4) + t4[o8 + 1], t4[0]);
  return new n(o7, t4, s);
};
var S = (s4, o7) => {
  if (e) s4.adoptedStyleSheets = o7.map((t4) => t4 instanceof CSSStyleSheet ? t4 : t4.styleSheet);
  else for (const e7 of o7) {
    const o8 = document.createElement("style"), n5 = t.litNonce;
    void 0 !== n5 && o8.setAttribute("nonce", n5), o8.textContent = e7.cssText, s4.appendChild(o8);
  }
};
var c = e ? (t4) => t4 : (t4) => t4 instanceof CSSStyleSheet ? ((t5) => {
  let e7 = "";
  for (const s4 of t5.cssRules) e7 += s4.cssText;
  return r(e7);
})(t4) : t4;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t4, s4) => t4;
var u = { toAttribute(t4, s4) {
  switch (s4) {
    case Boolean:
      t4 = t4 ? l : null;
      break;
    case Object:
    case Array:
      t4 = null == t4 ? t4 : JSON.stringify(t4);
  }
  return t4;
}, fromAttribute(t4, s4) {
  let i6 = t4;
  switch (s4) {
    case Boolean:
      i6 = null !== t4;
      break;
    case Number:
      i6 = null === t4 ? null : Number(t4);
      break;
    case Object:
    case Array:
      try {
        i6 = JSON.parse(t4);
      } catch (t5) {
        i6 = null;
      }
  }
  return i6;
} };
var f = (t4, s4) => !i2(t4, s4);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ??= /* @__PURE__ */ Symbol("metadata"), a.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y = class extends HTMLElement {
  static addInitializer(t4) {
    this._$Ei(), (this.l ??= []).push(t4);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t4, s4 = b) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t4) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t4, s4), !s4.noAccessor) {
      const i6 = /* @__PURE__ */ Symbol(), h3 = this.getPropertyDescriptor(t4, i6, s4);
      void 0 !== h3 && e2(this.prototype, t4, h3);
    }
  }
  static getPropertyDescriptor(t4, s4, i6) {
    const { get: e7, set: r6 } = h(this.prototype, t4) ?? { get() {
      return this[s4];
    }, set(t5) {
      this[s4] = t5;
    } };
    return { get: e7, set(s5) {
      const h3 = e7?.call(this);
      r6?.call(this, s5), this.requestUpdate(t4, h3, i6);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t4) {
    return this.elementProperties.get(t4) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t4 = n2(this);
    t4.finalize(), void 0 !== t4.l && (this.l = [...t4.l]), this.elementProperties = new Map(t4.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t5 = this.properties, s4 = [...r2(t5), ...o2(t5)];
      for (const i6 of s4) this.createProperty(i6, t5[i6]);
    }
    const t4 = this[Symbol.metadata];
    if (null !== t4) {
      const s4 = litPropertyMetadata.get(t4);
      if (void 0 !== s4) for (const [t5, i6] of s4) this.elementProperties.set(t5, i6);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t5, s4] of this.elementProperties) {
      const i6 = this._$Eu(t5, s4);
      void 0 !== i6 && this._$Eh.set(i6, t5);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i6 = [];
    if (Array.isArray(s4)) {
      const e7 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e7) i6.unshift(c(s5));
    } else void 0 !== s4 && i6.push(c(s4));
    return i6;
  }
  static _$Eu(t4, s4) {
    const i6 = s4.attribute;
    return false === i6 ? void 0 : "string" == typeof i6 ? i6 : "string" == typeof t4 ? t4.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t4) => this.enableUpdating = t4), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t4) => t4(this));
  }
  addController(t4) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t4), void 0 !== this.renderRoot && this.isConnected && t4.hostConnected?.();
  }
  removeController(t4) {
    this._$EO?.delete(t4);
  }
  _$E_() {
    const t4 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i6 of s4.keys()) this.hasOwnProperty(i6) && (t4.set(i6, this[i6]), delete this[i6]);
    t4.size > 0 && (this._$Ep = t4);
  }
  createRenderRoot() {
    const t4 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t4, this.constructor.elementStyles), t4;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t4) => t4.hostConnected?.());
  }
  enableUpdating(t4) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t4) => t4.hostDisconnected?.());
  }
  attributeChangedCallback(t4, s4, i6) {
    this._$AK(t4, i6);
  }
  _$ET(t4, s4) {
    const i6 = this.constructor.elementProperties.get(t4), e7 = this.constructor._$Eu(t4, i6);
    if (void 0 !== e7 && true === i6.reflect) {
      const h3 = (void 0 !== i6.converter?.toAttribute ? i6.converter : u).toAttribute(s4, i6.type);
      this._$Em = t4, null == h3 ? this.removeAttribute(e7) : this.setAttribute(e7, h3), this._$Em = null;
    }
  }
  _$AK(t4, s4) {
    const i6 = this.constructor, e7 = i6._$Eh.get(t4);
    if (void 0 !== e7 && this._$Em !== e7) {
      const t5 = i6.getPropertyOptions(e7), h3 = "function" == typeof t5.converter ? { fromAttribute: t5.converter } : void 0 !== t5.converter?.fromAttribute ? t5.converter : u;
      this._$Em = e7;
      const r6 = h3.fromAttribute(s4, t5.type);
      this[e7] = r6 ?? this._$Ej?.get(e7) ?? r6, this._$Em = null;
    }
  }
  requestUpdate(t4, s4, i6, e7 = false, h3) {
    if (void 0 !== t4) {
      const r6 = this.constructor;
      if (false === e7 && (h3 = this[t4]), i6 ??= r6.getPropertyOptions(t4), !((i6.hasChanged ?? f)(h3, s4) || i6.useDefault && i6.reflect && h3 === this._$Ej?.get(t4) && !this.hasAttribute(r6._$Eu(t4, i6)))) return;
      this.C(t4, s4, i6);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t4, s4, { useDefault: i6, reflect: e7, wrapped: h3 }, r6) {
    i6 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t4) && (this._$Ej.set(t4, r6 ?? s4 ?? this[t4]), true !== h3 || void 0 !== r6) || (this._$AL.has(t4) || (this.hasUpdated || i6 || (s4 = void 0), this._$AL.set(t4, s4)), true === e7 && this._$Em !== t4 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t4));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t5) {
      Promise.reject(t5);
    }
    const t4 = this.scheduleUpdate();
    return null != t4 && await t4, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t6, s5] of this._$Ep) this[t6] = s5;
        this._$Ep = void 0;
      }
      const t5 = this.constructor.elementProperties;
      if (t5.size > 0) for (const [s5, i6] of t5) {
        const { wrapped: t6 } = i6, e7 = this[s5];
        true !== t6 || this._$AL.has(s5) || void 0 === e7 || this.C(s5, void 0, i6, e7);
      }
    }
    let t4 = false;
    const s4 = this._$AL;
    try {
      t4 = this.shouldUpdate(s4), t4 ? (this.willUpdate(s4), this._$EO?.forEach((t5) => t5.hostUpdate?.()), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t4 = false, this._$EM(), s5;
    }
    t4 && this._$AE(s4);
  }
  willUpdate(t4) {
  }
  _$AE(t4) {
    this._$EO?.forEach((t5) => t5.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t4)), this.updated(t4);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t4) {
    return true;
  }
  update(t4) {
    this._$Eq &&= this._$Eq.forEach((t5) => this._$ET(t5, this[t5])), this._$EM();
  }
  updated(t4) {
  }
  firstUpdated(t4) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ??= []).push("2.1.2");

// node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = (t4) => t4;
var s2 = t2.trustedTypes;
var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t4) => t4 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t4) => null === t4 || "object" != typeof t4 && "function" != typeof t4;
var u2 = Array.isArray;
var d2 = (t4) => u2(t4) || "function" == typeof t4?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t4) => (i6, ...s4) => ({ _$litType$: t4, strings: i6, values: s4 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = /* @__PURE__ */ Symbol.for("lit-noChange");
var A = /* @__PURE__ */ Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t4, i6) {
  if (!u2(t4) || !t4.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e3 ? e3.createHTML(i6) : i6;
}
var N = (t4, i6) => {
  const s4 = t4.length - 1, e7 = [];
  let n5, l3 = 2 === i6 ? "<svg>" : 3 === i6 ? "<math>" : "", c4 = v;
  for (let i7 = 0; i7 < s4; i7++) {
    const s5 = t4[i7];
    let a3, u3, d3 = -1, f3 = 0;
    for (; f3 < s5.length && (c4.lastIndex = f3, u3 = c4.exec(s5), null !== u3); ) f3 = c4.lastIndex, c4 === v ? "!--" === u3[1] ? c4 = _ : void 0 !== u3[1] ? c4 = m : void 0 !== u3[2] ? (y2.test(u3[2]) && (n5 = RegExp("</" + u3[2], "g")), c4 = p2) : void 0 !== u3[3] && (c4 = p2) : c4 === p2 ? ">" === u3[0] ? (c4 = n5 ?? v, d3 = -1) : void 0 === u3[1] ? d3 = -2 : (d3 = c4.lastIndex - u3[2].length, a3 = u3[1], c4 = void 0 === u3[3] ? p2 : '"' === u3[3] ? $ : g) : c4 === $ || c4 === g ? c4 = p2 : c4 === _ || c4 === m ? c4 = v : (c4 = p2, n5 = void 0);
    const x2 = c4 === p2 && t4[i7 + 1].startsWith("/>") ? " " : "";
    l3 += c4 === v ? s5 + r3 : d3 >= 0 ? (e7.push(a3), s5.slice(0, d3) + h2 + s5.slice(d3) + o3 + x2) : s5 + o3 + (-2 === d3 ? i7 : x2);
  }
  return [V(t4, l3 + (t4[s4] || "<?>") + (2 === i6 ? "</svg>" : 3 === i6 ? "</math>" : "")), e7];
};
var S2 = class _S {
  constructor({ strings: t4, _$litType$: i6 }, e7) {
    let r6;
    this.parts = [];
    let l3 = 0, a3 = 0;
    const u3 = t4.length - 1, d3 = this.parts, [f3, v2] = N(t4, i6);
    if (this.el = _S.createElement(f3, e7), P.currentNode = this.el.content, 2 === i6 || 3 === i6) {
      const t5 = this.el.content.firstChild;
      t5.replaceWith(...t5.childNodes);
    }
    for (; null !== (r6 = P.nextNode()) && d3.length < u3; ) {
      if (1 === r6.nodeType) {
        if (r6.hasAttributes()) for (const t5 of r6.getAttributeNames()) if (t5.endsWith(h2)) {
          const i7 = v2[a3++], s4 = r6.getAttribute(t5).split(o3), e8 = /([.?@])?(.*)/.exec(i7);
          d3.push({ type: 1, index: l3, name: e8[2], strings: s4, ctor: "." === e8[1] ? I : "?" === e8[1] ? L : "@" === e8[1] ? z : H }), r6.removeAttribute(t5);
        } else t5.startsWith(o3) && (d3.push({ type: 6, index: l3 }), r6.removeAttribute(t5));
        if (y2.test(r6.tagName)) {
          const t5 = r6.textContent.split(o3), i7 = t5.length - 1;
          if (i7 > 0) {
            r6.textContent = s2 ? s2.emptyScript : "";
            for (let s4 = 0; s4 < i7; s4++) r6.append(t5[s4], c3()), P.nextNode(), d3.push({ type: 2, index: ++l3 });
            r6.append(t5[i7], c3());
          }
        }
      } else if (8 === r6.nodeType) if (r6.data === n3) d3.push({ type: 2, index: l3 });
      else {
        let t5 = -1;
        for (; -1 !== (t5 = r6.data.indexOf(o3, t5 + 1)); ) d3.push({ type: 7, index: l3 }), t5 += o3.length - 1;
      }
      l3++;
    }
  }
  static createElement(t4, i6) {
    const s4 = l2.createElement("template");
    return s4.innerHTML = t4, s4;
  }
};
function M(t4, i6, s4 = t4, e7) {
  if (i6 === E) return i6;
  let h3 = void 0 !== e7 ? s4._$Co?.[e7] : s4._$Cl;
  const o7 = a2(i6) ? void 0 : i6._$litDirective$;
  return h3?.constructor !== o7 && (h3?._$AO?.(false), void 0 === o7 ? h3 = void 0 : (h3 = new o7(t4), h3._$AT(t4, s4, e7)), void 0 !== e7 ? (s4._$Co ??= [])[e7] = h3 : s4._$Cl = h3), void 0 !== h3 && (i6 = M(t4, h3._$AS(t4, i6.values), h3, e7)), i6;
}
var R = class {
  constructor(t4, i6) {
    this._$AV = [], this._$AN = void 0, this._$AD = t4, this._$AM = i6;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t4) {
    const { el: { content: i6 }, parts: s4 } = this._$AD, e7 = (t4?.creationScope ?? l2).importNode(i6, true);
    P.currentNode = e7;
    let h3 = P.nextNode(), o7 = 0, n5 = 0, r6 = s4[0];
    for (; void 0 !== r6; ) {
      if (o7 === r6.index) {
        let i7;
        2 === r6.type ? i7 = new k(h3, h3.nextSibling, this, t4) : 1 === r6.type ? i7 = new r6.ctor(h3, r6.name, r6.strings, this, t4) : 6 === r6.type && (i7 = new Z(h3, this, t4)), this._$AV.push(i7), r6 = s4[++n5];
      }
      o7 !== r6?.index && (h3 = P.nextNode(), o7++);
    }
    return P.currentNode = l2, e7;
  }
  p(t4) {
    let i6 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t4, s4, i6), i6 += s4.strings.length - 2) : s4._$AI(t4[i6])), i6++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t4, i6, s4, e7) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t4, this._$AB = i6, this._$AM = s4, this.options = e7, this._$Cv = e7?.isConnected ?? true;
  }
  get parentNode() {
    let t4 = this._$AA.parentNode;
    const i6 = this._$AM;
    return void 0 !== i6 && 11 === t4?.nodeType && (t4 = i6.parentNode), t4;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t4, i6 = this) {
    t4 = M(this, t4, i6), a2(t4) ? t4 === A || null == t4 || "" === t4 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t4 !== this._$AH && t4 !== E && this._(t4) : void 0 !== t4._$litType$ ? this.$(t4) : void 0 !== t4.nodeType ? this.T(t4) : d2(t4) ? this.k(t4) : this._(t4);
  }
  O(t4) {
    return this._$AA.parentNode.insertBefore(t4, this._$AB);
  }
  T(t4) {
    this._$AH !== t4 && (this._$AR(), this._$AH = this.O(t4));
  }
  _(t4) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t4 : this.T(l2.createTextNode(t4)), this._$AH = t4;
  }
  $(t4) {
    const { values: i6, _$litType$: s4 } = t4, e7 = "number" == typeof s4 ? this._$AC(t4) : (void 0 === s4.el && (s4.el = S2.createElement(V(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e7) this._$AH.p(i6);
    else {
      const t5 = new R(e7, this), s5 = t5.u(this.options);
      t5.p(i6), this.T(s5), this._$AH = t5;
    }
  }
  _$AC(t4) {
    let i6 = C.get(t4.strings);
    return void 0 === i6 && C.set(t4.strings, i6 = new S2(t4)), i6;
  }
  k(t4) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i6 = this._$AH;
    let s4, e7 = 0;
    for (const h3 of t4) e7 === i6.length ? i6.push(s4 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s4 = i6[e7], s4._$AI(h3), e7++;
    e7 < i6.length && (this._$AR(s4 && s4._$AB.nextSibling, e7), i6.length = e7);
  }
  _$AR(t4 = this._$AA.nextSibling, s4) {
    for (this._$AP?.(false, true, s4); t4 !== this._$AB; ) {
      const s5 = i3(t4).nextSibling;
      i3(t4).remove(), t4 = s5;
    }
  }
  setConnected(t4) {
    void 0 === this._$AM && (this._$Cv = t4, this._$AP?.(t4));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t4, i6, s4, e7, h3) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t4, this.name = i6, this._$AM = e7, this.options = h3, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
  }
  _$AI(t4, i6 = this, s4, e7) {
    const h3 = this.strings;
    let o7 = false;
    if (void 0 === h3) t4 = M(this, t4, i6, 0), o7 = !a2(t4) || t4 !== this._$AH && t4 !== E, o7 && (this._$AH = t4);
    else {
      const e8 = t4;
      let n5, r6;
      for (t4 = h3[0], n5 = 0; n5 < h3.length - 1; n5++) r6 = M(this, e8[s4 + n5], i6, n5), r6 === E && (r6 = this._$AH[n5]), o7 ||= !a2(r6) || r6 !== this._$AH[n5], r6 === A ? t4 = A : t4 !== A && (t4 += (r6 ?? "") + h3[n5 + 1]), this._$AH[n5] = r6;
    }
    o7 && !e7 && this.j(t4);
  }
  j(t4) {
    t4 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t4 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t4) {
    this.element[this.name] = t4 === A ? void 0 : t4;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t4) {
    this.element.toggleAttribute(this.name, !!t4 && t4 !== A);
  }
};
var z = class extends H {
  constructor(t4, i6, s4, e7, h3) {
    super(t4, i6, s4, e7, h3), this.type = 5;
  }
  _$AI(t4, i6 = this) {
    if ((t4 = M(this, t4, i6, 0) ?? A) === E) return;
    const s4 = this._$AH, e7 = t4 === A && s4 !== A || t4.capture !== s4.capture || t4.once !== s4.once || t4.passive !== s4.passive, h3 = t4 !== A && (s4 === A || e7);
    e7 && this.element.removeEventListener(this.name, this, s4), h3 && this.element.addEventListener(this.name, this, t4), this._$AH = t4;
  }
  handleEvent(t4) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t4) : this._$AH.handleEvent(t4);
  }
};
var Z = class {
  constructor(t4, i6, s4) {
    this.element = t4, this.type = 6, this._$AN = void 0, this._$AM = i6, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t4) {
    M(this, t4);
  }
};
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ??= []).push("3.3.3");
var D = (t4, i6, s4) => {
  const e7 = s4?.renderBefore ?? i6;
  let h3 = e7._$litPart$;
  if (void 0 === h3) {
    const t5 = s4?.renderBefore ?? null;
    e7._$litPart$ = h3 = new k(i6.insertBefore(c3(), t5), t5, void 0, s4 ?? {});
  }
  return h3._$AI(t4), h3;
};

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t4 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t4.firstChild, t4;
  }
  update(t4) {
    const r6 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t4), this._$Do = D(r6, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i4 });
(s3.litElementVersions ??= []).push("4.2.2");

// node_modules/@lit/reactive-element/decorators/property.js
var o5 = { attribute: true, type: String, converter: u, reflect: false, hasChanged: f };
var r4 = (t4 = o5, e7, r6) => {
  const { kind: n5, metadata: i6 } = r6;
  let s4 = globalThis.litPropertyMetadata.get(i6);
  if (void 0 === s4 && globalThis.litPropertyMetadata.set(i6, s4 = /* @__PURE__ */ new Map()), "setter" === n5 && ((t4 = Object.create(t4)).wrapped = true), s4.set(r6.name, t4), "accessor" === n5) {
    const { name: o7 } = r6;
    return { set(r7) {
      const n6 = e7.get.call(this);
      e7.set.call(this, r7), this.requestUpdate(o7, n6, t4, true, r7);
    }, init(e8) {
      return void 0 !== e8 && this.C(o7, void 0, t4, e8), e8;
    } };
  }
  if ("setter" === n5) {
    const { name: o7 } = r6;
    return function(r7) {
      const n6 = this[o7];
      e7.call(this, r7), this.requestUpdate(o7, n6, t4, true, r7);
    };
  }
  throw Error("Unsupported decorator location: " + n5);
};
function n4(t4) {
  return (e7, o7) => "object" == typeof o7 ? r4(t4, e7, o7) : ((t5, e8, o8) => {
    const r6 = e8.hasOwnProperty(o8);
    return e8.constructor.createProperty(o8, t5), r6 ? Object.getOwnPropertyDescriptor(e8, o8) : void 0;
  })(t4, e7, o7);
}

// node_modules/@lit/reactive-element/decorators/state.js
function r5(r6) {
  return n4({ ...r6, state: true, attribute: false });
}

// src/runControlsElement.ts
var SubagentRunControls = class extends i4 {
  constructor() {
    super(...arguments);
    this.controls = "needs-newer-host";
    this.agent = "subagent";
    this.stopBusy = false;
  }
  render() {
    const drawings = {
      "steer-and-stop": () => this.renderSteerAndStop(),
      "inside-reply": () => b2`<p class="note">Runs inside the current reply; it stops with the session's Stop.</p>`,
      "needs-newer-host": () => b2`<p class="note">Steer and Stop need a newer PI WEB on this machine.</p>`
    };
    return drawings[this.controls]();
  }
  renderSteerAndStop() {
    const ui = this.ui;
    if (ui === void 0) return null;
    const note = this.note;
    return b2`
      <div class="steer">
        ${ui.renderMessageField({
      label: `Steer ${this.agent}`,
      placeholder: "Steer this subagent\u2026",
      sendLabel: "Send steer",
      send: (text) => this.onSteer?.(text) ?? Promise.resolve(false)
    })}
        ${ui.renderButton({ label: "Stop", tone: "danger", busy: this.stopBusy, run: () => {
      this.onStop?.();
    } })}
      </div>
      <p class="note ${note?.tone ?? "neutral"}" role="status">${note?.text ?? ""}</p>
    `;
  }
  static {
    this.styles = i`
    :host { display: flex; flex-direction: column; gap: var(--pi-space-3); }
    .steer { display: flex; align-items: center; gap: var(--pi-space-3); }
    .steer > :first-child { flex: 1 1 auto; min-width: 0; }
    .note { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: var(--pi-leading-normal); overflow-wrap: anywhere; }
    .note:empty { margin-top: calc(-1 * var(--pi-space-3)); }
    .note.attention { color: var(--pi-warning); }
    .note.problem { color: var(--pi-danger); }
  `;
  }
};
__decorateClass([
  n4({ attribute: false })
], SubagentRunControls.prototype, "ui", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunControls.prototype, "controls", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunControls.prototype, "agent", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunControls.prototype, "note", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunControls.prototype, "stopBusy", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunControls.prototype, "onSteer", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunControls.prototype, "onStop", 2);
function defineRunControls() {
  if (customElements.get("subagent-run-controls") === void 0) customElements.define("subagent-run-controls", SubagentRunControls);
}

// node_modules/lit-html/directive.js
var t3 = { ATTRIBUTE: 1, CHILD: 2, PROPERTY: 3, BOOLEAN_ATTRIBUTE: 4, EVENT: 5, ELEMENT: 6 };
var e5 = (t4) => (...e7) => ({ _$litDirective$: t4, values: e7 });
var i5 = class {
  constructor(t4) {
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t4, e7, i6) {
    this._$Ct = t4, this._$AM = e7, this._$Ci = i6;
  }
  _$AS(t4, e7) {
    return this.update(t4, e7);
  }
  update(t4, e7) {
    return this.render(...e7);
  }
};

// node_modules/lit-html/directives/unsafe-html.js
var e6 = class extends i5 {
  constructor(i6) {
    if (super(i6), this.it = A, i6.type !== t3.CHILD) throw Error(this.constructor.directiveName + "() can only be used in child bindings");
  }
  render(r6) {
    if (r6 === A || null == r6) return this._t = void 0, this.it = r6;
    if (r6 === E) return r6;
    if ("string" != typeof r6) throw Error(this.constructor.directiveName + "() called with a non-string value");
    if (r6 === this.it) return this._t;
    this.it = r6;
    const s4 = [r6];
    return s4.raw = s4, this._t = { _$litType$: this.constructor.resultType, strings: s4, values: [] };
  }
};
e6.directiveName = "unsafeHTML", e6.resultType = 1;
var o6 = e5(e6);

// src/runDetail.ts
var REFUSAL_WORDS = {
  "no-session": "No session is open on this page.",
  "no-run": "This session's runs no longer include this one.",
  "not-this-session": "This run belongs to another session.",
  "no-transcript": "This machine has no conversation recorded for this run."
};
var UNREADABLE = "This machine could not read this run.";
function isRunRefusal(reason) {
  return typeof reason === "string" && Object.hasOwn(REFUSAL_WORDS, reason);
}
function refusalWords(answer) {
  const reason = Reflect.get(answer, "reason");
  return isRunRefusal(reason) ? REFUSAL_WORDS[reason] : UNREADABLE;
}
function detailViewOf(answer) {
  if (typeof answer !== "object" || answer === null) return { kind: "failed" };
  if (Reflect.get(answer, "known") !== true) return { kind: "refused", words: refusalWords(answer) };
  const task = textOrAbsentOf(Reflect.get(answer, "task"));
  if (task === void 0) return { kind: "failed" };
  const result = textOrAbsentOf(Reflect.get(answer, "result"));
  const error = Reflect.get(answer, "error");
  const messages = messageCountOf(Reflect.get(answer, "messages"));
  return {
    kind: "detail",
    detail: {
      task,
      ...result === void 0 ? {} : { result },
      facts: factsOf(Reflect.get(answer, "facts")),
      ...typeof error === "string" && error !== "" ? { error } : {},
      ...messages === void 0 ? {} : { messages }
    }
  };
}
function messageCountOf(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const count = Reflect.get(value, "count");
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? { count, truncated: Reflect.get(value, "truncated") === true } : void 0;
}
function messageCountWords(messages, running) {
  const counted = `${String(messages.count)} ${messages.count === 1 ? "message" : "messages"}`;
  return `${messages.truncated ? `at least ${counted}` : counted}${running ? " so far" : ""}`;
}
function textOrAbsentOf(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const absent = Reflect.get(value, "absent");
  if (absent === "not-recorded" || absent === "not-written" || absent === "unreadable") return { absent };
  const text = Reflect.get(value, "text");
  const totalBytes = Reflect.get(value, "totalBytes");
  const truncated = Reflect.get(value, "truncated");
  if (typeof text !== "string") return void 0;
  return { text, totalBytes: typeof totalBytes === "number" ? totalBytes : text.length, truncated: truncated === true };
}
function factsOf(value) {
  if (typeof value !== "object" || value === null) return {};
  const number = (key) => {
    const field = Reflect.get(value, key);
    return typeof field === "number" && Number.isFinite(field) ? field : void 0;
  };
  const model = Reflect.get(value, "model");
  const tokensIn = number("tokensIn");
  const tokensOut = number("tokensOut");
  const tokensCached = number("tokensCached");
  const cost = number("cost");
  const turns = number("turns");
  const durationMs = number("durationMs");
  return {
    ...typeof model === "string" && model !== "" ? { model } : {},
    ...tokensIn === void 0 ? {} : { tokensIn },
    ...tokensOut === void 0 ? {} : { tokensOut },
    ...tokensCached === void 0 ? {} : { tokensCached },
    ...cost === void 0 ? {} : { cost },
    ...turns === void 0 ? {} : { turns },
    ...durationMs === void 0 ? {} : { durationMs }
  };
}
function formatTokens(count) {
  if (count < 1e3) return String(Math.round(count));
  if (count < 1e4) return `${(count / 1e3).toFixed(1)}k`;
  if (count < 999500) return `${String(Math.round(count / 1e3))}k`;
  return `${(count / 1e6).toFixed(1)}M`;
}
function byteSize(bytes) {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
function factsLine(facts, outcome) {
  const parts = [
    facts.model,
    facts.tokensIn === void 0 ? void 0 : `${formatTokens(facts.tokensIn)} in`,
    facts.tokensOut === void 0 ? void 0 : `${formatTokens(facts.tokensOut)} out`,
    facts.tokensCached === void 0 ? void 0 : `${formatTokens(facts.tokensCached)} cached`,
    facts.cost === void 0 ? void 0 : `$${facts.cost.toFixed(2)}`,
    facts.turns === void 0 ? void 0 : `${String(facts.turns)} ${facts.turns === 1 ? "turn" : "turns"}`,
    facts.durationMs === void 0 ? void 0 : formatElapsed(facts.durationMs),
    outcome
  ];
  return parts.filter((part) => part !== void 0 && part !== "").join(" \xB7 ");
}
function firstPartWords(read) {
  return read.truncated ? `Showing the first ${byteSize(new TextEncoder().encode(read.text).length)} of ${byteSize(read.totalBytes)}.` : void 0;
}
function outcomeKind(status, stoppedHere) {
  if (status === "stopped") return stoppedHere ? "stopped-here" : "stopped";
  if (status === "failed" || status === "lost" || status === "unknown") return status;
  return "none";
}
var OUTCOME_LINES = {
  none: () => void 0,
  failed: (_row, error) => ({ text: error ?? "It failed without saying why.", tone: "problem" }),
  "stopped-here": () => ({ text: "Stopped from this page.", tone: "neutral" }),
  stopped: () => ({ text: "Stopped.", tone: "neutral" }),
  lost: (row, _error, now) => ({
    text: `${runPresentation(row, now).detail}.${row.lastActivity === void 0 ? "" : ` Its last step: ${row.lastActivity}`}`,
    tone: "problem"
  }),
  unknown: () => ({ text: "This machine has no outcome for it.", tone: "neutral" })
};
function outcomeLine(row, error, stoppedHere, now) {
  return OUTCOME_LINES[outcomeKind(row.status, stoppedHere)](row, error ?? row.error, now);
}
function formatAgo(at, now) {
  const ms = at === void 0 ? Number.NaN : now - Date.parse(at);
  if (!Number.isFinite(ms)) return void 0;
  const seconds = Math.max(0, Math.round(ms / 1e3));
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  return `${String(Math.floor(minutes / 60))}h ago`;
}
function conversationViewOf(answer) {
  if (typeof answer !== "object" || answer === null) return { kind: "failed" };
  if (Reflect.get(answer, "known") !== true) return { kind: "refused", words: refusalWords(answer) };
  const raw = Reflect.get(answer, "turns");
  if (!Array.isArray(raw)) return { kind: "failed" };
  const turns = [];
  for (const value of raw) {
    const turn = turnOf(value);
    if (turn !== void 0) turns.push(turn);
  }
  const totalBytes = Reflect.get(answer, "totalBytes");
  const shownBytes = Reflect.get(answer, "shownBytes");
  const cut = Reflect.get(answer, "truncated") === true && typeof totalBytes === "number" && typeof shownBytes === "number" ? `Showing the last ${byteSize(shownBytes)} of ${byteSize(totalBytes)}` : void 0;
  return { kind: "conversation", turns, cut };
}
function turnOf(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const kind = Reflect.get(value, "kind");
  const text = Reflect.get(value, "text");
  const name = Reflect.get(value, "name");
  if ((kind === "user" || kind === "assistant") && typeof text === "string") return { kind, text };
  if (kind === "tool-call" && typeof name === "string") {
    const args = Reflect.get(value, "args");
    return { kind, name, args: typeof args === "string" ? args : "" };
  }
  if (kind === "tool-result" && typeof name === "string" && typeof text === "string") {
    const moreLines = Reflect.get(value, "moreLines");
    return { kind, name, text, moreLines: typeof moreLines === "number" ? moreLines : 0, failed: Reflect.get(value, "failed") === true };
  }
  return void 0;
}
function conversationItems(turns, running) {
  const items = [];
  const open = [];
  let users = 0;
  for (const turn of turns) {
    if (turn.kind === "user") items.push({ kind: "user", text: turn.text, steer: users++ > 0 });
    else if (turn.kind === "assistant") items.push({ kind: "assistant", text: turn.text });
    else if (turn.kind === "tool-call") {
      const call = { name: turn.name, args: turn.args, outcome: void 0 };
      open.push(call);
      items.push(call);
    } else {
      const index = open.findIndex((call2) => call2.name === turn.name);
      const call = index === -1 ? void 0 : open.splice(index, 1)[0];
      const outcome = callOutcomeOf(turn);
      if (call === void 0) items.push({ name: turn.name, args: "", outcome });
      else call.outcome = outcome;
    }
  }
  const unanswered = { kind: running ? "running" : "no-result" };
  return items.map((item) => "kind" in item ? item : { kind: "call", name: item.name, args: item.args, outcome: item.outcome ?? unanswered });
}
function callOutcomeOf(result) {
  if (result.failed) return { kind: "failed", text: result.text, moreLines: result.moreLines };
  return { kind: "lines", lines: (result.text === "" ? 0 : result.text.split("\n").length) + result.moreLines };
}

// src/runDetailElement.ts
var ABSENT_WORDS = {
  task: { "not-recorded": "Not recorded where this machine can read it.", "not-written": "Not recorded where this machine can read it.", unreadable: "Could not read the task." },
  result: { "not-recorded": "The run wrote no result.", "not-written": "The run wrote no result.", unreadable: "Could not read the result." }
};
var SubagentRunDetail = class extends i4 {
  constructor() {
    super(...arguments);
    this.read = { kind: "reading" };
    this.stoppedHere = false;
    this.now = 0;
    this.taskOpen = false;
    this.resultOpen = false;
    this.taskOverflows = false;
    this.resultOverflows = false;
  }
  willUpdate(changed) {
    const ui = this.ui;
    if (!changed.has("ui") || ui === void 0 || !(this.renderRoot instanceof ShadowRoot)) return;
    ui.adoptSheets?.(this.renderRoot, [
      ...ui.textStyles === void 0 ? [] : [ui.textStyles],
      ...ui.desktopQuery === void 0 ? [] : [i`@media ${r(ui.desktopQuery)} { :host { --subagent-result-lines: 24; } }`]
    ]);
  }
  updated() {
    if (!this.taskOpen) this.taskOverflows = this.overflows(".task");
    if (!this.resultOpen) this.resultOverflows = this.overflows(".result");
  }
  overflows(selector) {
    const element = this.renderRoot.querySelector(selector);
    return element !== null && element.scrollHeight > element.clientHeight + 1;
  }
  render() {
    const ui = this.ui;
    const row = this.row;
    if (ui === void 0 || row === void 0) return A;
    const read = this.read;
    const detail = read.kind === "detail" ? read.detail : void 0;
    const running = row.status === "running";
    return b2`
      ${this.renderReadState(ui)}
      ${this.renderTask(ui, detail?.task)}
      ${running ? this.renderRunning(row) : this.renderFinished(ui, row, detail?.result, detail?.error, detail?.facts ?? { durationMs: row.elapsedMs })}
      ${this.renderConversation(ui, detail?.messages, running)}
    `;
  }
  renderReadState(ui) {
    const read = this.read;
    if (read.kind === "refused") return b2`<p class="muted">${read.words}</p>`;
    if (read.kind !== "failed") return A;
    return b2`<div class="actions start"><p class="problem grow">Could not read this run.${read.words === void 0 ? "" : ` ${read.words}`}</p>${ui.renderButton({ label: "Read again", run: () => {
      this.onReadAgain?.();
    } })}</div>`;
  }
  renderTask(ui, task) {
    if (task === void 0) return b2`<p class="muted">${this.read.kind === "reading" ? "Reading\u2026" : "Not known."}</p>`;
    if ("absent" in task) return b2`<p class="muted">${ABSENT_WORDS.task[task.absent]}</p>`;
    const cut = firstPartWords(task);
    return b2`
      <div class="ask"><span class="who">task</span><p class="text task ${this.taskOpen ? "" : "clamped"}">${task.text}</p></div>
      ${this.renderToggle(ui, this.taskOpen, this.taskOverflows, () => {
      this.taskOpen = !this.taskOpen;
    })}
      ${cut === void 0 || !this.taskOpen ? A : b2`<p class="muted">${cut}</p>`}
    `;
  }
  renderToggle(ui, open, overflows, toggle) {
    if (!open && !overflows) return A;
    return b2`<div class="after">${ui.renderButton({ label: open ? "Show less" : "Show all", run: toggle })}</div>`;
  }
  renderRunning(row) {
    const ago = formatAgo(row.lastActivityAt, this.now);
    return b2`
      <div class="live">
        <p class=${row.lastActivity === void 0 ? "muted" : "step"}>${row.lastActivity ?? "No step recorded yet."}</p>
        ${ago === void 0 ? A : b2`<p class="when">${ago}</p>`}
      </div>
      <slot></slot>
    `;
  }
  renderFinished(ui, row, result, error, facts) {
    const presentation = runPresentation(row, this.now);
    const outcome = outcomeLine(row, error, this.stoppedHere, this.now);
    return b2`
      ${this.renderResult(ui, result)}
      ${outcome === void 0 ? A : b2`<p class="outcome ${outcome.tone}">${outcome.text}</p>`}
      <p class="muted facts">${factsLine(facts, presentation.label)}</p>
    `;
  }
  renderResult(ui, result) {
    if (result === void 0) return b2`<p class="muted">${this.read.kind === "reading" ? "Reading\u2026" : "Not known."}</p>`;
    if ("absent" in result) return b2`<p class="muted">${ABSENT_WORDS.result[result.absent]}</p>`;
    const cut = firstPartWords(result);
    const body = ui.renderMarkdownHtml === void 0 ? b2`<p class="text">${result.text}</p>` : b2`<div class="formatted">${o6(this.markdownHtml(ui.renderMarkdownHtml, result.text))}</div>`;
    return b2`
      <div class="result ${this.resultOpen ? "" : "clamped"}">${body}</div>
      ${this.renderToggle(ui, this.resultOpen, this.resultOverflows, () => {
      this.resultOpen = !this.resultOpen;
    })}
      ${cut === void 0 ? A : b2`<p class="muted">${cut}</p>`}
    `;
  }
  renderConversation(ui, messages, running) {
    const conversation = this.conversation;
    if (conversation === void 0) return A;
    const failed = conversation.busy ? void 0 : conversation.failed;
    const count = conversation.busy ? "Opening\u2026" : failed ?? (messages === void 0 ? "" : messageCountWords(messages, running));
    return b2`<button class="nav" type="button" aria-busy=${conversation.busy ? "true" : "false"} ?disabled=${conversation.busy} @click=${conversation.open}>
      <span class="name">Conversation</span><span class="count ${failed === void 0 ? "" : "problem"}">${count}</span>${ui.chevron ?? A}
    </button>`;
  }
  /** The list redraws every few seconds; the same result is rendered to HTML once. */
  markdownHtml(render, source) {
    if (this.markdown?.source !== source) this.markdown = { source, html: render(source) };
    return this.markdown.html;
  }
  static {
    this.styles = i`
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
};
__decorateClass([
  n4({ attribute: false })
], SubagentRunDetail.prototype, "ui", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunDetail.prototype, "row", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunDetail.prototype, "read", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunDetail.prototype, "stoppedHere", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunDetail.prototype, "now", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunDetail.prototype, "conversation", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentRunDetail.prototype, "onReadAgain", 2);
__decorateClass([
  r5()
], SubagentRunDetail.prototype, "taskOpen", 2);
__decorateClass([
  r5()
], SubagentRunDetail.prototype, "resultOpen", 2);
__decorateClass([
  r5()
], SubagentRunDetail.prototype, "taskOverflows", 2);
__decorateClass([
  r5()
], SubagentRunDetail.prototype, "resultOverflows", 2);
function defineRunDetail() {
  if (customElements.get("subagent-run-detail") === void 0) customElements.define("subagent-run-detail", SubagentRunDetail);
}

// src/conversationElement.ts
var BACK_ICON = b2`<svg class="key-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 6l-6 6 6 6"></path></svg>`;
var REFRESH_ICON = b2`<svg class="key-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>`;
function callSummary(outcome) {
  switch (outcome.kind) {
    case "running":
      return "running";
    case "no-result":
      return "no result";
    case "failed":
      return "failed";
    case "lines":
      return outcome.lines === 0 ? "no output" : `${String(outcome.lines)} ${outcome.lines === 1 ? "line" : "lines"}`;
  }
}
var SubagentConversation = class extends i4 {
  constructor() {
    super(...arguments);
    this.agent = "subagent";
    this.view = { kind: "failed" };
    this.refreshing = false;
    this.readAt = /* @__PURE__ */ new Date();
  }
  willUpdate(changed) {
    if (changed.has("view")) this.readAt = /* @__PURE__ */ new Date();
    const ui = this.ui;
    if (!changed.has("ui") || ui?.textStyles === void 0 || !(this.renderRoot instanceof ShadowRoot)) return;
    ui.adoptSheets?.(this.renderRoot, [ui.textStyles]);
  }
  updated(changed) {
    if (!changed.has("view")) return;
    const scroller = this.renderRoot.querySelector(".scroll");
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
  }
  render() {
    const ui = this.ui;
    if (ui === void 0) return A;
    const view = this.view;
    const refresh = this.refresh;
    const heading = `${this.agent} \xB7 conversation`;
    return b2`
      <header>
        <button class="key" type="button" aria-label="Back" title="Back" @click=${() => {
      this.close?.();
    }}>${BACK_ICON}</button>
        <h2 class="title">${heading}</h2>
        ${refresh === void 0 ? b2`<span class="key-space"></span>` : b2`<button class="key" type="button" aria-label="Refresh" title="Refresh" aria-busy=${this.refreshing ? "true" : "false"} ?disabled=${this.refreshing} @click=${() => {
      void this.refreshNow(refresh);
    }}>${REFRESH_ICON}</button>`}
      </header>
      <div class="scroll" role="log" aria-label=${heading}>
        <div class="column">${this.renderBody(ui, view, refresh !== void 0)}</div>
      </div>
    `;
  }
  async refreshNow(refresh) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.view = await refresh();
    } finally {
      this.refreshing = false;
    }
  }
  renderBody(ui, view, running) {
    if (view.kind === "failed") return b2`<p class="note problem">Could not read this run.${view.words === void 0 ? "" : ` ${view.words}`}</p>`;
    if (view.kind === "refused") return b2`<p class="note">${view.words}</p>`;
    const snapshot = running ? `snapshot at ${this.readAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : void 0;
    const line = [view.cut, snapshot].filter((part) => part !== void 0).join(" \xB7 ");
    return b2`
      ${line === "" ? A : b2`<p class="cut">${line}</p>`}
      ${view.turns.length === 0 ? b2`<p class="note">No messages recorded yet.</p>` : conversationItems(view.turns, running).map((item) => this.renderItem(ui, item))}
    `;
  }
  renderItem(ui, item) {
    switch (item.kind) {
      case "user":
        return b2`<div class="bubble">${item.steer ? b2`<span class="who">steer</span>` : A}<p class="plain">${item.text}</p></div>`;
      case "assistant":
        return b2`<div class="agent"><span class="who">${this.agent}</span><div class="formatted">${o6(ui.renderMarkdownHtml(item.text))}</div></div>`;
      case "call":
        return b2`
        <div class="call ${item.outcome.kind}">
          <span class="name">→ ${item.name}</span><span class="args">${item.args}</span><span class="sum">${callSummary(item.outcome)}</span>
        </div>
        ${item.outcome.kind === "failed" && item.outcome.text.trim() !== "" ? b2`<pre class="peek">${item.outcome.text}${item.outcome.moreLines > 0 ? `
\u2026 ${String(item.outcome.moreLines)} more ${item.outcome.moreLines === 1 ? "line" : "lines"}` : ""}</pre>` : A}`;
    }
  }
  static {
    this.styles = i`
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
};
__decorateClass([
  n4({ attribute: false })
], SubagentConversation.prototype, "ui", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentConversation.prototype, "agent", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentConversation.prototype, "view", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentConversation.prototype, "refresh", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentConversation.prototype, "close", 2);
__decorateClass([
  r5()
], SubagentConversation.prototype, "refreshing", 2);
__decorateClass([
  r5()
], SubagentConversation.prototype, "readAt", 2);
function defineConversation() {
  if (customElements.get("subagent-conversation") === void 0) customElements.define("subagent-conversation", SubagentConversation);
}

// src/runsRead.ts
var READ_PRESUMED_DEAD_MS = 35e3;
var COULD_NOT_ASK = { kind: "unknown", reason: "This machine could not be asked for the runs." };
var RunsRead = class {
  constructor(ask, changed, now = Date.now) {
    this.ask = ask;
    this.changed = changed;
    this.now = now;
    this.refreshFailed = false;
    this.issued = 0;
    this.applied = 0;
    this.readAgain = false;
  }
  /** The session the panel reads, and what it has for it; undefined before this session was read. */
  view(sessionFile) {
    return this.sessionFile === sessionFile ? { state: this.shown, refreshFailed: this.refreshFailed } : void 0;
  }
  /** The session on screen. A new one starts over and reads at once; says whether it did. */
  select(sessionFile) {
    if (this.sessionFile === sessionFile) return false;
    this.sessionFile = sessionFile;
    this.shown = void 0;
    this.refreshFailed = false;
    this.inFlight = void 0;
    this.readAgain = false;
    this.read();
    return true;
  }
  /**
   * Something changed: read now, or, with a read already on its way, once more when it lands.
   * That read may have been asked before the change, and a poll that stops on the change would
   * otherwise keep its answer for good. There is still only ever one read in flight.
   */
  refresh() {
    if (this.sessionFile === void 0) return;
    if (this.inFlight !== void 0 && this.now() - this.inFlight.startedAt < READ_PRESUMED_DEAD_MS) {
      this.readAgain = true;
      return;
    }
    this.read();
  }
  /** A poll tick: read again unless a read of this session is still on its way. */
  tick() {
    if (this.sessionFile === void 0) return;
    if (this.inFlight !== void 0 && this.now() - this.inFlight.startedAt < READ_PRESUMED_DEAD_MS) return;
    this.read();
  }
  read() {
    const sessionFile = this.sessionFile;
    if (sessionFile === void 0) return;
    const seq = ++this.issued;
    this.inFlight = { seq, startedAt: this.now() };
    this.ask(sessionFile).then(
      (answer) => {
        this.settle(sessionFile, seq, subagentListState(answer));
      },
      () => {
        this.settle(sessionFile, seq, void 0);
      }
    );
  }
  settle(sessionFile, seq, answered) {
    if (this.sessionFile !== sessionFile) return;
    if (this.inFlight?.seq === seq) {
      this.inFlight = void 0;
      if (this.readAgain) {
        this.readAgain = false;
        this.read();
      }
    }
    if (seq < this.applied) return;
    this.applied = seq;
    if (answered !== void 0) {
      this.shown = answered;
      this.refreshFailed = false;
    } else if (this.shown?.kind === "rows" || this.shown?.kind === "empty") {
      this.refreshFailed = true;
    } else {
      this.shown = COULD_NOT_ASK;
    }
    this.changed();
  }
};

// src/runsPolling.ts
var DECISIONS = {
  unfollowed: {
    unknown: { read: true, poll: false },
    idle: { read: true, poll: false },
    working: { read: true, poll: true }
  },
  unknown: {
    unknown: { read: false, poll: false },
    idle: { read: false, poll: false },
    working: { read: false, poll: true }
  },
  idle: {
    unknown: { read: false, poll: false },
    idle: { read: false, poll: false },
    working: { read: true, poll: true }
  },
  working: {
    unknown: { read: false, poll: true },
    idle: { read: true, poll: false },
    working: { read: false, poll: true }
  }
};
function runsActivityOf(status) {
  if (status === void 0) return "unknown";
  return status.isStreaming || (status.backgroundRunCount ?? 0) > 0 ? "working" : "idle";
}
function runsPollingDecision(previous, next) {
  return DECISIONS[previous][next];
}
function followedAfter(previous, next) {
  return next === "unknown" && previous !== "unfollowed" ? previous : next;
}
var UNSEEN_ANSWERS_BEFORE_STOP = 2;

// src/onScreenMarker.ts
var ON_SCREEN_MARKER_TAG = "pi-subagents-on-screen";
var sharedObserver;
function defineOnScreenMarker() {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined" || customElements.get(ON_SCREEN_MARKER_TAG) !== void 0) return;
  class SubagentsOnScreenMarker extends HTMLElement {
    connectedCallback() {
      this.style.display = "block";
      if (typeof IntersectionObserver === "undefined") return;
      sharedObserver ??= new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target instanceof SubagentsOnScreenMarker) entry.target.onChange?.(entry.isIntersecting);
        }
      });
      sharedObserver.observe(this);
    }
    disconnectedCallback() {
      sharedObserver?.unobserve(this);
      this.onChange?.(false);
    }
  }
  customElements.define(ON_SCREEN_MARKER_TAG, SubagentsOnScreenMarker);
}

// src/supervisorRequest.ts
var REASONS = {
  need_decision: "need_decision",
  interview_request: "interview_request",
  progress_update: "progress_update"
};
var REASON_LABEL = {
  need_decision: "Decision request",
  interview_request: "Interview request",
  progress_update: "Progress update",
  unknown: "Message"
};
function readString(payload, key) {
  if (typeof payload !== "object" || payload === null) return void 0;
  const value = Reflect.get(payload, key);
  return typeof value === "string" && value !== "" ? value : void 0;
}
function supervisorRequest(payload) {
  const expects = typeof payload === "object" && payload !== null ? Reflect.get(payload, "expectsReply") : void 0;
  return {
    requestId: readString(payload, "requestId") ?? readString(payload, "id"),
    runId: readString(payload, "runId"),
    agent: readString(payload, "agent"),
    childTarget: readString(payload, "childTarget"),
    reason: REASONS[readString(payload, "reason") ?? ""] ?? "unknown",
    expectsReply: expects === true,
    body: readString(payload, "requestBody") ?? readString(payload, "message")
  };
}
function supervisorTitle(request) {
  const who = request.agent ?? "a subagent";
  return `${REASON_LABEL[request.reason]} from ${who}`;
}
function offersReply(request) {
  return request.expectsReply;
}
function replyMessage(request, text) {
  return `${replyPrefix(request)}${text.trim()}`;
}
function replyPrefix(request) {
  const target = request.childTarget ?? request.agent ?? "the subagent";
  const about = [
    ...request.runId === void 0 ? [] : [`run ${request.runId}`],
    ...request.requestId === void 0 ? [] : [`request ${request.requestId}`]
  ];
  return `Reply to ${target}${about.length === 0 ? "" : ` (${about.join(", ")})`}: `;
}
var REPLY_ENTRY_TAG = "subagent_supervisor_reply";
function deliveredReply(request, followingRows) {
  if (request.requestId === void 0) return void 0;
  const entry = followingRows.find((row) => row.tag === REPLY_ENTRY_TAG && readString(row.payload, "requestId") === request.requestId);
  return entry === void 0 ? void 0 : { text: readString(entry.payload, "message") ?? "" };
}
function replyStanding(request, followingRows, followingUserTexts) {
  if (!offersReply(request)) return { kind: "not-expected", text: "" };
  const delivered = deliveredReply(request, followingRows);
  if (delivered !== void 0) return { kind: "delivered", text: delivered.text };
  const asked = answeredReply(request, followingUserTexts);
  return asked === void 0 ? { kind: "open", text: "" } : { kind: "asked", text: asked };
}
function answeredReply(request, followingUserTexts) {
  if (!offersReply(request)) return void 0;
  const prefix = replyPrefix(request);
  const reply = followingUserTexts.find((text) => text.startsWith(prefix) && text.length > prefix.length);
  return reply?.slice(prefix.length);
}

// src/supervisorCardElement.ts
var SubagentSupervisorCard = class extends i4 {
  constructor() {
    super(...arguments);
    this.standing = { kind: "open", text: "" };
    this.draft = "";
    this.sent = false;
  }
  /** The draft and a sent reply belong to one request: a card handed another starts empty. */
  willUpdate(changed) {
    if (!changed.has("request")) return;
    const previous = changed.get("request");
    if (previous === void 0 || sameRequest(previous, this.request)) return;
    this.draft = "";
    this.sent = false;
  }
  render() {
    const request = this.request;
    if (request === void 0) return b2`<strong>Subagent message</strong>`;
    return b2`
      <strong>${supervisorTitle(request)}</strong>
      ${request.runId === void 0 ? null : b2`<small class="run">Run ${request.runId}</small>`}
      ${request.body === void 0 ? null : b2`<p class="body">${request.body}</p>`}
      ${this.renderStanding(request)}
    `;
  }
  /** One drawing per standing; a reply sent from this card for this request counts as asked until the transcript shows it. */
  renderStanding(request) {
    const standing = this.standing.kind === "open" && this.sent ? { kind: "asked", text: "" } : this.standing;
    const drawings = {
      "not-expected": () => b2`<small class="quiet">No reply expected.</small>`,
      delivered: (text) => b2`<small class="quiet">Delivered to ${request.agent ?? "the subagent"}: ${text}</small>`,
      asked: (text) => b2`<small class="quiet">${text === "" ? "Reply sent to this session" : `Sent to this session: ${text}`}. Waiting for the agent to relay it to the child.</small>`,
      open: () => this.renderReply(request)
    };
    return drawings[standing.kind](standing.text);
  }
  renderReply(request) {
    return b2`
      <div class="reply">
        <input
          class="reply-input"
          aria-label="Reply to this subagent"
          placeholder="Reply…"
          .value=${this.draft}
          @input=${(event) => {
      if (event.target instanceof HTMLInputElement) this.draft = event.target.value;
    }}
        >
        <div class="reply-actions">
          <button type="button" ?disabled=${this.draft.trim() === "" || this.onSend === void 0} @click=${() => {
      void this.send(request);
    }}>Send</button>
          <button type="button" ?disabled=${this.draft.trim() === "" || this.onInsert === void 0} @click=${() => {
      this.onInsert?.(replyMessage(request, this.draft));
    }}>Edit in composer</button>
        </div>
        <small class="quiet">Sent to this session as a message; the agent relays it to the child.</small>
      </div>
    `;
  }
  async send(request) {
    const text = this.draft.trim();
    if (text === "" || this.onSend === void 0) return;
    await this.onSend(replyMessage(request, text));
    this.draft = "";
    this.sent = true;
  }
  static {
    this.styles = i`
    :host { display: block; }
    strong { display: block; color: var(--pi-text); }
    small { display: block; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .run { font-family: var(--pi-font-mono); }
    .body { margin: var(--pi-space-3) 0 0; color: var(--pi-text); white-space: pre-wrap; overflow-wrap: anywhere; }
    .reply { display: flex; flex-direction: column; gap: var(--pi-space-3); margin-top: var(--pi-space-3); }
    .reply-input { box-sizing: border-box; width: 100%; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); font: inherit; }
    .reply-actions { display: flex; gap: var(--pi-space-3); }
    .reply-actions button { box-sizing: border-box; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; }
    .reply-actions button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    @media (pointer: coarse) {
      .reply-input, .reply-actions button { min-height: var(--pi-control-height-touch); }
    }
  `;
  }
};
__decorateClass([
  n4({ attribute: false })
], SubagentSupervisorCard.prototype, "request", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentSupervisorCard.prototype, "onSend", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentSupervisorCard.prototype, "onInsert", 2);
__decorateClass([
  n4({ attribute: false })
], SubagentSupervisorCard.prototype, "standing", 2);
__decorateClass([
  r5()
], SubagentSupervisorCard.prototype, "draft", 2);
__decorateClass([
  r5()
], SubagentSupervisorCard.prototype, "sent", 2);
function sameRequest(previous, current) {
  if (current === void 0 || typeof previous !== "object" || previous === null) return false;
  return Reflect.get(previous, "requestId") === current.requestId && Reflect.get(previous, "runId") === current.runId && Reflect.get(previous, "childTarget") === current.childTarget;
}
function defineSupervisorCard() {
  void SubagentSupervisorCard;
}
if (customElements.get("pi-subagent-supervisor-card") === void 0) customElements.define("pi-subagent-supervisor-card", SubagentSupervisorCard);

// src/noticeSummary.ts
var TITLES = {
  "subagent-notify": "Subagent finished",
  "subagent-incremental-child-notify": "Subagent progress",
  "subagent_control_notice": "Subagent control",
  "subagent_steering_notice": "Subagent steering",
  "subagent_supervisor_reply": "Reply to a subagent",
  "subagent-compaction-resume": "Subagent resumed after compaction"
};
function readString2(payload, key) {
  if (typeof payload !== "object" || payload === null) return void 0;
  const value = Reflect.get(payload, key);
  return typeof value === "string" && value !== "" ? value : void 0;
}
function noticeSummary(tag, payload) {
  const agent = readString2(payload, "agent");
  const runId = readString2(payload, "runId");
  const status = readString2(payload, "status");
  const parts = [agent, status, runId === void 0 ? void 0 : `run ${runId}`].filter((part) => part !== void 0);
  return {
    title: TITLES[tag] ?? "Subagent message",
    detail: parts.length === 0 ? void 0 : parts.join(" \xB7 ")
  };
}

// src/pi-web-plugin.ts
var NOTICE_TAGS = [
  "subagent-notify",
  "subagent-incremental-child-notify",
  "subagent_control_notice",
  "subagent_steering_notice",
  "subagent_supervisor_reply",
  "subagent-compaction-resume"
];
function selectedSessionField(context, field) {
  const state = context.state;
  if (typeof state !== "object" || state === null) return void 0;
  const selected = Reflect.get(state, "selectedSession");
  if (typeof selected !== "object" || selected === null) return void 0;
  const value = Reflect.get(selected, field);
  return typeof value === "string" && value !== "" ? value : void 0;
}
function sessionFileOf(context) {
  return selectedSessionField(context, "path");
}
function runControlsUiOf(ui) {
  const renderButton = ui?.renderButton;
  const renderMessageField = ui?.renderMessageField;
  return renderButton === void 0 || renderMessageField === void 0 ? void 0 : { renderButton, renderMessageField };
}
function runDetailUiOf(ui, renderButton) {
  return {
    renderButton,
    renderMarkdownHtml: typeof ui?.renderMarkdownHtml === "function" ? ui.renderMarkdownHtml : void 0,
    textStyles: ui?.textStyles,
    adoptSheets: ui?.adoptSheets,
    desktopQuery: ui?.breakpoints?.desktopSideBySide,
    chevron: ui?.renderDisclosureIcon?.(true)
  };
}
function conversationUiOf(ui) {
  if (typeof ui?.showDialog !== "function" || typeof ui.renderMarkdownHtml !== "function") return void 0;
  return { renderMarkdownHtml: ui.renderMarkdownHtml, textStyles: ui.textStyles, adoptSheets: ui.adoptSheets };
}
var READING = { kind: "reading" };
var READ_FAILED = { kind: "failed" };
function renderRuns(html, ui, view, expansionOf) {
  if (ui?.renderList === void 0) return html`<p class="muted">This list needs a newer PI WEB on this device.</p>`;
  return ui.renderList(subagentListModel(view?.state, view?.refreshFailed === true, expansionOf, Date.now()));
}
var ELAPSED_REDRAW_MS = 1e3;
var plugin = {
  apiVersion: 2,
  name: "Subagents",
  activate: (context) => {
    const { html, svg } = context;
    const callOperation = context.callOperation;
    let requestUpdate = () => void 0;
    let polling;
    let elapsedRedraw;
    let followed;
    let unseenAnswers = 0;
    let panelShown;
    let selectedSession;
    const failedRead = (error) => {
      const words = context.ui?.describeError(error);
      return words === void 0 ? READ_FAILED : { kind: "failed", words };
    };
    const readView = (operation, input, viewOf) => callOperation === void 0 ? Promise.resolve(READ_FAILED) : callOperation(operation, input).then(viewOf, failedRead);
    const runs = new RunsRead(
      (sessionFile) => callOperation === void 0 ? Promise.reject(new Error("no operations")) : callOperation("runs.list", { sessionFile }),
      () => {
        unseenAnswers += 1;
        requestUpdate();
      }
    );
    const stopPolling = () => {
      clearInterval(polling);
      polling = void 0;
    };
    const keepElapsedMoving = (moving) => {
      if (moving && panelShown !== false) {
        elapsedRedraw ??= setInterval(() => {
          requestUpdate();
        }, ELAPSED_REDRAW_MS);
        return;
      }
      clearInterval(elapsedRedraw);
      elapsedRedraw = void 0;
    };
    const poll = () => {
      if (unseenAnswers >= UNSEEN_ANSWERS_BEFORE_STOP) {
        stopPolling();
        followed = void 0;
        return;
      }
      runs.tick();
    };
    context.on?.("session-activity-settled", () => {
      followed = void 0;
    });
    const onScreen = (shown) => {
      if (panelShown === shown) return;
      panelShown = shown;
      if (shown) requestUpdate();
      else keepElapsedMoving(false);
    };
    const shownFor = (panel) => {
      const sessionFile = sessionFileOf(panel);
      return sessionFile === void 0 ? void 0 : runs.view(sessionFile)?.state;
    };
    const follow = (panel, looking = true) => {
      const sessionFile = sessionFileOf(panel);
      selectedSession = sessionFile === void 0 ? void 0 : `${panel.machine.id}
${sessionFile}`;
      if (sessionFile === void 0) return void 0;
      requestUpdate = () => {
        panel.host.requestRender();
      };
      if (!looking) return sessionFile;
      unseenAnswers = 0;
      const switched = runs.select(sessionFile);
      const previous = followed?.sessionFile === sessionFile ? followed.activity : "unfollowed";
      const activity = runsActivityOf(panel.state?.status);
      const decision = runsPollingDecision(previous, activity);
      followed = { sessionFile, activity: followedAfter(previous, activity) };
      if (decision.read && !switched) runs.refresh();
      if (decision.poll) polling ??= setInterval(poll, 3e3);
      else stopPolling();
      return sessionFile;
    };
    const openRuns = /* @__PURE__ */ new Set();
    const runNotes = /* @__PURE__ */ new Map();
    const controlsUi = runControlsUiOf(context.ui);
    const detailUi = controlsUi === void 0 ? void 0 : runDetailUiOf(context.ui, controlsUi.renderButton);
    const conversationUi = conversationUiOf(context.ui);
    const details = /* @__PURE__ */ new Map();
    const conversationsReading = /* @__PURE__ */ new Set();
    const conversationFailures = /* @__PURE__ */ new Map();
    const readDetail = (panel, key, sessionFile, row) => {
      const reading = { status: row.status, view: READING };
      details.set(key, reading);
      void readView("runs.detail", { sessionFile, runId: row.runId, countMessages: conversationUi !== void 0 }, detailViewOf).then((view) => {
        if (details.get(key) !== reading) return;
        details.set(key, { status: row.status, view });
        panel.host.requestRender();
      });
    };
    const openConversation = (panel, key, sessionFile, row, ui) => {
      const hostUi = context.ui;
      if (hostUi === void 0) return;
      const read = () => readView("runs.conversation", { sessionFile, runId: row.runId }, conversationViewOf);
      const openDialog = (view) => {
        try {
          const dialog = hostUi.showDialog({
            label: `${row.agent} conversation`,
            presentation: "fullscreen",
            content: html`<subagent-conversation
              .ui=${ui}
              .agent=${row.agent}
              .view=${view}
              .refresh=${row.status === "running" ? read : void 0}
              .close=${() => {
              dialog.close();
            }}
            ></subagent-conversation>`
          });
        } catch (error) {
          conversationFailures.set(key, `Could not open it. ${hostUi.describeError(error)}`);
        }
      };
      const askedFor = `${panel.machine.id}
${sessionFile}`;
      conversationsReading.add(key);
      conversationFailures.delete(key);
      panel.host.requestRender();
      void read().then((view) => {
        conversationsReading.delete(key);
        if (selectedSession === askedFor) openDialog(view);
        panel.host.requestRender();
      });
    };
    const runCommand = async (panel, key, sessionFile, command, args) => {
      const session = panel.session;
      const sessionId = selectedSessionField(panel, "id");
      runNotes.set(key, { kind: "pending", command });
      panel.host.requestRender();
      const outcome = session === void 0 || sessionId === void 0 ? { kind: "refused", reason: "no-session", words: "No session is open on this page." } : await session.runCommand({ sessionId, name: RUN_COMMANDS[command], args }).catch(() => ({ kind: "unknown", words: "" }));
      runNotes.set(key, { kind: "answered", command, outcome, listAtAnswer: runs.view(sessionFile)?.state });
      runs.refresh();
      panel.host.requestRender();
      return outcome;
    };
    const expansionFor = (panel, sessionFile, ui, rowUi) => (row) => {
      const key = `${panel.machine.id}
${sessionFile}
${row.runId}`;
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
          if (entry === void 0 || entry.status !== row.status) readDetail(panel, key, sessionFile, row);
          const conversation = conversationUi === void 0 ? void 0 : {
            busy: conversationsReading.has(key),
            failed: conversationFailures.get(key),
            open: () => {
              if (!conversationsReading.has(key)) openConversation(panel, key, sessionFile, row, conversationUi);
            }
          };
          const running = row.status === "running";
          return html`<subagent-run-detail
            .ui=${rowUi}
            .row=${row}
            .read=${details.get(key)?.view ?? READING}
            .stoppedHere=${note?.command === "stop" && !(note.kind === "answered" && note.outcome.kind === "refused")}
            .now=${running ? Date.now() : 0}
            .conversation=${conversation}
            .onReadAgain=${() => {
            readDetail(panel, key, sessionFile, row);
            panel.host.requestRender();
          }}
          >${running ? html`<subagent-run-controls
            .ui=${ui}
            .controls=${rowControls(row.control, panel.session !== void 0)}
            .agent=${row.agent}
            .note=${note === void 0 ? void 0 : noteLine(note, runs.view(sessionFile)?.state, row.agent)}
            .stopBusy=${stopPending(note)}
            .onSteer=${async (text) => steerTaken(await runCommand(panel, key, sessionFile, "steer", `${commandRunId} ${text}`))}
            .onStop=${() => {
            void runCommand(panel, key, sessionFile, "stop", commandRunId);
          }}
          ></subagent-run-controls>` : null}</subagent-run-detail>`;
        }
      };
    };
    const ensure = (panel) => {
      const sessionFile = follow(panel, panelShown !== false);
      if (sessionFile === void 0) return { state: { kind: "unknown", reason: "Open a session to see its subagents." }, refreshFailed: false };
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
            }
          },
          ...NOTICE_TAGS.map((tag) => ({
            id: `message.${tag.replace(/_/gu, "-")}`,
            tag,
            render: (view) => {
              const summary = noticeSummary(tag, view.payload);
              return html`<strong>${summary.title}</strong>${summary.detail === void 0 ? null : html`<small>${summary.detail}</small>`}`;
            }
          }))
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
              return state?.kind === "rows" && state.running > 0 ? state.running : void 0;
            },
            render: (panel) => {
              const sessionFile = sessionFileOf(panel);
              const expansionOf = controlsUi === void 0 || detailUi === void 0 || sessionFile === void 0 ? void 0 : expansionFor(panel, sessionFile, controlsUi, detailUi);
              const view = ensure(panel);
              keepElapsedMoving(view?.state?.kind === "rows" && view.state.running > 0);
              return html`<pi-subagents-on-screen .onChange=${onScreen}></pi-subagents-on-screen>${renderRuns(html, context.ui, view, expansionOf)}`;
            }
          }
        ]
      },
      dispose: () => {
        stopPolling();
        keepElapsedMoving(false);
      }
    };
  }
};
var pi_web_plugin_default = plugin;
export {
  pi_web_plugin_default as default
};
/*! Bundled license information:

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/reactive-element.js:
lit-html/lit-html.js:
lit-element/lit-element.js:
@lit/reactive-element/decorators/custom-element.js:
@lit/reactive-element/decorators/property.js:
@lit/reactive-element/decorators/state.js:
@lit/reactive-element/decorators/event-options.js:
@lit/reactive-element/decorators/base.js:
@lit/reactive-element/decorators/query.js:
@lit/reactive-element/decorators/query-all.js:
@lit/reactive-element/decorators/query-async.js:
@lit/reactive-element/decorators/query-assigned-nodes.js:
lit-html/directive.js:
lit-html/directives/unsafe-html.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/decorators/query-assigned-elements.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
