// Audited runtime identities: xterm 6.0.0 CJS headless and UMD renderer.
export const ENGINE = Object.freeze({ headless: '6.0.0', renderer: '6.0.0', unicode: '6',
  profile: 'stock-sync-v1', build: '6d8b8ca070207e3fe6bf8e70f63adb02c874325ff4bbd7d8bca2faed421fbd19' });
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
export function terminalFingerprint(t) {
  const c = t._core, i = c._inputHandler, p = i._parser, b = c._bufferService.buffers.normal;
  const objects = [i, p, p._oscParser, p._dcsParser, p._params, b, b.lines, b.lines.get(0),
    i._curAttrData, i._curAttrData.extended, c._charsetService, c._oscLinkService, c.coreMouseService,
    c.coreService, c.unicodeService, c.unicodeService._activeProvider, i._stringDecoder, i._utf8Decoder];
  const functions = objects.map(o => o.constructor.toString());
  for (const registry of [p._executeHandlers, p._csiHandlers, p._escHandlers, p._oscParser._handlers, p._dcsParser._handlers]) {
    for (const key of Object.keys(registry).sort()) {
      functions.push(key);
      for (const handler of [registry[key]].flat()) functions.push(typeof handler === 'function' ? handler.toString() : handler._handler.toString());
    }
  }
  return hash(functions.join('\n'));
}
const FINGERPRINTS = ['fd3f8048', '289f5647'];
const fail = (message = '') => { throw Error(`INVALID_CHECKPOINT ${message}`); };
const requireThat = (ok, m) => { if (!ok) fail(m); };
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const num = (v, min, max) => requireThat(integer(v, min, max), 'integer');
const bool = v => requireThat(typeof v === 'boolean', 'boolean');
const string = v => requireThat(typeof v === 'string', 'string');
const array = (v, check, length) => { requireThat(Array.isArray(v) && (length === undefined || v.length === length), 'array'); v.forEach(check); };
function keys(o, required, optional = []) { requireThat(object(o), 'object'); requireThat(required.every(k => Object.hasOwn(o, k)) && Object.keys(o).every(k => [...required, ...optional].includes(k)), 'fields'); }
function map(o, check) { requireThat(object(o), 'map'); for (const [k, v] of Object.entries(o)) { requireThat(/^\d+$/.test(k), 'index'); check(v, Number(k)); } }
function extended(a) { keys(a, ['_ext', '_urlId']); num(a._ext, -2147483648, 4294967295); num(a._urlId); }
function attr(a) { keys(a, ['fg', 'bg', 'extended']); num(a.fg, -2147483648, 4294967295); num(a.bg, -2147483648, 4294967295); extended(a.extended); }
function charset(c) { if (c === null) return; requireThat(object(c), 'charset'); for (const [k, v] of Object.entries(c)) { requireThat(k.length === 1, 'charset key'); string(v); } }
function params(p) {
  keys(p, ['maxLength', 'maxSubParamsLength', 'length', '_subParamsLength', '_rejectDigits', '_rejectSubDigits', '_digitIsSub', 'params', '_subParams', '_subParamsIdx']);
  requireThat(p.maxLength === 32 && p.maxSubParamsLength === 32, 'params capacity');
  num(p.length, 0, 32); num(p._subParamsLength, 0, 32);
  for (const k of ['_rejectDigits', '_rejectSubDigits', '_digitIsSub']) bool(p[k]);
  array(p.params, v => num(v, -1, 2147483647), 32); array(p._subParams, v => num(v, -1, 2147483647), 32);
  array(p._subParamsIdx, v => { num(v, 0, 65535); requireThat((v >> 8) <= 32 && (v & 255) <= 32 && (v >> 8) <= (v & 255), 'subparam range'); }, 32);
}
export function assertCompatibleTerminal(t) {
  try {
    const c = t._core, i = c._inputHandler, p = i._parser;
    if (c._writeBuffer._pendingData !== 0 || c._writeBuffer._isSyncWriting) throw Error('pending write');
    if (!FINGERPRINTS.includes(terminalFingerprint(t))) throw Error('runtime fingerprint');
    if (c.unicodeService.activeVersion !== '6' || Object.keys(c.unicodeService._providers).join() !== '6') throw Error('unicode addon');
    if (i._parseStack.paused || p._parseStack.state || p._oscParser._stack.paused || p._dcsParser._stack.paused) throw Error('async parser');
    if (!(p._params.params instanceof Int32Array) || !(p._params._subParamsIdx instanceof Uint16Array) || !(i._utf8Decoder.interim instanceof Uint8Array)) throw Error('field types');
    if (typeof p.currentState !== 'number' || typeof i._stringDecoder._interim !== 'number') throw Error('field types');
    for (const b of [c._bufferService.buffers.normal, c._bufferService.buffers.alt]) {
      for (const k of ['x', 'y', 'ybase', 'ydisp', 'savedX', 'savedY', 'scrollTop', 'scrollBottom']) if (typeof b[k] !== 'number') throw Error('buffer field types');
      if (!Array.isArray(b.markers) || !object(b.tabs)) throw Error('buffer field types');
      for (let n = 0; n < b.lines.length; n++) {
        const l = b.lines.get(n);
        if (!(l._data instanceof Uint32Array) || typeof l.length !== 'number' || typeof l.isWrapped !== 'boolean' || !object(l._combined) || !object(l._extendedAttrs)) throw Error('line field types');
      }
    }
    if (t._addonManager._addons.length) throw Error('addon profile');
  } catch (e) { throw Error(`INCOMPATIBLE_XTERM ${e.message}`); }
}
export function validateCheckpoint(s) {
  keys(s, ['format', 'version', 'engine', 'cols', 'rows', 'options', 'links', 'presentation', 'input', 'charset', 'core', 'mouse', 'parser', 'active', 'normal', 'alt', 'attr'], ['seq', 'preview']);
  requireThat(s.format === 'hermes-xterm-state' && s.version === 1, 'version');
  keys(s.engine, Object.keys(ENGINE));
  requireThat(Object.entries(ENGINE).every(([k, v]) => s.engine[k] === v), 'engine');
  num(s.cols, 2, 1000); num(s.rows, 1, 1000); if (s.seq !== undefined) num(s.seq); if (s.preview !== undefined) { keys(s.preview, ['approximate', 'data']); requireThat(s.preview.approximate === true, 'preview'); string(s.preview.data); }
  keys(s.options, ['scrollback', 'tabStopWidth', 'convertEol', 'windowsMode', 'windowsPty', 'reflowCursorLine', 'scrollOnEraseInDisplay', 'windowOptions']);
  num(s.options.scrollback, 0, 100000); num(s.options.tabStopWidth, 1, 1000);
  for (const k of ['convertEol', 'windowsMode', 'reflowCursorLine', 'scrollOnEraseInDisplay']) bool(s.options[k]);
  keys(s.options.windowsPty, [], ['backend', 'buildNumber']);
  if (s.options.windowsPty.backend !== undefined) requireThat(['conpty', 'winpty'].includes(s.options.windowsPty.backend), 'windows backend');
  if (s.options.windowsPty.buildNumber !== undefined) num(s.options.windowsPty.buildNumber);
  requireThat(object(s.options.windowOptions), 'window options');
  for (const [k, v] of Object.entries(s.options.windowOptions)) { requireThat(['pushTitle', 'popTitle'].includes(k), 'unsupported window report'); bool(v); }
  requireThat(['normal', 'alt'].includes(s.active), 'active');
  for (const name of ['normal', 'alt']) {
    const b = s[name];
    keys(b, ['x', 'y', 'ybase', 'ydisp', 'scrollTop', 'scrollBottom', 'savedX', 'savedY', 'tabs', 'savedCharset', 'savedCurAttrData', 'lines']);
    num(b.x, 0, s.cols); num(b.y, 0, s.rows - 1); num(b.ybase, 0, s.options.scrollback); num(b.ydisp, 0, b.ybase);
    num(b.scrollTop, 0, s.rows - 1); num(b.scrollBottom, b.scrollTop, s.rows - 1);
    num(b.savedX); num(b.savedY); charset(b.savedCharset); attr(b.savedCurAttrData);
    map(b.tabs, v => bool(v));
    array(b.lines, l => {
      keys(l, ['length', 'isWrapped', 'data', 'combined', 'extended']); num(l.length, 0, 1000); bool(l.isWrapped);
      array(l.data, v => num(v, 0, 4294967295), l.length * 3);
      map(l.combined, v => string(v)); map(l.extended, v => extended(v));
      for (let x = 0; x < l.length; x++) {
        if (l.data[x * 3] & 2097152) requireThat(typeof l.combined[x] === 'string', 'missing combined');
        if (l.data[x * 3 + 2] & 268435456) requireThat(object(l.extended[x]), 'missing extended');
      }
    });
    requireThat(b.lines.length <= s.rows + (name === 'normal' ? s.options.scrollback : 0), 'line count');
    requireThat(b.lines.length === 0 ? name === 'alt' && s.active !== 'alt' : b.lines.length >= b.ybase + s.rows, 'viewport');
  }
  attr(s.attr);
  keys(s.links, ['nextId', 'entries']); num(s.links.nextId, 1);
  const ids = new Set();
  array(s.links.entries, e => {
    keys(e, ['id', 'data', 'lines']); num(e.id, 1, s.links.nextId - 1); requireThat(!ids.has(e.id), 'duplicate link'); ids.add(e.id);
    keys(e.data, ['uri'], ['id']); string(e.data.uri); if (e.data.id !== undefined) string(e.data.id);
    array(e.lines, m => { keys(m, ['buffer', 'line']); requireThat(['normal', 'alt'].includes(m.buffer), 'marker buffer'); num(m.line, 0, s[m.buffer].lines.length - 1); });
    requireThat(e.lines.length > 0, 'link markers');
  });
  keys(s.presentation, ['colors']); array(s.presentation.colors, e => { keys(e, ['index', 'color']); num(e.index, 0, 258); array(e.color, v => num(v, 0, 255), 3); });
  keys(s.input, ['_windowTitle', '_iconName', '_windowTitleStack', '_iconNameStack', 'stringInterim', 'utf8Interim']);
  string(s.input._windowTitle); string(s.input._iconName); array(s.input._windowTitleStack, v => string(v)); array(s.input._iconNameStack, v => string(v));
  num(s.input.stringInterim, 0, 65535); array(s.input.utf8Interim, v => num(v, 0, 255), 3);
  keys(s.charset, ['charset', '_charsets', 'glevel']); charset(s.charset.charset); array(s.charset._charsets, v => charset(v)); num(s.charset.glevel, 0, 3);
  keys(s.core, ['modes', 'decPrivateModes', 'isCursorHidden', 'isCursorInitialized']); bool(s.core.isCursorHidden); bool(s.core.isCursorInitialized);
  keys(s.core.modes, ['insertMode']); bool(s.core.modes.insertMode);
  const dec = s.core.decPrivateModes;
  keys(dec, ['applicationCursorKeys', 'applicationKeypad', 'bracketedPasteMode', 'origin', 'reverseWraparound', 'sendFocus', 'synchronizedOutput', 'wraparound'], ['cursorBlink', 'cursorStyle']);
  for (const [k, v] of Object.entries(dec)) if (k === 'cursorStyle') requireThat(['block', 'underline', 'bar'].includes(v), 'cursor style'); else bool(v);
  keys(s.mouse, ['_activeProtocol', '_activeEncoding']);
  requireThat(['NONE', 'X10', 'VT200', 'DRAG', 'ANY'].includes(s.mouse._activeProtocol), 'mouse protocol');
  requireThat(['DEFAULT', 'SGR', 'SGR_PIXELS'].includes(s.mouse._activeEncoding), 'mouse encoding');
  keys(s.parser, ['currentState', 'precedingJoinState', '_collect', 'params', 'osc', 'dcs']);
  num(s.parser.currentState, 0, 13); num(s.parser.precedingJoinState, 0, 4294967295); num(s.parser._collect, 0, 4294967295); params(s.parser.params);
  keys(s.parser.osc, ['_state', '_id', 'active']); num(s.parser.osc._state, 0, 3); num(s.parser.osc._id, -1);
  keys(s.parser.dcs, ['_ident', 'active']); num(s.parser.dcs._ident);
  for (const [sub, id, supported] of [[s.parser.osc, '_id', [0,1,2,4,8,10,11,12,104,110,111,112]], [s.parser.dcs, '_ident', [9329]]]) {
    requireThat(sub.active.length <= 1 && (!sub.active.length || supported.includes(sub[id])), 'handler identity');
    array(sub.active, h => { keys(h, ['data', 'hitLimit', 'params']); string(h.data); bool(h.hitLimit); if (id === '_ident') params(h.params); else requireThat(h.params === null, 'osc params'); });
  }
}
