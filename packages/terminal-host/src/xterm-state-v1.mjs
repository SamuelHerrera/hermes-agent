import { ENGINE, assertCompatibleTerminal, validateCheckpoint } from './xterm-state-validation.mjs';
export { assertCompatibleTerminal } from './xterm-state-validation.mjs';
// Pinned private-state adapter for stock xterm 6.0.0. No history replay.
const presentation = new WeakMap();
const mirrors = new WeakSet();
// Install before the first write. Headless has no built-in color consumer.
export function initializeTerminalState(t) {
  if (presentation.has(t)) return;
  const colors = new Map(); presentation.set(t, colors);
  t._core._inputHandler.onColor(events => {
    for (const e of events) {
      if (e.type === 1) colors.set(e.index, [...e.color]);
      if (e.type === 2) {
        if (e.index === undefined) { for (const index of colors.keys()) if (index < 256) colors.delete(index); }
        else colors.delete(e.index);
      }
    }
  });
}
function mirrorOnly(t) {
  if (mirrors.has(t)) return;
  mirrors.add(t);
  const service = t._core.coreService, send = service.triggerDataEvent;
  service.triggerDataEvent = function(data, wasUserInput = false) {
    if (wasUserInput) return send.call(this, data, true);
  };
}
const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const fields = (o, names) => Object.fromEntries(names.map(k => [k, clone(o[k])]));
const PARAMS = ['maxLength', 'maxSubParamsLength', 'length', '_subParamsLength', '_rejectDigits', '_rejectSubDigits', '_digitIsSub'];
const PARAM_ARRAYS = ['params', '_subParams', '_subParamsIdx'];
const INPUT = ['_windowTitle', '_iconName', '_windowTitleStack', '_iconNameStack'];
const OPTIONS = ['scrollback', 'tabStopWidth', 'convertEol', 'windowsMode', 'windowsPty', 'reflowCursorLine', 'scrollOnEraseInDisplay', 'windowOptions'];
function paramsState(p) { return { ...fields(p, PARAMS), ...Object.fromEntries(PARAM_ARRAYS.map(k => [k, Array.from(p[k])])) }; }
function setParams(p, s) { for (const k of PARAMS) p[k] = s[k]; for (const k of PARAM_ARRAYS) p[k].set(s[k]); }
function subState(p, names) {
  return { ...fields(p, names), active: p._active.map(h => ({
    data: h._data, hitLimit: h._hitLimit, params: h._params ? paramsState(h._params) : null
  })) };
}
function setSub(p, s, names, id) {
  for (const k of names) p[k] = s[k];
  p._active = s.active.length ? p._handlers[s[id]] : [];
  s.active.forEach((v, n) => {
    const h = p._active[n]; h._data = v.data; h._hitLimit = v.hitLimit;
    if (v.params) { h._params = h._params.clone(); setParams(h._params, v.params); }
  });
}
const BUFFER = ['x', 'y', 'ybase', 'ydisp', 'scrollTop', 'scrollBottom', 'savedX', 'savedY', 'tabs', 'savedCharset'];
const attr = a => ({ fg: a.fg, bg: a.bg, extended: { _ext: a.extended._ext, _urlId: a.extended._urlId } });
function setAttr(a, s) { a.fg = s.fg; a.bg = s.bg; Object.assign(a.extended, s.extended); }
function bufferState(b) {
  return { ...fields(b, BUFFER), savedCurAttrData: attr(b.savedCurAttrData),
    lines: Array.from({ length: b.lines.length }, (_, y) => {
      const l = b.lines.get(y);
      return { length: l.length, isWrapped: l.isWrapped, data: Array.from(l._data), combined: clone(l._combined),
        extended: Object.fromEntries(Object.entries(l._extendedAttrs).map(([k, v]) => [k, { _ext: v._ext, _urlId: v._urlId }])) };
    }) };
}
function linksState(c) {
  const bs = c._bufferService.buffers, service = c._oscLinkService;
  return { nextId: service._nextId, entries: [...service._dataByLinkId.values()].map(e => ({
    id: e.id, data: clone(e.data), lines: e.lines.map(m => ({
      buffer: bs.normal.markers.includes(m) ? 'normal' : 'alt', line: m.line
    }))
  })) };
}
function setLinks(c, s) {
  const bs = c._bufferService.buffers, service = c._oscLinkService;
  bs.normal.clearAllMarkers(); bs.alt.clearAllMarkers();
  service._dataByLinkId.clear(); service._entriesWithId.clear(); service._nextId = s.nextId;
  for (const e of s.entries) {
    const entry = { id: e.id, data: { id: e.data.id, uri: e.data.uri }, lines: [] };
    if (entry.data.id !== undefined) {
      entry.key = service._getEntryIdKey(entry.data); service._entriesWithId.set(entry.key, entry);
    }
    service._dataByLinkId.set(entry.id, entry);
    for (const m of e.lines) {
      const marker = bs[m.buffer].addMarker(m.line); entry.lines.push(marker);
      marker.onDispose(() => service._removeMarkerFromLink(entry, marker));
    }
  }
}
function setBuffer(b, s) {
  for (const k of BUFFER) b[k] = clone(s[k]) ?? undefined;
  setAttr(b.savedCurAttrData, s.savedCurAttrData);
  b.lines.length = 0;
  for (const l of s.lines) {
    const line = b.getBlankLine(b.savedCurAttrData, l.isWrapped);
    line.length = l.length; line._data = Uint32Array.from(l.data); line._combined = clone(l.combined);
    line._extendedAttrs = Object.fromEntries(Object.entries(l.extended).map(([k, v]) => {
      const a = b.savedCurAttrData.extended.clone(); Object.assign(a, v); return [k, a];
    }));
    b.lines.push(line);
  }
}
export function captureTerminalState(t, metadata = {}) {
  if (!presentation.has(t)) throw Error('UNTRACKED_PRESENTATION: initialize before first write');
  return readTerminalState(t, metadata);
}
function readTerminalState(t, metadata = {}) {
  assertCompatibleTerminal(t);
  const c = t._core, bs = c._bufferService.buffers;
  const state = { engine: { ...ENGINE }, format: 'hermes-xterm-state', version: 1, ...metadata, cols: t.cols, rows: t.rows,
    options: fields(t.options, OPTIONS), links: linksState(c),
    presentation: { colors: [...(presentation.get(t) ?? new Map())].map(([index, color]) => ({ index, color: [...color] })) },
    input: { ...fields(c._inputHandler, INPUT), stringInterim: c._inputHandler._stringDecoder._interim, utf8Interim: Array.from(c._inputHandler._utf8Decoder.interim) },
    charset: fields(c._charsetService, ['charset', '_charsets', 'glevel']),
    core: fields(c.coreService, ['modes', 'decPrivateModes', 'isCursorHidden', 'isCursorInitialized']),
    mouse: fields(c.coreMouseService, ['_activeProtocol', '_activeEncoding']),
    parser: { ...fields(c._inputHandler._parser, ['currentState', 'precedingJoinState', '_collect']),
      params: paramsState(c._inputHandler._parser._params),
      osc: subState(c._inputHandler._parser._oscParser, ['_state', '_id']),
      dcs: subState(c._inputHandler._parser._dcsParser, ['_ident']) },
    active: bs.active === bs.alt ? 'alt' : 'normal',
    normal: bufferState(bs.normal), alt: bufferState(bs.alt), attr: attr(c._inputHandler._curAttrData) };
  validateCheckpoint(state);
  return state;
}
export function hydrateTerminalState(t, s) {
  if (typeof t.open === 'function' && !t.element) throw Error('INCOMPATIBLE_XTERM OPEN_BEFORE_HYDRATE');
  assertCompatibleTerminal(t);
  validateCheckpoint(s);
  readTerminalState(t); // Validate the destination's complete whitelisted field shape too.
  initializeTerminalState(t); mirrorOnly(t);
  t.reset(); for (const k of OPTIONS) t.options[k] = clone(s.options[k]); t.resize(s.cols, s.rows);
  const c = t._core, bs = c._bufferService.buffers;
  if (s.active === 'alt') bs.activateAltBuffer();
  setBuffer(bs.normal, s.normal); setBuffer(bs.alt, s.alt);
  setAttr(c._inputHandler._curAttrData, s.attr);
  setLinks(c, s.links);
  const i = c._inputHandler, p = i._parser;
  for (const k of INPUT) i[k] = clone(s.input[k]);
  i._stringDecoder._interim = s.input.stringInterim; i._utf8Decoder.interim.set(s.input.utf8Interim);
  for (const [k, v] of Object.entries(s.charset)) c._charsetService[k] = clone(v) ?? undefined;
  c._charsetService._charsets = c._charsetService._charsets.map(v => v ?? undefined);
  for (const [k, v] of Object.entries(s.core)) {
    if (typeof v === 'object') Object.assign(c.coreService[k], v); else c.coreService[k] = v;
  }
  c.coreMouseService.activeProtocol = s.mouse._activeProtocol;
  c.coreMouseService.activeEncoding = s.mouse._activeEncoding;
  const colors = presentation.get(t); colors.clear();
  for (const e of s.presentation.colors) colors.set(e.index, [...e.color]);
  if (c._themeService) {
    c._handleColorEvent([{ type: 2 }, ...[256, 257, 258].map(index => ({ type: 2, index })),
      ...s.presentation.colors.map(e => ({ type: 1, index: e.index, color: e.color }))]);
  }
  c._inputHandler._onTitleChange.fire(s.input._windowTitle);
  // No synthetic ANSI writes: parser continuation is restored last.
  setParams(p._params, s.parser.params);
  setSub(p._oscParser, s.parser.osc, ['_state', '_id'], '_id');
  setSub(p._dcsParser, s.parser.dcs, ['_ident'], '_ident');
  for (const k of ['currentState', 'precedingJoinState', '_collect']) p[k] = s.parser[k];
  t.refresh?.(0, t.rows - 1);
}
