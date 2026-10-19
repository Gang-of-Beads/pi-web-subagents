var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i5 = decorators.length - 1, decorator; i5 >= 0; i5--)
    if (decorator = decorators[i5])
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
      { id: "finished", heading: "Finished", rows: rows.filter((row) => row.status !== "running").map((row) => listRow(row, now)) }
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
  return typeof runId === "string" && (toolRunId === void 0 || typeof toolRunId === "string") && (error === void 0 || typeof error === "string") && typeof agent === "string" && (status === "running" || status === "done" || status === "failed" || status === "stopped" || status === "lost" || status === "unknown");
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
  constructor(t3, e5, o6) {
    if (this._$cssResult$ = true, o6 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t3, this.t = e5;
  }
  get styleSheet() {
    let t3 = this.o;
    const s4 = this.t;
    if (e && void 0 === t3) {
      const e5 = void 0 !== s4 && 1 === s4.length;
      e5 && (t3 = o.get(s4)), void 0 === t3 && ((this.o = t3 = new CSSStyleSheet()).replaceSync(this.cssText), e5 && o.set(s4, t3));
    }
    return t3;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t3) => new n("string" == typeof t3 ? t3 : t3 + "", void 0, s);
var i = (t3, ...e5) => {
  const o6 = 1 === t3.length ? t3[0] : e5.reduce((e6, s4, o7) => e6 + ((t4) => {
    if (true === t4._$cssResult$) return t4.cssText;
    if ("number" == typeof t4) return t4;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t4 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s4) + t3[o7 + 1], t3[0]);
  return new n(o6, t3, s);
};
var S = (s4, o6) => {
  if (e) s4.adoptedStyleSheets = o6.map((t3) => t3 instanceof CSSStyleSheet ? t3 : t3.styleSheet);
  else for (const e5 of o6) {
    const o7 = document.createElement("style"), n5 = t.litNonce;
    void 0 !== n5 && o7.setAttribute("nonce", n5), o7.textContent = e5.cssText, s4.appendChild(o7);
  }
};
var c = e ? (t3) => t3 : (t3) => t3 instanceof CSSStyleSheet ? ((t4) => {
  let e5 = "";
  for (const s4 of t4.cssRules) e5 += s4.cssText;
  return r(e5);
})(t3) : t3;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t3, s4) => t3;
var u = { toAttribute(t3, s4) {
  switch (s4) {
    case Boolean:
      t3 = t3 ? l : null;
      break;
    case Object:
    case Array:
      t3 = null == t3 ? t3 : JSON.stringify(t3);
  }
  return t3;
}, fromAttribute(t3, s4) {
  let i5 = t3;
  switch (s4) {
    case Boolean:
      i5 = null !== t3;
      break;
    case Number:
      i5 = null === t3 ? null : Number(t3);
      break;
    case Object:
    case Array:
      try {
        i5 = JSON.parse(t3);
      } catch (t4) {
        i5 = null;
      }
  }
  return i5;
} };
var f = (t3, s4) => !i2(t3, s4);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ??= /* @__PURE__ */ Symbol("metadata"), a.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y = class extends HTMLElement {
  static addInitializer(t3) {
    this._$Ei(), (this.l ??= []).push(t3);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t3, s4 = b) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t3) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t3, s4), !s4.noAccessor) {
      const i5 = /* @__PURE__ */ Symbol(), h3 = this.getPropertyDescriptor(t3, i5, s4);
      void 0 !== h3 && e2(this.prototype, t3, h3);
    }
  }
  static getPropertyDescriptor(t3, s4, i5) {
    const { get: e5, set: r6 } = h(this.prototype, t3) ?? { get() {
      return this[s4];
    }, set(t4) {
      this[s4] = t4;
    } };
    return { get: e5, set(s5) {
      const h3 = e5?.call(this);
      r6?.call(this, s5), this.requestUpdate(t3, h3, i5);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t3) {
    return this.elementProperties.get(t3) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t3 = n2(this);
    t3.finalize(), void 0 !== t3.l && (this.l = [...t3.l]), this.elementProperties = new Map(t3.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t4 = this.properties, s4 = [...r2(t4), ...o2(t4)];
      for (const i5 of s4) this.createProperty(i5, t4[i5]);
    }
    const t3 = this[Symbol.metadata];
    if (null !== t3) {
      const s4 = litPropertyMetadata.get(t3);
      if (void 0 !== s4) for (const [t4, i5] of s4) this.elementProperties.set(t4, i5);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t4, s4] of this.elementProperties) {
      const i5 = this._$Eu(t4, s4);
      void 0 !== i5 && this._$Eh.set(i5, t4);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i5 = [];
    if (Array.isArray(s4)) {
      const e5 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e5) i5.unshift(c(s5));
    } else void 0 !== s4 && i5.push(c(s4));
    return i5;
  }
  static _$Eu(t3, s4) {
    const i5 = s4.attribute;
    return false === i5 ? void 0 : "string" == typeof i5 ? i5 : "string" == typeof t3 ? t3.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t3) => this.enableUpdating = t3), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t3) => t3(this));
  }
  addController(t3) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t3), void 0 !== this.renderRoot && this.isConnected && t3.hostConnected?.();
  }
  removeController(t3) {
    this._$EO?.delete(t3);
  }
  _$E_() {
    const t3 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i5 of s4.keys()) this.hasOwnProperty(i5) && (t3.set(i5, this[i5]), delete this[i5]);
    t3.size > 0 && (this._$Ep = t3);
  }
  createRenderRoot() {
    const t3 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t3, this.constructor.elementStyles), t3;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t3) => t3.hostConnected?.());
  }
  enableUpdating(t3) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t3) => t3.hostDisconnected?.());
  }
  attributeChangedCallback(t3, s4, i5) {
    this._$AK(t3, i5);
  }
  _$ET(t3, s4) {
    const i5 = this.constructor.elementProperties.get(t3), e5 = this.constructor._$Eu(t3, i5);
    if (void 0 !== e5 && true === i5.reflect) {
      const h3 = (void 0 !== i5.converter?.toAttribute ? i5.converter : u).toAttribute(s4, i5.type);
      this._$Em = t3, null == h3 ? this.removeAttribute(e5) : this.setAttribute(e5, h3), this._$Em = null;
    }
  }
  _$AK(t3, s4) {
    const i5 = this.constructor, e5 = i5._$Eh.get(t3);
    if (void 0 !== e5 && this._$Em !== e5) {
      const t4 = i5.getPropertyOptions(e5), h3 = "function" == typeof t4.converter ? { fromAttribute: t4.converter } : void 0 !== t4.converter?.fromAttribute ? t4.converter : u;
      this._$Em = e5;
      const r6 = h3.fromAttribute(s4, t4.type);
      this[e5] = r6 ?? this._$Ej?.get(e5) ?? r6, this._$Em = null;
    }
  }
  requestUpdate(t3, s4, i5, e5 = false, h3) {
    if (void 0 !== t3) {
      const r6 = this.constructor;
      if (false === e5 && (h3 = this[t3]), i5 ??= r6.getPropertyOptions(t3), !((i5.hasChanged ?? f)(h3, s4) || i5.useDefault && i5.reflect && h3 === this._$Ej?.get(t3) && !this.hasAttribute(r6._$Eu(t3, i5)))) return;
      this.C(t3, s4, i5);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t3, s4, { useDefault: i5, reflect: e5, wrapped: h3 }, r6) {
    i5 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t3) && (this._$Ej.set(t3, r6 ?? s4 ?? this[t3]), true !== h3 || void 0 !== r6) || (this._$AL.has(t3) || (this.hasUpdated || i5 || (s4 = void 0), this._$AL.set(t3, s4)), true === e5 && this._$Em !== t3 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t3));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t4) {
      Promise.reject(t4);
    }
    const t3 = this.scheduleUpdate();
    return null != t3 && await t3, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t5, s5] of this._$Ep) this[t5] = s5;
        this._$Ep = void 0;
      }
      const t4 = this.constructor.elementProperties;
      if (t4.size > 0) for (const [s5, i5] of t4) {
        const { wrapped: t5 } = i5, e5 = this[s5];
        true !== t5 || this._$AL.has(s5) || void 0 === e5 || this.C(s5, void 0, i5, e5);
      }
    }
    let t3 = false;
    const s4 = this._$AL;
    try {
      t3 = this.shouldUpdate(s4), t3 ? (this.willUpdate(s4), this._$EO?.forEach((t4) => t4.hostUpdate?.()), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t3 = false, this._$EM(), s5;
    }
    t3 && this._$AE(s4);
  }
  willUpdate(t3) {
  }
  _$AE(t3) {
    this._$EO?.forEach((t4) => t4.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t3)), this.updated(t3);
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
  shouldUpdate(t3) {
    return true;
  }
  update(t3) {
    this._$Eq &&= this._$Eq.forEach((t4) => this._$ET(t4, this[t4])), this._$EM();
  }
  updated(t3) {
  }
  firstUpdated(t3) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ??= []).push("2.1.2");

// node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = (t3) => t3;
var s2 = t2.trustedTypes;
var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t3) => t3 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t3) => null === t3 || "object" != typeof t3 && "function" != typeof t3;
var u2 = Array.isArray;
var d2 = (t3) => u2(t3) || "function" == typeof t3?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t3) => (i5, ...s4) => ({ _$litType$: t3, strings: i5, values: s4 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = /* @__PURE__ */ Symbol.for("lit-noChange");
var A = /* @__PURE__ */ Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t3, i5) {
  if (!u2(t3) || !t3.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e3 ? e3.createHTML(i5) : i5;
}
var N = (t3, i5) => {
  const s4 = t3.length - 1, e5 = [];
  let n5, l3 = 2 === i5 ? "<svg>" : 3 === i5 ? "<math>" : "", c4 = v;
  for (let i6 = 0; i6 < s4; i6++) {
    const s5 = t3[i6];
    let a3, u3, d3 = -1, f3 = 0;
    for (; f3 < s5.length && (c4.lastIndex = f3, u3 = c4.exec(s5), null !== u3); ) f3 = c4.lastIndex, c4 === v ? "!--" === u3[1] ? c4 = _ : void 0 !== u3[1] ? c4 = m : void 0 !== u3[2] ? (y2.test(u3[2]) && (n5 = RegExp("</" + u3[2], "g")), c4 = p2) : void 0 !== u3[3] && (c4 = p2) : c4 === p2 ? ">" === u3[0] ? (c4 = n5 ?? v, d3 = -1) : void 0 === u3[1] ? d3 = -2 : (d3 = c4.lastIndex - u3[2].length, a3 = u3[1], c4 = void 0 === u3[3] ? p2 : '"' === u3[3] ? $ : g) : c4 === $ || c4 === g ? c4 = p2 : c4 === _ || c4 === m ? c4 = v : (c4 = p2, n5 = void 0);
    const x2 = c4 === p2 && t3[i6 + 1].startsWith("/>") ? " " : "";
    l3 += c4 === v ? s5 + r3 : d3 >= 0 ? (e5.push(a3), s5.slice(0, d3) + h2 + s5.slice(d3) + o3 + x2) : s5 + o3 + (-2 === d3 ? i6 : x2);
  }
  return [V(t3, l3 + (t3[s4] || "<?>") + (2 === i5 ? "</svg>" : 3 === i5 ? "</math>" : "")), e5];
};
var S2 = class _S {
  constructor({ strings: t3, _$litType$: i5 }, e5) {
    let r6;
    this.parts = [];
    let l3 = 0, a3 = 0;
    const u3 = t3.length - 1, d3 = this.parts, [f3, v2] = N(t3, i5);
    if (this.el = _S.createElement(f3, e5), P.currentNode = this.el.content, 2 === i5 || 3 === i5) {
      const t4 = this.el.content.firstChild;
      t4.replaceWith(...t4.childNodes);
    }
    for (; null !== (r6 = P.nextNode()) && d3.length < u3; ) {
      if (1 === r6.nodeType) {
        if (r6.hasAttributes()) for (const t4 of r6.getAttributeNames()) if (t4.endsWith(h2)) {
          const i6 = v2[a3++], s4 = r6.getAttribute(t4).split(o3), e6 = /([.?@])?(.*)/.exec(i6);
          d3.push({ type: 1, index: l3, name: e6[2], strings: s4, ctor: "." === e6[1] ? I : "?" === e6[1] ? L : "@" === e6[1] ? z : H }), r6.removeAttribute(t4);
        } else t4.startsWith(o3) && (d3.push({ type: 6, index: l3 }), r6.removeAttribute(t4));
        if (y2.test(r6.tagName)) {
          const t4 = r6.textContent.split(o3), i6 = t4.length - 1;
          if (i6 > 0) {
            r6.textContent = s2 ? s2.emptyScript : "";
            for (let s4 = 0; s4 < i6; s4++) r6.append(t4[s4], c3()), P.nextNode(), d3.push({ type: 2, index: ++l3 });
            r6.append(t4[i6], c3());
          }
        }
      } else if (8 === r6.nodeType) if (r6.data === n3) d3.push({ type: 2, index: l3 });
      else {
        let t4 = -1;
        for (; -1 !== (t4 = r6.data.indexOf(o3, t4 + 1)); ) d3.push({ type: 7, index: l3 }), t4 += o3.length - 1;
      }
      l3++;
    }
  }
  static createElement(t3, i5) {
    const s4 = l2.createElement("template");
    return s4.innerHTML = t3, s4;
  }
};
function M(t3, i5, s4 = t3, e5) {
  if (i5 === E) return i5;
  let h3 = void 0 !== e5 ? s4._$Co?.[e5] : s4._$Cl;
  const o6 = a2(i5) ? void 0 : i5._$litDirective$;
  return h3?.constructor !== o6 && (h3?._$AO?.(false), void 0 === o6 ? h3 = void 0 : (h3 = new o6(t3), h3._$AT(t3, s4, e5)), void 0 !== e5 ? (s4._$Co ??= [])[e5] = h3 : s4._$Cl = h3), void 0 !== h3 && (i5 = M(t3, h3._$AS(t3, i5.values), h3, e5)), i5;
}
var R = class {
  constructor(t3, i5) {
    this._$AV = [], this._$AN = void 0, this._$AD = t3, this._$AM = i5;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t3) {
    const { el: { content: i5 }, parts: s4 } = this._$AD, e5 = (t3?.creationScope ?? l2).importNode(i5, true);
    P.currentNode = e5;
    let h3 = P.nextNode(), o6 = 0, n5 = 0, r6 = s4[0];
    for (; void 0 !== r6; ) {
      if (o6 === r6.index) {
        let i6;
        2 === r6.type ? i6 = new k(h3, h3.nextSibling, this, t3) : 1 === r6.type ? i6 = new r6.ctor(h3, r6.name, r6.strings, this, t3) : 6 === r6.type && (i6 = new Z(h3, this, t3)), this._$AV.push(i6), r6 = s4[++n5];
      }
      o6 !== r6?.index && (h3 = P.nextNode(), o6++);
    }
    return P.currentNode = l2, e5;
  }
  p(t3) {
    let i5 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t3, s4, i5), i5 += s4.strings.length - 2) : s4._$AI(t3[i5])), i5++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t3, i5, s4, e5) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t3, this._$AB = i5, this._$AM = s4, this.options = e5, this._$Cv = e5?.isConnected ?? true;
  }
  get parentNode() {
    let t3 = this._$AA.parentNode;
    const i5 = this._$AM;
    return void 0 !== i5 && 11 === t3?.nodeType && (t3 = i5.parentNode), t3;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t3, i5 = this) {
    t3 = M(this, t3, i5), a2(t3) ? t3 === A || null == t3 || "" === t3 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t3 !== this._$AH && t3 !== E && this._(t3) : void 0 !== t3._$litType$ ? this.$(t3) : void 0 !== t3.nodeType ? this.T(t3) : d2(t3) ? this.k(t3) : this._(t3);
  }
  O(t3) {
    return this._$AA.parentNode.insertBefore(t3, this._$AB);
  }
  T(t3) {
    this._$AH !== t3 && (this._$AR(), this._$AH = this.O(t3));
  }
  _(t3) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t3 : this.T(l2.createTextNode(t3)), this._$AH = t3;
  }
  $(t3) {
    const { values: i5, _$litType$: s4 } = t3, e5 = "number" == typeof s4 ? this._$AC(t3) : (void 0 === s4.el && (s4.el = S2.createElement(V(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e5) this._$AH.p(i5);
    else {
      const t4 = new R(e5, this), s5 = t4.u(this.options);
      t4.p(i5), this.T(s5), this._$AH = t4;
    }
  }
  _$AC(t3) {
    let i5 = C.get(t3.strings);
    return void 0 === i5 && C.set(t3.strings, i5 = new S2(t3)), i5;
  }
  k(t3) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i5 = this._$AH;
    let s4, e5 = 0;
    for (const h3 of t3) e5 === i5.length ? i5.push(s4 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s4 = i5[e5], s4._$AI(h3), e5++;
    e5 < i5.length && (this._$AR(s4 && s4._$AB.nextSibling, e5), i5.length = e5);
  }
  _$AR(t3 = this._$AA.nextSibling, s4) {
    for (this._$AP?.(false, true, s4); t3 !== this._$AB; ) {
      const s5 = i3(t3).nextSibling;
      i3(t3).remove(), t3 = s5;
    }
  }
  setConnected(t3) {
    void 0 === this._$AM && (this._$Cv = t3, this._$AP?.(t3));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t3, i5, s4, e5, h3) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t3, this.name = i5, this._$AM = e5, this.options = h3, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
  }
  _$AI(t3, i5 = this, s4, e5) {
    const h3 = this.strings;
    let o6 = false;
    if (void 0 === h3) t3 = M(this, t3, i5, 0), o6 = !a2(t3) || t3 !== this._$AH && t3 !== E, o6 && (this._$AH = t3);
    else {
      const e6 = t3;
      let n5, r6;
      for (t3 = h3[0], n5 = 0; n5 < h3.length - 1; n5++) r6 = M(this, e6[s4 + n5], i5, n5), r6 === E && (r6 = this._$AH[n5]), o6 ||= !a2(r6) || r6 !== this._$AH[n5], r6 === A ? t3 = A : t3 !== A && (t3 += (r6 ?? "") + h3[n5 + 1]), this._$AH[n5] = r6;
    }
    o6 && !e5 && this.j(t3);
  }
  j(t3) {
    t3 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t3 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t3) {
    this.element[this.name] = t3 === A ? void 0 : t3;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t3) {
    this.element.toggleAttribute(this.name, !!t3 && t3 !== A);
  }
};
var z = class extends H {
  constructor(t3, i5, s4, e5, h3) {
    super(t3, i5, s4, e5, h3), this.type = 5;
  }
  _$AI(t3, i5 = this) {
    if ((t3 = M(this, t3, i5, 0) ?? A) === E) return;
    const s4 = this._$AH, e5 = t3 === A && s4 !== A || t3.capture !== s4.capture || t3.once !== s4.once || t3.passive !== s4.passive, h3 = t3 !== A && (s4 === A || e5);
    e5 && this.element.removeEventListener(this.name, this, s4), h3 && this.element.addEventListener(this.name, this, t3), this._$AH = t3;
  }
  handleEvent(t3) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t3) : this._$AH.handleEvent(t3);
  }
};
var Z = class {
  constructor(t3, i5, s4) {
    this.element = t3, this.type = 6, this._$AN = void 0, this._$AM = i5, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t3) {
    M(this, t3);
  }
};
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ??= []).push("3.3.3");
var D = (t3, i5, s4) => {
  const e5 = s4?.renderBefore ?? i5;
  let h3 = e5._$litPart$;
  if (void 0 === h3) {
    const t4 = s4?.renderBefore ?? null;
    e5._$litPart$ = h3 = new k(i5.insertBefore(c3(), t4), t4, void 0, s4 ?? {});
  }
  return h3._$AI(t3), h3;
};

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t3 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t3.firstChild, t3;
  }
  update(t3) {
    const r6 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t3), this._$Do = D(r6, this.renderRoot, this.renderOptions);
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
var r4 = (t3 = o5, e5, r6) => {
  const { kind: n5, metadata: i5 } = r6;
  let s4 = globalThis.litPropertyMetadata.get(i5);
  if (void 0 === s4 && globalThis.litPropertyMetadata.set(i5, s4 = /* @__PURE__ */ new Map()), "setter" === n5 && ((t3 = Object.create(t3)).wrapped = true), s4.set(r6.name, t3), "accessor" === n5) {
    const { name: o6 } = r6;
    return { set(r7) {
      const n6 = e5.get.call(this);
      e5.set.call(this, r7), this.requestUpdate(o6, n6, t3, true, r7);
    }, init(e6) {
      return void 0 !== e6 && this.C(o6, void 0, t3, e6), e6;
    } };
  }
  if ("setter" === n5) {
    const { name: o6 } = r6;
    return function(r7) {
      const n6 = this[o6];
      e5.call(this, r7), this.requestUpdate(o6, n6, t3, true, r7);
    };
  }
  throw Error("Unsupported decorator location: " + n5);
};
function n4(t3) {
  return (e5, o6) => "object" == typeof o6 ? r4(t3, e5, o6) : ((t4, e6, o7) => {
    const r6 = e6.hasOwnProperty(o7);
    return e6.constructor.createProperty(o7, t4), r6 ? Object.getOwnPropertyDescriptor(e6, o7) : void 0;
  })(t3, e5, o6);
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
      ${ui.renderMessageField({
      label: `Steer ${this.agent}`,
      placeholder: "Steer this subagent\u2026",
      sendLabel: "Send steer",
      send: (text) => this.onSteer?.(text) ?? Promise.resolve(false)
    })}
      <div class="line">
        <p class="note ${note?.tone ?? "neutral"}" role="status">${note?.text ?? ""}</p>
        ${ui.renderButton({ label: "Stop", tone: "danger", busy: this.stopBusy, run: () => {
      this.onStop?.();
    } })}
      </div>
    `;
  }
  static {
    this.styles = i`
    :host { display: flex; flex-direction: column; gap: var(--pi-space-3); }
    .line { display: flex; align-items: center; gap: var(--pi-space-3); }
    .note { flex: 1; min-width: 0; margin: 0; color: var(--pi-muted); overflow-wrap: anywhere; }
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
  void SubagentRunControls;
}
if (customElements.get("subagent-run-controls") === void 0) customElements.define("subagent-run-controls", SubagentRunControls);

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
    const expansionFor = (panel, sessionFile, ui) => (row) => {
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
          return html`<subagent-run-controls
            .ui=${ui}
            .controls=${rowControls(row.control, panel.session !== void 0)}
            .agent=${row.agent}
            .note=${note === void 0 ? void 0 : noteLine(note, runs.view(sessionFile)?.state, row.agent)}
            .stopBusy=${stopPending(note)}
            .onSteer=${async (text) => steerTaken(await runCommand(panel, key, sessionFile, "steer", `${commandRunId} ${text}`))}
            .onStop=${() => {
            void runCommand(panel, key, sessionFile, "stop", commandRunId);
          }}
          ></subagent-run-controls>`;
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
              const expansionOf = controlsUi === void 0 || sessionFile === void 0 ? void 0 : expansionFor(panel, sessionFile, controlsUi);
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
