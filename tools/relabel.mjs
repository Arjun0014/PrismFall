// Relabel every LOCAL binding of the packed build from its own alphabet.
//
// Terser names locals from the same alphabet as globals, so inside a function
// it has to skip every letter that a referenced global is using. That breaks
// the one pattern the context model reads best: consecutive declarations get
// consecutive names. Giving locals a disjoint alphabet (lowercase; globals stay
// uppercase) means no letter is ever skipped, and the ORDER of that alphabet is
// a searched build parameter like the global one in build.mjs. Measured on the
// real archive: plain a..z -20 B, z..a -33 B, and a hill-climb on top of that.
//
// Names are allocated per scope exactly the way Terser's mangler does it -- a
// scope's bindings take the first free names in declaration order, sibling
// scopes restart from the top, and a name is unavailable inside a scope if a
// binding declared outside it is referenced from inside it. With the default
// alphabet and no remap this reproduces Terser's output byte for byte, which is
// the check that the scope model is right.
import * as acorn from 'acorn';

export const LOCAL_LEAD = 'zyxwvutsrqponmlkjihgfedcba';

const RESERVED = new Set('do if in of for let new try var case else enum eval null this true void with await break catch class const false super throw while yield delete export import public return static switch typeof default extends finally package private continue debugger function arguments interface protected implements instanceof undefined NaN Infinity'.split(' '));

export function relabel(js, lead = LOCAL_LEAD, tail = lead + '0123456789') {
  const L = [...lead], T = [...tail];
  const nameAt = (i) => { let s = L[i % L.length]; i = Math.floor(i / L.length); while (i > 0) { i--; s += T[i % T.length]; i = Math.floor(i / T.length); } return s; };
  const ast = acorn.parse(js, { ecmaVersion: 2022 });

  const scopes = [];
  const mk = (node, parent, isFn) => { const s = { node, parent, isFn, bindings: new Map() }; scopes.push(s); return s; };
  const fnOf = (s) => { while (!s.isFn) s = s.parent; return s; };
  const declare = (scope, id) => {
    let b = scope.bindings.get(id.name);
    if (!b) { b = { name: id.name, ids: [], refs: [], scope }; scope.bindings.set(id.name, b); }
    b.ids.push(id);
  };
  const bindPattern = (scope, p) => {
    if (!p) return;
    if (p.type === 'Identifier') declare(scope, p);
    else if (p.type === 'ArrayPattern') p.elements.forEach((e) => bindPattern(scope, e));
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => bindPattern(scope, q.type === 'RestElement' ? q.argument : q.value));
    else if (p.type === 'AssignmentPattern') bindPattern(scope, p.left);
    else if (p.type === 'RestElement') bindPattern(scope, p.argument);
  };
  const root = mk(ast, null, true);
  const refs = [];
  const isFn = (n) => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
  const visit = (n, scope, parent) => {
    if (!n || typeof n.type !== 'string') return;
    let inner = scope;
    switch (n.type) {
      case 'FunctionDeclaration':
        declare(fnOf(scope), n.id);
        inner = mk(n, scope, true);
        n.params.forEach((p) => bindPattern(inner, p));
        visit(n.body, inner, n);
        return;
      case 'FunctionExpression': case 'ArrowFunctionExpression':
        inner = mk(n, scope, true);
        if (n.id) declare(inner, n.id);
        n.params.forEach((p) => bindPattern(inner, p));
        visit(n.body, inner, n);
        return;
      case 'BlockStatement':
        if (!(isFn(parent) || (parent && parent.type === 'CatchClause'))) inner = mk(n, scope, false);
        break;
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement':
        inner = mk(n, scope, false);
        break;
      case 'CatchClause':
        inner = mk(n, scope, false);
        bindPattern(inner, n.param);
        visit(n.body, inner, n);
        return;
      case 'VariableDeclaration':
        for (const d of n.declarations) { bindPattern(n.kind === 'var' ? fnOf(scope) : scope, d.id); if (d.init) visit(d.init, scope, d); }
        return;
      case 'ClassDeclaration': case 'ClassExpression': throw new Error('relabel: classes are not handled');
      case 'Identifier': refs.push([n, scope]); return;
      case 'MemberExpression': visit(n.object, scope, n); if (n.computed) visit(n.property, scope, n); return;
      case 'Property':
        if (n.computed) visit(n.key, scope, n);
        if (n.shorthand) { n.value._short = 1; refs.push([n.value, scope]); return; }
        visit(n.value, scope, n); return;
      case 'LabeledStatement': visit(n.body, scope, n); return;
      case 'BreakStatement': case 'ContinueStatement': return;
    }
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, inner, n));
      else if (v && typeof v.type === 'string') visit(v, inner, n);
    }
  };
  visit(ast, root, null);
  const resolve = (name, scope) => { for (let s = scope; s; s = s.parent) { const b = s.bindings.get(name); if (b) return b; } return null; };
  const free = new Set();
  for (const [id, scope] of refs) { const b = resolve(id.name, scope); if (b) b.refs.push(id); else free.add(id.name); }
  const inside = (s, t) => { for (let x = s; x; x = x.parent) if (x === t) return true; return false; };
  // Names unavailable inside scope S: every free name, and every binding declared
  // outside S that is referenced from inside S (by its new name once renamed).
  const forbidden = (S) => {
    const set = new Set(free);
    for (const [id, sc] of refs) {
      if (!inside(sc, S)) continue;
      const b = resolve(id.name, sc);
      if (b && !inside(b.scope, S)) set.add(b.newName || b.name);
    }
    return set;
  };
  // Outer scopes first, so a scope's names are fixed before its inner scopes look at them.
  for (const S of scopes) {
    if (S === root) continue;
    const bs = [...S.bindings.values()].sort((a, b) => a.ids[0].start - b.ids[0].start);
    const taken = forbidden(S);
    let i = 0;
    for (const b of bs) {
      let nm;
      do { nm = nameAt(i++); } while (RESERVED.has(nm) || taken.has(nm));
      taken.add(nm);
      b.newName = nm;
    }
  }
  const edits = [];
  for (const S of scopes) if (S !== root) for (const b of S.bindings.values()) {
    for (const id of [...b.ids, ...b.refs]) edits.push([id.start, id.end, id._short ? id.name + ': ' + b.newName : b.newName]);
  }
  edits.sort((a, b) => a[0] - b[0]);
  let out = '', last = 0;
  for (const [s, e, t] of edits) { if (s < last) throw new Error('relabel: overlapping edits'); out += js.slice(last, s) + t; last = e; }
  return out + js.slice(last);
}
