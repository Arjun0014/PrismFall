// Post-Terser canonicalisation for the competition build.
//
// Roadroller is a context-mixing coder: it pays for every token shape it has
// not seen before and predicts a repeated shape almost for free. Terser's
// output is written for a human-readable-but-short JS, which is the wrong
// target -- it mixes `const` and `let`, folds declarations into comma lists,
// turns `if (a) b` into `a && b`, and prints numbers in whatever form is
// shortest. Every pass below rewrites the program into ONE shape per
// construct. None of them changes what the program does; each one was kept
// only because it made the real archive smaller (the numbers are in
// COMPRESSION_EXPERIMENTS.md).
//
//   split   `let a = 1, b = 2;`  ->  `let a = 1;` / `let b = 2;`     (-121 B)
//   let     `const`              ->  `let`                            ( -24 B)
//   nolet   top-level `let A = x` -> `A = x`  (eval'd script globals)  ( -24 B)
//   ifs     `a && b;` / `a ? b : c;` statements -> if statements      ( -37 B)
//   noinc   `i++` statement / for-update -> `i += 1`                  ( -10 B)
//   nums    `1e9`, `1e-4`         ->  plain decimals                   ( -15 B)
//
// Applied to the packed build only. The Wavedash page is plain minified JS on
// a page shared with the platform SDK, so its top-level declarations stay
// declarations there.
import * as acorn from 'acorn';
import { relabel } from './relabel.mjs';

const parse = (js) => acorn.parse(js, { ecmaVersion: 2022 });
const S = (js, n) => js.slice(n.start, n.end);
const simpleRef = (n) => n.type === 'Identifier' ||
  (n.type === 'MemberExpression' && simpleRef(n.object) && (!n.computed || n.property.type === 'Identifier' || n.property.type === 'Literal'));

function walk(ast, fn) {
  const go = (n, parent, key) => {
    if (!n || typeof n.type !== 'string') return;
    fn(n, parent, key);
    for (const k in n) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => go(c, n, k));
      else if (v && typeof v.type === 'string') go(v, n, k);
    }
  };
  go(ast, null, null);
}

// Apply non-overlapping span edits; a span nested inside an earlier edit is
// dropped (the next pass over the re-parsed output picks it up).
function apply(js, edits) {
  edits.sort((a, b) => a[0] - b[0]);
  const keep = []; let end = -1;
  for (const e of edits) { if (e[0] < end) continue; keep.push(e); end = e[1]; }
  let out = js;
  for (const [s, e, t] of keep.reverse()) out = out.slice(0, s) + t + out.slice(e);
  return out;
}
// Some passes create fresh candidates for themselves (a split inside a split);
// run to a fixed point.
const fix = (f) => (js) => { for (let i = 0; i < 8; i++) { const o = f(js); if (o === js) return o; js = o; } return js; };

export const split = fix((js) => {
  const ed = [];
  walk(parse(js), (n, p, k) => {
    if (n.type !== 'VariableDeclaration' || n.declarations.length < 2) return;
    const stmt = (p.type === 'Program' || p.type === 'BlockStatement') && k === 'body';
    if (!stmt) return;
    ed.push([n.start, n.end, n.declarations.map((d) => n.kind + ' ' + S(js, d) + ';').join('\n')]);
  });
  return apply(js, ed);
});

export const toLet = (js) => {
  const ed = [];
  walk(parse(js), (n) => { if (n.type === 'VariableDeclaration' && n.kind === 'const') ed.push([n.start, n.start + 5, 'let']); });
  return apply(js, ed);
};

export const nolet = (js) => {
  const ed = [];
  for (const n of parse(js).body) {
    if (n.type !== 'VariableDeclaration') continue;
    if (!n.declarations.every((d) => d.init && d.id.type === 'Identifier')) continue;
    ed.push([n.start, n.end, n.declarations.map((d) => S(js, d) + ';').join('\n')]);
  }
  return apply(js, ed);
};

export const ifs = fix((js) => {
  const ed = [];
  walk(parse(js), (n) => {
    if (n.type !== 'ExpressionStatement') return;
    const e = n.expression;
    if (e.type === 'LogicalExpression' && e.operator === '&&')
      ed.push([n.start, n.end, 'if (' + S(js, e.left) + ') {\n' + S(js, e.right) + ';\n}']);
    else if (e.type === 'ConditionalExpression')
      ed.push([n.start, n.end, 'if (' + S(js, e.test) + ') {\n' + S(js, e.consequent) + ';\n} else {\n' + S(js, e.alternate) + ';\n}']);
  });
  return apply(js, ed);
});

export const noinc = (js) => {
  const ed = [];
  walk(parse(js), (n, p) => {
    if (n.type !== 'UpdateExpression' || !simpleRef(n.argument)) return;
    if (p.type === 'ExpressionStatement' || (p.type === 'ForStatement' && p.update === n))
      ed.push([n.start, n.end, S(js, n.argument) + (n.operator === '++' ? ' += 1' : ' -= 1')]);
  });
  return apply(js, ed);
};

export const nums = (js) => {
  const ed = [];
  walk(parse(js), (n) => {
    if (n.type !== 'Literal' || typeof n.value !== 'number' || !/e/i.test(n.raw)) return;
    const s = n.value >= 1 ? n.value.toLocaleString('fullwide', { useGrouping: false })
      : n.value.toFixed(12).replace(/0+$/, '').replace(/^0/, '');
    if (Number(s) !== n.value) return;
    ed.push([n.start, n.end, s]);
  });
  return apply(js, ed);
};

// Last: locals renamed from their own alphabet (tools/relabel.mjs), after the
// top-level lets have become assignments so the globals are the free names.
export const PASSES = [split, toLet, nolet, ifs, noinc, nums, (js) => relabel(js)];
export function canon(js) {
  for (const p of PASSES) js = p(js);
  parse(js); // must still be a program
  return js;
}
