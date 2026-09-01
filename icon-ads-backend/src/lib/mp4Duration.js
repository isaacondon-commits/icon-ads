// Lee la duración (segundos) de un MP4 desde su buffer, sin dependencias
// externas (parseo del box moov/mvhd). Devuelve null si no se pudo determinar.

// Busca un box `type` entre [from, to). Devuelve {start, end} del PAYLOAD.
function findBox(buf, from, to, type) {
  let off = from;
  while (off + 8 <= to) {
    let size = buf.readUInt32BE(off);
    const boxType = buf.toString('ascii', off + 4, off + 8);
    let headerSize = 8;
    if (size === 1) {
      const hi = buf.readUInt32BE(off + 8);
      const lo = buf.readUInt32BE(off + 12);
      size = hi * 2 ** 32 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = to - off;
    }
    if (size < headerSize || off + size > to) break;
    if (boxType === type) return { start: off + headerSize, end: off + size };
    off += size;
  }
  return null;
}

function mp4DurationSeconds(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  try {
    const moov = findBox(buf, 0, buf.length, 'moov');
    if (!moov) return null;
    const mvhd = findBox(buf, moov.start, moov.end, 'mvhd');
    if (!mvhd) return null;
    const p = mvhd.start;
    const version = buf[p];
    let timescale;
    let duration;
    if (version === 1) {
      timescale = buf.readUInt32BE(p + 20);
      duration = buf.readUInt32BE(p + 24) * 2 ** 32 + buf.readUInt32BE(p + 28);
    } else {
      timescale = buf.readUInt32BE(p + 12);
      duration = buf.readUInt32BE(p + 16);
    }
    if (!timescale || !duration || !Number.isFinite(duration)) return null;
    return duration / timescale;
  } catch {
    return null;
  }
}

module.exports = { mp4DurationSeconds };
