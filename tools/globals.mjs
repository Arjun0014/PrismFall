// Rename the packed build's GLOBALS: the top-level function declarations and
// the free uppercase names the `nolet` pass left behind.
//
// Terser names globals in definition order (functions first), and that order
// is a steep local optimum: the context model predicts "previous + 1", so
// consecutive definitions with consecutive names are nearly free. Naming ALL
// globals by frequency instead was measured at +225 B. But the first 26 names
// are one character and the other ~250 are two, and which globals get the
// short names is a separate question from what order the rest come in. This
// pass keeps definition order for everything except the K most referenced
// globals, which take the first K single-character names. Measured on the
// real archive, one K at a time:
//
//   K    4     6     8    10    12    13    14    16    20    26    40
//      -5    -7   -12   -32   -18   -23   -19     0    +6   +22   +50
//
// K = 10 is a searched build parameter like the alphabets; re-scan it with
// build/x/globorder.mjs after any significant source change. Locals are
// lowercase after relabel, so a global can never collide with one.
import * as acorn from 'acorn';

export const GLOBAL_LEAD = '_BCDEFGHIJKLMNOPQRSTUVWXYZ';
// The second character of a two-character name runs the OTHER way: -19 B
// measured against `_B..Z` for both positions (build/x/galpha.mjs).
export const GLOBAL_TAIL = 'ZYXWVUTSRQPONMLKJIHGFEDCB_';
export const HOT_GLOBALS = 10;
const RESERVED = new Set('do if in of'.split(' '));

export function renameGlobals(js, k = HOT_GLOBALS, lead = GLOBAL_LEAD, tail = GLOBAL_TAIL) {
  const L = [...lead], T = [...tail];
  const nameAt = (i) => { let s = L[i % L.length]; i = Math.floor(i / L.length); while (i > 0) { i--; s += T[i % T.length]; i = Math.floor(i / T.length); } return s; };
  const ast = acorn.parse(js, { ecmaVersion: 2022 });
  const occ = new Map(); // name -> [identifier nodes]
  const isGlobalName = (n) => /^[_A-Z][_A-Z0-9]*$/.test(n);
  const walk = (n, parent) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier' && isGlobalName(n.name)) {
      const isProp = parent && parent.type === 'MemberExpression' && !parent.computed && parent.property === n;
      const isKey = parent && parent.type === 'Property' && !parent.computed && parent.key === n && !parent.shorthand;
      if (!isProp && !isKey) { if (!occ.has(n.name)) occ.set(n.name, []); occ.get(n.name).push(n); }
      return;
    }
    for (const key in n) { if (key === 'type' || key === 'start' || key === 'end') continue; const v = n[key]; if (Array.isArray(v)) v.forEach((c) => walk(c, n)); else if (v && typeof v.type === 'string') walk(v, n); }
  };
  walk(ast, null);
  const fnNames = new Set(ast.body.filter((n) => n.type === 'FunctionDeclaration').map((n) => n.id.name));
  const defPos = new Map();
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration') defPos.set(n.id.name, n.start);
    else if (n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression' &&
      n.expression.left.type === 'Identifier' && !defPos.has(n.expression.left.name)) defPos.set(n.expression.left.name, n.start);
  }
  const byFirst = (a, b) => occ.get(a)[0].start - occ.get(b)[0].start;
  const byDef = (a, b) => (defPos.get(a) ?? 1e9) - (defPos.get(b) ?? 1e9) || byFirst(a, b);
  const byFreq = (a, b) => occ.get(b).length - occ.get(a).length || byFirst(a, b);
  // Terser's order: function declarations first, then the rest, each in definition order...
  let names = [...occ.keys()].sort((a, b) => (fnNames.has(a) ? 0 : 1) - (fnNames.has(b) ? 0 : 1) || byDef(a, b));
  // ...with the K hottest pulled to the front.
  const hot = [...names].sort(byFreq).slice(0, k);
  const hotSet = new Set(hot);
  names = [...hot, ...names.filter((n) => !hotSet.has(n))];
  const map = new Map();
  let i = 0;
  for (const nm of names) { let s; do { s = nameAt(i++); } while (RESERVED.has(s)); map.set(nm, s); }
  const edits = [];
  for (const [nm, ids] of occ) for (const id of ids) edits.push([id.start, id.end, map.get(nm)]);
  edits.sort((a, b) => a[0] - b[0]);
  let out = '', last = 0;
  for (const [s, e, t] of edits) { if (s < last) throw new Error('globals: overlapping edits'); out += js.slice(last, s) + t; last = e; }
  return out + js.slice(last);
}
