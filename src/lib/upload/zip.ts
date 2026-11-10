/**
 * Lists the entry names of a zip by reading only its central directory (the
 * last few KB), so a 200 MB archive is checked without loading it. Returns
 * null when the file isn't a readable zip. No decompression happens here.
 */
const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const EOCD_MIN = 22;
const EOCD_MAX = EOCD_MIN + 0xffff; // plus the longest allowed comment

export async function readZipEntryNames(blob: Blob): Promise<string[] | null> {
  const tailStart = Math.max(0, blob.size - EOCD_MAX);
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - EOCD_MIN; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > blob.size) return null; // zip64 or corrupt

  const cd = new DataView(
    await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer(),
  );
  const decoder = new TextDecoder();
  const names: string[] = [];
  let p = 0;
  while (p + 46 <= cd.byteLength && cd.getUint32(p, true) === CDH_SIG) {
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    if (p + 46 + nameLen > cd.byteLength) return null;
    const start = cd.byteOffset + p + 46;
    names.push(decoder.decode(new Uint8Array(cd.buffer, start, nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}
