// Export helpers. Pure functions (no DOM), so they run in node for tests.
// Input text convention: lines starting with '#' or written in ALL CAPS are headings,
// lines starting with '- ' or '• ' are bullets, everything else is a paragraph.

const HEADING_MD = /^#{1,6}\s+/;

function isCapsHeading(line) {
  const t = line.trim();
  return t.length >= 3 && t.length <= 70 && /[A-Z]/.test(t) && t === t.toUpperCase() && !/^[-•]/.test(t);
}

export function parseLines(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw) => {
      const line = raw.trimEnd();
      if (!line.trim()) return { type: 'blank', text: '' };
      if (HEADING_MD.test(line)) return { type: 'h', text: line.replace(HEADING_MD, '').trim() };
      if (/^\s*[-•]\s+/.test(line)) return { type: 'li', text: line.replace(/^\s*[-•]\s+/, '').trim() };
      if (isCapsHeading(line)) return { type: 'h', text: line.trim() };
      return { type: 'p', text: line.trim() };
    });
}

// ---------- report text ----------
const val = (v) => (v == null || v === '' ? 'Not stated' : String(v));

export function reportText(result, meta = {}) {
  const r = result;
  const j = r.job || {};
  const out = [];
  const list = (title, items) => {
    if (!items?.length) return;
    out.push('', `## ${title}`, ...items.map((s) => `- ${s}`));
  };
  out.push(`# Fit report: ${val(j.title)} at ${val(j.company)}`);
  out.push(`Fit score: ${r.fit.score}/100 (${r.fit.verdict})`);
  out.push(`Company check: ${cap(r.legitimacy.verdict)} (${r.legitimacy.score}/100)`);
  if (meta.url) out.push(`Job post: ${meta.url}`);
  if (meta.scoredAt) out.push(`Scored: ${new Date(meta.scoredAt).toLocaleString()}`);
  list('Job', [
    `Company: ${val(j.company)}`,
    `Location: ${val(j.location)}`,
    `Salary: ${val(j.salary)}`,
    `Employment type: ${val(j.employment_type)}`,
    `Work setup: ${val(j.work_setup)}`,
    `Posted: ${val(j.posted)}`,
    `Rating: ${val(j.rating)}${j.reviews && j.reviews !== 'Not stated' ? ` (${j.reviews})` : ''}`,
    `Industry: ${val(j.industry)}`,
  ]);
  out.push('', '## Summary', r.fit.summary);
  list('Score breakdown', (r.breakdown || []).map((b) => `${b.category}: ${b.score}/100. ${b.notes}`));
  list('Matched strengths', r.matched_strengths);
  list('Gaps', r.gaps);
  list('How to improve', r.improvements);
  list('Resume suggestions', (r.resume_suggestions || []).map((s) => `[${s.section}] ${s.text}`));
  list('Missing ATS keywords', r.ats_keywords_missing);
  const l = r.legitimacy || {};
  out.push('', '## Company check', `Verdict: ${cap(l.verdict)} (${l.score}/100)`);
  list('Green flags', l.green_flags);
  list('Red flags', l.red_flags);
  list('Missing information', l.missing_info);
  if (l.advice) out.push('', '## Advice', l.advice);
  return out.join('\n');
}

function cap(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- txt / md / html ----------
export function toTxt(text) {
  return parseLines(text)
    .map((l) => (l.type === 'h' ? l.text.toUpperCase() : l.type === 'li' ? `- ${l.text}` : l.text))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export function toMarkdown(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      if (HEADING_MD.test(line)) return line;
      if (/^\s*•\s+/.test(line)) return line.replace(/^\s*•\s+/, '- ');
      if (isCapsHeading(line)) return `## ${line.trim()}`;
      return line;
    })
    .join('\n');
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function toHtml(text, title = 'Document') {
  const body = [];
  let inList = false;
  for (const l of parseLines(text)) {
    if (l.type !== 'li' && inList) {
      body.push('</ul>');
      inList = false;
    }
    if (l.type === 'h') body.push(`<h2>${escHtml(l.text)}</h2>`);
    else if (l.type === 'li') {
      if (!inList) body.push('<ul>');
      inList = true;
      body.push(`<li>${escHtml(l.text)}</li>`);
    } else if (l.type === 'p') body.push(`<p>${escHtml(l.text)}</p>`);
  }
  if (inList) body.push('</ul>');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  body { font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1B2632; max-width: 720px; margin: 48px auto; padding: 0 24px; }
  h2 { font-size: 17px; margin: 28px 0 8px; letter-spacing: -0.01em; }
  h2:first-child { margin-top: 0; font-size: 22px; }
  p { margin: 0 0 8px; }
  ul { margin: 0 0 12px; padding-left: 20px; }
  li { margin: 0 0 4px; }
  @media print { body { margin: 0; max-width: none; } h2 { break-after: avoid; } li, p { break-inside: avoid; } }
</style></head>
<body>
${body.join('\n')}
</body></html>
`;
}

// ---------- zip (stored) + docx ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStored(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return concat([...parts, ...central, new Uint8Array(end.buffer)]);
}

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

const escXml = (s) =>
  String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function toDocx(text) {
  const run = (t, bold, size) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escXml(t)}</w:t></w:r>`;
  const paras = [];
  for (const l of parseLines(text)) {
    if (l.type === 'blank') continue;
    if (l.type === 'h') paras.push(`<w:p><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/></w:pPr>${run(l.text, true, 26)}</w:p>`);
    else if (l.type === 'li') paras.push(`<w:p><w:pPr><w:spacing w:after="60"/><w:ind w:left="360" w:hanging="220"/></w:pPr>${run('• ' + l.text, false, 21)}</w:p>`);
    else paras.push(`<w:p><w:pPr><w:spacing w:after="100"/></w:pPr>${run(l.text, false, 21)}</w:p>`);
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zipStored([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: doc },
  ]);
}

// ---------- PDF 1.4 ----------
// Helvetica and Helvetica-Bold advance widths (1/1000 em) for chars 32-126, from the Adobe AFMs.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278,
  278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556,
  556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELV_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333,
  333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611,
  611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
// Unicode punctuation -> WinAnsi byte, and widths for those bytes.
const WIN = { 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85, 0xa0: 0x20 };
const WIN_W = {
  F1: { 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x85: 1000 },
  F2: { 0x91: 278, 0x92: 278, 0x93: 500, 0x94: 500, 0x95: 350, 0x96: 556, 0x97: 1000, 0x85: 1000 },
};

// Returns a "byte string" (each char code 0-255) in WinAnsiEncoding.
export function winAnsi(s) {
  let out = '';
  for (const ch of String(s).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c === 9) out += ' ';
    else if (c >= 32 && c <= 126) out += ch;
    else if (WIN[c]) out += String.fromCharCode(WIN[c]);
    else if (c >= 0xa1 && c <= 0xff) out += ch; // Latin-1 letters (é, ñ) are the same bytes in WinAnsi
    else out += '?';
  }
  return out;
}

export function textWidth(s, font, size) {
  const table = font === 'F2' ? HELV_BOLD : HELV;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    w += c >= 32 && c <= 126 ? table[c - 32] : WIN_W[font][c] ?? 556;
  }
  return (w * size) / 1000;
}

function wrap(s, font, size, max) {
  const lines = [];
  let line = '';
  for (let word of s.split(/ +/)) {
    if (!word) continue;
    const next = line ? line + ' ' + word : word;
    if (textWidth(next, font, size) <= max) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    while (textWidth(word, font, size) > max) {
      let i = word.length - 1;
      while (i > 1 && textWidth(word.slice(0, i), font, size) > max) i--;
      lines.push(word.slice(0, i));
      word = word.slice(i);
    }
    line = word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const escPdf = (s) => s.replace(/[\\()]/g, '\\$&');

export function toPdf(text) {
  const PAGE_W = 612;
  const PAGE_H = 792;
  const M = 54;
  const BODY = 10.5;
  const HEAD = 13;
  const pages = [];
  let ops = [];
  let y = PAGE_H - M;
  let atTop = true;

  const newPage = () => {
    pages.push(ops);
    ops = [];
    y = PAGE_H - M;
    atTop = true;
  };
  const draw = (str, font, size, x, lead) => {
    if (y - lead < M) newPage();
    const base = y - size;
    ops.push(`BT /${font} ${size} Tf ${x} ${base.toFixed(2)} Td (${escPdf(str)}) Tj ET`);
    y -= lead;
    atTop = false;
  };

  for (const l of parseLines(text)) {
    const t = winAnsi(l.text);
    if (l.type === 'blank') {
      if (!atTop) y -= 4;
    } else if (l.type === 'h') {
      if (!atTop) y -= 8;
      if (y - 40 < M) newPage(); // keep a heading with its first lines
      wrap(t, 'F2', HEAD, PAGE_W - 2 * M).forEach((s) => draw(s, 'F2', HEAD, M, 17));
      y -= 3;
    } else if (l.type === 'li') {
      const lines = wrap(t, 'F1', BODY, PAGE_W - 2 * M - 12);
      lines.forEach((s, i) => {
        if (i === 0) {
          if (y - 14.5 < M) newPage();
          ops.push(`BT /F1 ${BODY} Tf ${M} ${(y - BODY).toFixed(2)} Td (\x95) Tj ET`);
        }
        draw(s, 'F1', BODY, M + 12, 14.5);
      });
      y -= 2;
    } else {
      wrap(t, 'F1', BODY, PAGE_W - 2 * M).forEach((s) => draw(s, 'F1', BODY, M, 14.5));
      y -= 4;
    }
  }
  if (ops.length || !pages.length) pages.push(ops);

  const font = (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, font('Helvetica'), font('Helvetica-Bold')];
  const kids = [];
  for (const p of pages) {
    const stream = p.join('\n');
    const contentNum = objs.length + 2;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>`
    );
    kids.push(`${objs.length} 0 R`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

// ---------- file naming + one entry point ----------
export function fileBase(company, role, kind) {
  const clean = (s) =>
    String(s || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const known = (s) => (s && !/^not stated$/i.test(String(s).trim()) ? s : '');
  const parts = [clean(known(company)) || 'Company', clean(known(role)) || 'Role', kind].map((p) => p.slice(0, 60));
  return parts.join(' - ').replace(/[. ]+$/, '');
}

export const FORMATS = [
  { id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  { id: 'docx', label: 'Word (.docx)', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { id: 'txt', label: 'Text (.txt)', ext: 'txt', mime: 'text/plain;charset=utf-8' },
  { id: 'md', label: 'Markdown (.md)', ext: 'md', mime: 'text/markdown;charset=utf-8' },
  { id: 'html', label: 'HTML', ext: 'html', mime: 'text/html;charset=utf-8' },
];

export function makeFile(format, text, title) {
  const f = FORMATS.find((x) => x.id === format);
  if (!f) throw new Error('Unknown format: ' + format);
  const data =
    format === 'pdf' ? toPdf(text) : format === 'docx' ? toDocx(text) : format === 'txt' ? toTxt(text) : format === 'md' ? toMarkdown(text) : toHtml(text, title);
  return { blob: new Blob([data], { type: f.mime }), ext: f.ext };
}
