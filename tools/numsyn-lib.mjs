// Shared numeric-literal surgery, split out of numsyn.mjs so importing it does
// not start a search. Both numsyn (expressions from new integers) and numpool
// (expressions from values the program already has) build on this.
import { parse } from 'acorn';

// ------------------------------------------------------------- literals ----
/**
 * Every numeric literal in `src` that may be replaced by an expression, with
 * its exact span. Property keys and member names are excluded: `{1:x}` and
 * `a.1` are not expression positions and a parenthesised expression is not
 * legal there.
 */
export function numericLiterals(src) {
  const ast = parse(src, { ecmaVersion: 2022, sourceType: 'script' });
  const out = [];
  const walk = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Literal' && typeof node.value === 'number') {
      const bad =
        (parent && parent.type === 'Property' && parent.key === node && !parent.computed) ||
        (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
        (parent && parent.type === 'MethodDefinition' && parent.key === node && !parent.computed);
      if (!bad) out.push({ value: node.value, start: node.start, end: node.end, raw: src.slice(node.start, node.end) });
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'start' || k === 'end' || k === 'type' || k === 'loc' || k === 'range') continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) walk(c, node, k); }
      else if (v && typeof v === 'object') walk(v, node, k);
    }
  };
  walk(ast, null, null);
  return out;
}

/** Replace a set of spans. Spans must not overlap; they are applied right to left. */
export function spliceAll(src, edits) {
  const es = [...edits].sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of es) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

