// Diagnostic: how efficiently does DEFLATE handle each part of the packed page?
// Roadroller's data line is 6-bit-per-char, so Huffman should reach ~75% of it.
import { readFileSync } from 'node:fs';
import { makeZip } from '../tools/zip.mjs';

const html = readFileSync('dist/index.html', 'utf8');
const i = html.indexOf('<script>') + 8;
const j = html.lastIndexOf('</script>');
const head = html.slice(0, i), body = html.slice(i, j), tail = html.slice(j);
const nl = body.indexOf(String.fromCharCode(10));
const first = body.slice(0, nl), second = body.slice(nl + 1);

const OVERHEAD = 30 + 1 + 46 + 1 + 22; // local hdr + name + central + name + eocd
const z = async (s) => (await makeZip([{ name: 'i', data: Buffer.from(s, 'utf8') }], { iterations: [200] })).length - OVERHEAD;

const a = await z(html), b = await z(first), c = await z(second), d = await z(head + tail);
console.log('whole html    ', Buffer.byteLength(html).toString().padStart(6), '-> deflate', a);
console.log('firstLine     ', Buffer.byteLength(first).toString().padStart(6), '-> deflate', b,
  '  (' + (b / Buffer.byteLength(first) * 100).toFixed(1) + '%, ideal 75%)');
console.log('secondLine    ', Buffer.byteLength(second).toString().padStart(6), '-> deflate', c);
console.log('shell         ', Buffer.byteLength(head + tail).toString().padStart(6), '-> deflate', d);
console.log('sum of parts  ', b + c + d, '   vs whole', a);
