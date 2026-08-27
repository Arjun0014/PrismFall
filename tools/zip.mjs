// Minimal ZIP writer tuned for js13kGames.
// Produces the smallest legal archive we can: no extra fields, no data
// descriptors, no directory entries, DEFLATE streams produced by Zopfli.
import zopfli from '@gfx/zopfli';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zopfliDeflate(buf, iterations) {
  return new Promise((res, rej) => {
    zopfli.deflate(buf, { numiterations: iterations, blocksplitting: true }, (e, out) =>
      e ? rej(e) : res(Buffer.from(out))
    );
  });
}

// Try several deflate strategies, keep the shortest stream.
async function bestDeflate(buf, iterations) {
  const cands = [deflateRawSync(buf, { level: 9, memLevel: 9 })];
  for (const it of iterations) cands.push(await zopfliDeflate(buf, it));
  let best = cands[0];
  for (const c of cands) if (c.length < best.length) best = c;
  // Deflate is only worth it if it actually shrinks the payload.
  return best.length < buf.length ? { data: best, method: 8 } : { data: buf, method: 0 };
}

/**
 * @param {{name:string, data:Buffer}[]} files
 * @param {{iterations?:number[]}} opts
 */
export async function makeZip(files, opts = {}) {
  const iterations = opts.iterations || [15, 200];
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, 'ascii');
    const { data, method } = await bestDeflate(f.data, iterations);
    const crc = crc32(f.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(33, 12); // mod date (1980-01-01 is 0x0021)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28); // extra len
    locals.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(33, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += 30 + name.length + data.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cd, eocd]);
}

/** Parse a zip we produced and return [{name, data}] — used by the validators. */
export function readZip(buf) {
  const out = [];
  // Find EOCD
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('no EOCD');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('ascii', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (data.length !== usize) throw new Error('size mismatch for ' + name);
    if (crc32(data) !== crc) throw new Error('crc mismatch for ' + name);
    out.push({ name, data });
    p += 46 + nlen + elen + clen;
  }
  return out;
}
