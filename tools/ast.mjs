// Real-parser source surgery.
//
// The previous attempt at source reordering (COMPRESSION_EXPERIMENTS.md #4) was
// abandoned because it carved the bundle up with a brace-counting scanner that
// did not understand regex literals, and produced a program that parsed and
// then hung. Everything here goes through acorn instead, so a span is either
// exactly a statement or the tool refuses to touch it.
import { parse } from 'acorn';

const ECMA = { ecmaVersion: 2022, sourceType: 'script', locations: false };

/**
 * Top-level statements of one source file, with spans that include the
 * comment block written directly above them.
 *
 * The comments do not reach the archive -- Terser strips them -- but a
 * reordering that detached this codebase's explanations from the functions they
 * explain would be a real loss for a few bytes it does not even collect.
 */
export function topLevel(src) {
  const ast = parse(src, ECMA);
  const out = [];
  let prevEnd = 0;
  for (const node of ast.body) {
    // Walk back over the blank line and any full-line // comments above.
    let s = node.start;
    let lineStart = src.lastIndexOf('\n', s - 1) + 1;
    while (lineStart > prevEnd) {
      const prevLineStart = src.lastIndexOf('\n', lineStart - 2) + 1;
      const line = src.slice(prevLineStart, lineStart).trim();
      if (!line.startsWith('//')) break;
      lineStart = prevLineStart;
    }
    if (lineStart >= prevEnd) s = lineStart;
    out.push({
      kind: node.type,
      name: node.type === 'FunctionDeclaration' ? node.id.name
        : node.type === 'VariableDeclaration' ? node.declarations.map((d) => d.id.name || '?').join(',')
          : null,
      start: s, end: node.end, node,
      text: src.slice(s, node.end),
    });
    prevEnd = node.end;
  }
  return { ast, items: out };
}

/**
 * Rebuild a file from a permutation of its top-level items.
 *
 * Only function declarations may move, and this is the reason it is safe:
 * a function declaration is hoisted and fully initialised before any statement
 * in the script runs, so its position among top-level statements cannot change
 * when it exists, what it closes over, or what any other statement sees. Every
 * other statement keeps its exact relative order, which preserves both
 * evaluation order and every temporal dead zone.
 */
export function rebuild(src, items, order) {
  const fixed = [], funcs = [];
  items.forEach((it, i) => (it.kind === 'FunctionDeclaration' ? funcs : fixed).push(i));
  if (order.length !== funcs.length) throw new Error('order length mismatch');
  const seen = new Set(order);
  if (seen.size !== order.length) throw new Error('order is not a permutation');
  for (const o of order) if (!funcs.includes(o)) throw new Error('order names a non-function item');

  // Functions are re-emitted into the slots functions already occupy, so the
  // interleaving with the fixed statements is unchanged.
  let fi = 0;
  const seq = items.map((it, i) => (it.kind === 'FunctionDeclaration' ? order[fi++] : i));
  const head = src.slice(0, items.length ? items[0].start : src.length);
  const tail = src.slice(items.length ? items[items.length - 1].end : src.length);
  const body = seq.map((i) => items[i].text).join('\n\n');
  const out = head + body + tail;
  // A rebuild that does not parse is a bug in this file, not a bad candidate.
  parse(out, ECMA);
  return out;
}

/** Remove one top-level item by index, for leave-one-out cost attribution. */
export function without(src, items, idx) {
  return src.slice(0, items[idx].start) + src.slice(items[idx].end);
}

/** Every top-level function declaration in a whole bundle, with spans. */
export function functions(src) {
  return topLevel(src).items.filter((i) => i.kind === 'FunctionDeclaration');
}

export { ECMA };
