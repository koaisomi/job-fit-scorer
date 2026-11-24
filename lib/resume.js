// Resume file reading: PDF (base64), DOCX (tiny zip reader + XML text), TXT/MD.

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export function kindOf(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  return ['pdf', 'docx', 'txt', 'md'].includes(ext) ? ext : null;
}

export async function readResumeFile(file) {
  const kind = kindOf(file.name);
  if (!kind) throw new Error('Use a PDF, DOCX, TXT or MD file.');
  const base = { name: file.name, kind, size: file.size, addedAt: Date.now() };
  if (kind === 'pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('This PDF is over 10 MB. Export a smaller copy or paste the text instead.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfBase64 = toBase64(bytes); // before pdf.js, which may detach the buffer
    return { ...base, pdfBase64, text: await pdfToText(bytes).catch(() => '') };
  }
  const text = kind === 'docx' ? await docxToText(new Uint8Array(await file.arrayBuffer())) : await file.text();
  if (!text.trim()) throw new Error('No text found in this file. Try another format or paste the text instead.');
  return { ...base, text: text.trim() };
}

export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---------- pdf text (vendored pdf.js, loaded only when needed) ----------
export async function pdfToText(bytes) {
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/vendor/pdf.worker.min.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) pages.push(textItemsToLines((await (await doc.getPage(n)).getTextContent()).items));
  } finally {
    doc.destroy();
  }
  return pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// pdf.js text items -> lines: a new line when y moves, a space when x jumps past the previous item.
export function textItemsToLines(items) {
  const lines = [];
  let line = '';
  let y = null;
  let end = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const [x, iy] = [it.transform[4], it.transform[5]];
    if (it.str) {
      if (y !== null && Math.abs(iy - y) > 2) {
        lines.push(line.trimEnd());
        line = '';
        end = null;
      }
      if (line && end !== null && x > end + 1 && !/\s$/.test(line) && !/^\s/.test(it.str)) line += ' ';
      line += it.str;
      y = iy;
      end = x + (it.width || 0);
    }
    if (it.hasEOL && line) {
      lines.push(line.trimEnd());
      line = '';
      y = null;
      end = null;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.join('\n').replace(/[^\S\n]+/g, ' ');
}

// ---------- zip reader ----------
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Returns Map(name -> async () => Uint8Array).
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a valid DOCX (zip) file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged DOCX file.');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, async () => {
      const start = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
      const data = bytes.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error('Unsupported compression in DOCX file.');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- docx ----------
export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

export function docxXmlToText(xml) {
  return xml
    .split('</w:p>')
    .map((para) => {
      const p = para.replace(/<w:tab\/>/g, '<w:t>\t</w:t>').replace(/<w:br\/>/g, '<w:t>\n</w:t>');
      let line = '';
      for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) line += m[1];
      return decodeXml(line).trimEnd();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function docxToText(bytes) {
  const entry = readZip(bytes).get('word/document.xml');
  if (!entry) throw new Error('This DOCX has no document body.');
  return docxXmlToText(new TextDecoder().decode(await entry()));
}

export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
