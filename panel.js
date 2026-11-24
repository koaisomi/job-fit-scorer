import { callClaude } from './lib/api.js';
import { SCORE_SYSTEM, SCORE_SCHEMA, GEN_SYSTEM, GEN_SCHEMA, scoreContent, genContent } from './lib/prompts.js';
import { readResumeFile, formatSize, pdfToText, fromBase64 } from './lib/resume.js';
import { chatOf, scorePrompt, genPrompt, parseScoreReply, parseGenReply, normalizeResult } from './lib/handoff.js';
import { quickScore } from './lib/quick.js';
import { reportText, toTxt, makeFile, fileBase, FORMATS } from './lib/export.js';
import * as store from './lib/storage.js';

const $ = (s) => document.querySelector(s);
const S = {
  settings: null,
  resume: null,
  page: null,
  pageError: '',
  entry: null, // { result, meta: {url,title,siteName,favicon}, scoredAt }
  saved: [],
  gen: null, // { resume, cover_letter }
  genTab: 'resume',
  abort: null,
  handoff: null, // { mode: 'score'|'gen', want, page, prompt, chat, back } while waiting for a pasted chat reply
  view: 'main',
  prevView: 'main',
};

// ---------- small helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only for our own static icon strings
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const ICONS = {
  copy: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M13 4.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v6.5A1.5 1.5 0 0 0 5 12h.5"/></svg>',
  check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>',
  chev: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>',
  caret: '<svg class="caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 8 10 12.5 14.5 8"/></svg>',
  x: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg>',
  star: '<path d="M10 2.8l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5L2.8 8l5-.6z"/>',
};
const icon = (name) => h('span', { html: ICONS[name], style: 'display:contents' });

const known = (v) => v != null && String(v).trim() !== '' && !/^not stated$/i.test(String(v).trim());
const bandOf = (n) => (n >= 75 ? 'band-good' : n >= 50 ? 'band-mid' : 'band-low');
const LEGIT = { legit: ['Legit', 'pos'], caution: ['Caution', 'warn'], suspicious: ['Suspicious', 'neg'] };
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtTime = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

async function copyText(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) {
      toast('Copy failed');
      return false;
    }
  }
  toast(done);
  return true;
}

// Site favicon, or the site's initial when the page declares none or it fails to load.
function siteIcon(src, name, size) {
  const initial = h('span', { class: 'site-initial', 'aria-hidden': 'true', style: `width:${size}px;height:${size}px` }, (String(name || '?').trim().charAt(0) || '?').toUpperCase());
  if (!src) return initial;
  const img = h('img', { src, alt: '', width: size, height: size });
  img.onerror = () => img.replaceWith(initial);
  return img;
}

function showErr(sel, msg) {
  const el = $(sel);
  el.textContent = msg;
  el.hidden = !msg;
}

// ---------- views ----------
const ORDER = { main: 0, settings: 0, loading: 1, paste: 1, results: 2, apply: 3, generated: 4 };

function show(view) {
  const from = S.view;
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'v-' + view;
  const el = $('#v-' + view);
  el.classList.remove('enter-fwd', 'enter-back');
  void el.offsetWidth; // restart the entry animation
  el.classList.add(ORDER[view] >= ORDER[from] && view !== 'main' ? 'enter-fwd' : 'enter-back');
  S.view = view;
  $('#back').hidden = view === 'main' || view === 'loading';
  $('#open-settings').disabled = view === 'loading';
  window.scrollTo(0, 0);
  if (view === 'main') refreshPage();
}

function goBack() {
  const v = S.view;
  if (v === 'settings') show(S.prevView === 'loading' ? 'main' : S.prevView);
  else if (v === 'paste') show(S.handoff?.back || 'main');
  else if (v === 'apply' || v === 'generated') show('results');
  else show('main');
}

// ---------- page ----------
// The side panel belongs to one window and reads that window's active tab.
async function activeTabId() {
  const [t] = await chrome.tabs.query({ active: true, windowId: S.windowId });
  return t?.id;
}

// Inject content.js into the tab's top frame; its last expression is the page data.
async function getPage() {
  let res = null;
  try {
    S.tabId = await activeTabId();
    if (S.tabId != null) [{ result: res } = {}] = await chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ['content.js'] });
  } catch {}
  if (!res || !res.text) {
    throw new Error("Can't read this page. Open a job post on a normal website (not a browser, new tab or extension store page). If the page is still loading, wait a moment.");
  }
  return res;
}

let refreshSeq = 0;
async function refreshPage() {
  const seq = ++refreshSeq;
  let page = null;
  let err = '';
  try {
    page = await getPage();
  } catch (e) {
    err = e.message;
  }
  if (seq !== refreshSeq) return; // a newer read (tab switch, navigation) replaced this one
  S.page = page;
  S.pageError = err;
  renderPageCard();
  if (S.page && S.entry?.meta.key !== S.page.key) {
    const entry = await store.getResult(S.page.key);
    if (seq !== refreshSeq) return;
    S.entry = entry;
  }
  renderViewLast();
  updateStart();
}

function renderPageCard() {
  const box = $('#page-icon');
  if (S.page) {
    $('#page-title').textContent = S.page.title || S.page.url;
    $('#page-site').textContent = S.page.siteName;
    box.replaceChildren(siteIcon(S.page.favicon, S.page.siteName, 16));
  } else {
    $('#page-title').textContent = 'No readable page';
    $('#page-site').textContent = S.pageError;
    box.replaceChildren();
  }
}

function renderViewLast() {
  const btn = $('#view-last');
  const ok = S.entry && S.page && S.entry.meta.key === S.page.key;
  btn.hidden = !ok;
  if (ok) btn.textContent = `View last result: ${S.entry.result.fit.score}, ${S.entry.result.fit.verdict}`;
}

const SCANNED = 'This PDF looks scanned. Paste the text or use a DOCX for the free modes.';
const scanned = () => S.resume?.kind === 'pdf' && (S.resume.text || '').length < 200;
const ENGINE_HINT = {
  handoff: (chat) => `Copies a prompt and opens ${chat}. Free.`,
  quick: () => 'Instant keyword check on this device. No AI. Free.',
  api: () => '',
};

function updateStart() {
  // Static nodes only: rebuilding the hint on focus would swap the button out mid-click.
  const eng = S.settings?.engine;
  const noResume = !S.resume;
  const noKey = !noResume && eng === 'api' && !S.settings?.apiKey;
  const noText = !noResume && eng !== 'api' && scanned();
  const text = noResume
    ? 'Attach your resume to start.'
    : noKey
      ? 'Add your Claude API key to start.'
      : noText
        ? S.resume.text == null ? 'Reading your PDF...' : SCANNED
        : (ENGINE_HINT[eng] || ENGINE_HINT.api)(chatOf(S.settings?.chatSite).label);
  $('#start-hint-text').textContent = text;
  $('#hint-settings').hidden = !noKey;
  $('#start-hint').hidden = !text;
  $('#start').disabled = noResume || noKey || noText;
}

// ---------- resume ----------
function renderResume() {
  const r = S.resume;
  $('#resume-empty').hidden = !!r;
  $('#resume-chip').hidden = !r;
  if (r) {
    $('#resume-name').textContent = r.name;
    $('#resume-meta').textContent = `${r.kind.toUpperCase()} · ${formatSize(r.size)} · added ${fmtDate(r.addedAt)}`;
  }
  updateStart();
}

async function useResume(r) {
  await store.setResume(r);
  S.resume = r;
  showErr('#resume-error', '');
  renderResume();
  toast('Resume attached');
}

// PDF resumes stored before text extraction existed: add the text once so the free modes can use it.
async function backfillPdfText() {
  const r = S.resume;
  if (r?.kind !== 'pdf' || r.text != null || !r.pdfBase64) return;
  const text = await pdfToText(fromBase64(r.pdfBase64)).catch(() => '');
  if (S.resume !== r) return; // replaced meanwhile
  S.resume = { ...r, text };
  await store.setResume(S.resume);
  updateStart();
}

async function handleFile(file) {
  if (!file) return;
  try {
    await useResume(await readResumeFile(file));
  } catch (e) {
    showErr('#resume-error', e.message);
  }
}

// ---------- scoring ----------
const STEPS = { score: ['Reading page...', 'Analyzing fit...'], gen: ['Reading page...', 'Writing...'] };

function loading(title, steps) {
  $('#load-title').textContent = title;
  $('#load-steps').replaceChildren(...steps.map((s) => h('li', {}, s)));
  step(0);
  show('loading');
}
function step(i) {
  [...$('#load-steps').children].forEach((li, n) => (li.className = n < i ? 'done' : n === i ? 'active' : ''));
}

const apiArgs = () => ({ apiKey: S.settings.apiKey, model: S.settings.model, effort: S.settings.effort });

// via: the engine badge on the result ("via claude.ai chat", "Quick check", "Claude API").
async function finishScore(page, result, via) {
  const entry = {
    result: normalizeResult(result),
    meta: { url: page.url, key: page.key, title: page.title, siteName: page.siteName, favicon: page.favicon },
    scoredAt: Date.now(),
    via,
  };
  await store.setResult(page.key, entry);
  S.entry = entry;
  S.scoredPage = page; // kept for I'll Apply Now: by then the active tab is often the chat site
  S.gen = null;
  renderResults();
  show('results');
}

async function startScoring() {
  const eng = S.settings.engine;
  if (!S.resume || (eng === 'api' ? !S.settings.apiKey : scanned())) return;
  showErr('#start-error', '');
  const back = S.view === 'results' ? 'results' : 'main';
  if (eng !== 'api') {
    try {
      const page = await getPage();
      S.page = page;
      if (eng === 'quick') return await finishScore(page, quickScore(page, S.resume.text), 'Quick check');
      const chat = chatOf(S.settings.chatSite);
      return await startHandoff({ mode: 'score', page, back, chat, prompt: scorePrompt(S.resume.text, page) });
    } catch (e) {
      show('main');
      return showErr('#start-error', e.message);
    }
  }
  const ctrl = (S.abort = new AbortController());
  loading('Scoring this job', STEPS.score);
  try {
    const page = await getPage();
    if (ctrl !== S.abort) return;
    S.page = page;
    step(1);
    const result = await callClaude({ ...apiArgs(), system: SCORE_SYSTEM, content: scoreContent(S.resume, page), schema: SCORE_SCHEMA, signal: ctrl.signal });
    if (ctrl !== S.abort) return; // a newer request replaced this one
    await finishScore(page, result, 'Claude API');
  } catch (e) {
    if (ctrl !== S.abort) return;
    if (e.name === 'AbortError') return show(back);
    show('main');
    showErr('#start-error', e.message);
  } finally {
    if (S.abort === ctrl) S.abort = null;
  }
}

// ---------- free chat handoff ----------
const openChat = () => chrome.tabs.create({ url: (S.handoff?.chat || chatOf(S.settings.chatSite)).url, active: true });

// Copy the prompt, open the chat site, wait for the pasted reply. If copying fails, show the prompt to copy by hand.
async function startHandoff(job) {
  S.handoff = job;
  for (const el of document.querySelectorAll('.chat-name')) el.textContent = job.chat.label;
  $('#paste-go').textContent = job.mode === 'score' ? 'Show results' : 'Show documents';
  $('#reply').value = '';
  $('#prompt-text').value = job.prompt;
  showErr('#paste-error', '');
  const copied = await copyText(job.prompt, 'Prompt copied');
  $('#prompt-box').hidden = copied;
  show('paste');
  if (copied) openChat();
}

async function usePaste() {
  const job = S.handoff;
  if (!job) return;
  try {
    if (job.mode === 'score') {
      await finishScore(job.page, parseScoreReply($('#reply').value), `via ${job.chat.label} chat`);
    } else {
      S.gen = parseGenReply($('#reply').value, job.want);
      S.genTab = S.gen.resume ? 'resume' : 'cover_letter';
      renderGenerated();
      show('generated');
    }
    S.handoff = null;
  } catch (e) {
    showErr('#paste-error', e.message);
  }
}

// ---------- results ----------
function ring(score) {
  const C = 2 * Math.PI * 29;
  const el = h('div', { class: 'ring ' + bandOf(score), role: 'img', 'aria-label': `Fit score ${score} out of 100` });
  el.innerHTML = `<svg viewBox="0 0 68 68" aria-hidden="true"><circle class="track" cx="34" cy="34" r="29"/><circle class="val" cx="34" cy="34" r="29" stroke="currentColor" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/></svg><b style="color:var(--text)">${score}</b>`;
  requestAnimationFrame(() => requestAnimationFrame(() => (el.querySelector('.val').style.strokeDashoffset = (C * (1 - score / 100)).toFixed(2))));
  return el;
}

function sec(title, body, note) {
  return h('details', { class: 'sec', open: true }, h('summary', {}, h('span', {}, title), note ? h('span', { class: 'sum-note' }, note) : null, icon('chev')), h('div', { class: 'sec-body' }, body));
}

const chips = (items, cls) => (items.length ? h('div', { class: 'chips' }, items.map((t) => h('span', { class: 'chip ' + (cls || '') }, t))) : h('p', { class: 'meta' }, 'None.'));
const list = (items, cls) => (items.length ? h('ul', { class: 'list ' + (cls || '') }, items.map((t) => h('li', {}, t))) : h('p', { class: 'meta' }, 'None found.'));

function stars(rating, reviews) {
  const r = parseFloat(rating);
  if (!(r > 0 && r <= 5)) return null;
  const n = Math.round(r);
  const count = known(reviews) ? String(reviews).match(/[\d.,]+k?/i)?.[0] : '';
  const el = h('span', { class: 'stars', 'aria-label': `Rated ${rating} out of 5${count ? `, ${count} reviews` : ''}` });
  el.innerHTML = Array.from({ length: 5 }, (_, i) => `<svg viewBox="0 0 20 20" aria-hidden="true" class="${i < n ? 'on' : ''}">${ICONS.star}</svg>`).join('');
  el.append(h('b', {}, `${rating}${count ? ` (${count})` : ''}`));
  return el;
}

function renderResults() {
  const { result: r, meta, scoredAt } = S.entry;
  const j = r.job;
  const leg = LEGIT[r.legitimacy.verdict] || LEGIT.caution;
  const band = bandOf(r.fit.score);
  const facts = [j.location, j.salary, j.employment_type, j.work_setup, j.posted].filter(known).map((f) => h('span', {}, f));

  const top = h(
    'div',
    { class: 'card top-card' },
    h('button', { class: 'icon-btn small copy-all', 'aria-label': 'Copy full report', title: 'Copy report', html: ICONS.copy, onclick: () => copyText(toTxt(reportText(r, { url: meta.url, scoredAt }))) }),
    h(
      'div',
      { class: 'top-row' },
      ring(r.fit.score),
      h(
        'div',
        { class: 'top-text' },
        h('p', { class: 'verdict ' + band }, r.fit.verdict),
        h('h1', { class: 'job-title' }, known(j.title) ? j.title : meta.title),
        h('p', { class: 'company' }, h('span', { class: 'dot ' + r.legitimacy.verdict, title: `Company check: ${leg[0]}`, role: 'img', 'aria-label': `Company check: ${leg[0]}` }), known(j.company) ? j.company : 'Company not stated')
      )
    ),
    facts.length || stars(j.rating, j.reviews) ? h('div', { class: 'facts' }, stars(j.rating, j.reviews), facts) : null,
    h('p', { class: 'scored' }, `Scored ${fmtTime(scoredAt)}`, h('span', { class: 'engine' }, S.entry.via || 'Claude API'), '·', h('button', { class: 'text-btn', onclick: startScoring }, 'Rescore'))
  );

  const bars = h(
    'div',
    { class: 'bars' },
    r.breakdown.map((b) =>
      h(
        'div',
        { class: bandOf(b.score) },
        h('div', { class: 'bar-head' }, h('span', { style: 'color:var(--text)' }, b.category), h('span', { class: 'num', style: 'color:var(--text)' }, b.score)),
        h('div', { class: 'bar-track', role: 'img', 'aria-label': `${b.category}: ${b.score} out of 100` }, h('div', { class: 'bar-fill', style: `width:${b.score}%` })),
        h('p', { class: 'bar-notes' }, b.notes)
      )
    )
  );

  const sugg = r.resume_suggestions.length
    ? r.resume_suggestions.map((s) => {
        const btn = h('button', { class: 'icon-btn small', 'aria-label': 'Copy suggestion', title: 'Copy', html: ICONS.copy });
        btn.addEventListener('click', () => {
          copyText(s.text);
          btn.innerHTML = ICONS.check;
          setTimeout(() => (btn.innerHTML = ICONS.copy), 1400);
        });
        return h('div', { class: 'sugg' }, h('div', {}, h('span', { class: 'meta' }, s.section), h('p', {}, s.text)), btn);
      })
    : h('p', { class: 'meta' }, 'No suggestions.');

  const L = r.legitimacy;
  const company = [
    h('div', { class: 'legit-head' }, h('span', { class: 'pill ' + leg[1] }, leg[0]), h('span', { class: 'meta num' }, `${L.score}/100 confidence the post is genuine`)),
    h('h3', {}, 'Green flags'),
    list(L.green_flags || [], 'good'),
    h('h3', {}, 'Red flags'),
    list(L.red_flags || [], 'bad'),
    h('h3', {}, 'Missing information'),
    list(L.missing_info || []),
    L.advice ? [h('h3', {}, 'Advice'), h('p', {}, L.advice)] : null,
  ];

  $('#results').replaceChildren(
    top,
    sec('Summary', h('p', {}, r.fit.summary)),
    sec('Breakdown', bars),
    sec('Strengths and gaps', [h('h3', {}, 'Matched strengths'), chips(r.matched_strengths, 'pos'), h('h3', {}, 'Gaps'), chips(r.gaps, 'warn')]),
    sec('How to improve', list(r.improvements)),
    sec('Resume suggestions', sugg, r.resume_suggestions.length ? String(r.resume_suggestions.length) : null),
    sec('Missing ATS keywords', chips(r.ats_keywords_missing)),
    sec('Company check', company, leg[0])
  );
  updateSaveBtn();
}

// ---------- save ----------
const isSaved = () => S.entry && S.saved.some((j) => j.url === S.entry.meta.key);

function updateSaveBtn() {
  const b = $('#save');
  const on = isSaved();
  b.textContent = on ? 'Saved' : 'Save';
  b.setAttribute('aria-pressed', String(!!on));
}

async function toggleSave() {
  const { result: r, meta } = S.entry;
  if (isSaved()) {
    S.saved = await store.removeJob(meta.key);
    toast('Removed from saved jobs');
  } else {
    const j = r.job;
    S.saved = await store.saveJob({
      id: crypto.randomUUID(),
      url: meta.key, // canonical job link: dedupe key and the link the card opens
      siteName: meta.siteName,
      favicon: meta.favicon,
      title: known(j.title) ? j.title : meta.title,
      company: j.company,
      salary: j.salary,
      posted: j.posted,
      location: j.location,
      rating: j.rating,
      reviews: j.reviews,
      legitimacy: r.legitimacy.verdict,
      fitScore: r.fit.score,
      savedAt: Date.now(),
    });
    toast('Saved');
  }
  updateSaveBtn();
  renderSaved();
}

function renderSaved() {
  $('#saved-count').textContent = `(${S.saved.length})`;
  $('#saved-empty').hidden = S.saved.length > 0;
  $('#saved-list').replaceChildren(
    ...S.saved.map((j) => {
      const leg = LEGIT[j.legitimacy] || LEGIT.caution;
      const img = siteIcon(j.favicon, j.siteName, 14);
      const line1 = [known(j.company) ? h('span', {}, j.company) : null, stars(j.rating, j.reviews), known(j.salary) ? h('span', {}, j.salary) : null];
      const line2 = [known(j.location) ? j.location : null, known(j.posted) ? j.posted : null, `Saved ${fmtDate(j.savedAt)}`].filter(Boolean).map((t) => h('span', {}, t));
      return h(
        'li',
        { class: 'job' },
        h('div', { class: 'job-site' }, img, h('span', {}, j.siteName), h('span', { class: 'dot ' + j.legitimacy, title: `Company check: ${leg[0]}`, role: 'img', 'aria-label': `Company check: ${leg[0]}` })),
        h('a', { class: 'job-role', href: j.url, target: '_blank', rel: 'noopener noreferrer' }, j.title),
        h('div', { class: 'job-line' }, line1),
        h('div', { class: 'job-line' }, line2),
        h('span', { class: 'fit-badge ' + bandOf(j.fitScore), title: 'Fit score', 'aria-label': `Fit score ${j.fitScore}` }, j.fitScore),
        h('button', {
          class: 'icon-btn small remove',
          'aria-label': `Remove ${j.title}`,
          title: 'Remove',
          html: ICONS.x,
          onclick: async () => {
            S.saved = await store.removeJob(j.url);
            renderSaved();
            if (S.entry) updateSaveBtn();
          },
        })
      );
    })
  );
}

// ---------- downloads ----------
function download(format, { text, title, base }) {
  const { blob, ext } = makeFile(format, text, title);
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `${base}.${ext}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadMenu(wrap, getDoc) {
  const btn = h('button', { class: 'btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, 'Download', icon('caret'));
  wrap.replaceChildren(btn);
  let menu = null;
  const outside = (e) => !wrap.contains(e.target) && close();
  function close() {
    menu?.remove();
    menu = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
  }
  btn.addEventListener('click', () => {
    if (menu) return close();
    menu = h(
      'div',
      { class: 'menu', role: 'menu' },
      FORMATS.map((f) =>
        h('button', {
          role: 'menuitem',
          onclick: () => {
            close();
            btn.focus();
            download(f.id, getDoc());
          },
        }, f.label)
      )
    );
    wrap.append(menu);
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('button').focus();
    document.addEventListener('pointerdown', outside, true);
  });
  wrap.addEventListener('keydown', (e) => {
    if (!menu) return;
    if (e.key === 'Escape') {
      close();
      btn.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      e.preventDefault();
    }
  });
}

const jobNames = () => {
  const { result: r, meta } = S.entry;
  return [r.job.company, known(r.job.title) ? r.job.title : meta.title];
};

// ---------- apply + generate ----------
// The scored job's page text: from this session's scoring, else read the active tab again.
async function jobPage() {
  const key = S.entry.meta.key;
  for (const p of [S.page, S.scoredPage]) if (p?.key === key) return p;
  const page = await getPage().catch(() => null);
  return page?.key === key ? page : null;
}

function openApply() {
  const [company, role] = jobNames();
  $('#apply-sub').textContent = `${role}${known(company) ? ' at ' + company : ''}`;
  const free = S.settings.engine !== 'api';
  $('#apply-note').hidden = !free;
  $('#apply-note').textContent = free ? `Uses your AI chat: the prompt is copied and ${chatOf(S.settings.chatSite).label} opens. Free.` : '';
  showErr('#apply-error', '');
  show('apply');
}

async function generate(want) {
  if (!S.resume) return showErr('#apply-error', 'Attach your resume first.');
  if (S.settings.engine !== 'api') {
    // Quick check has no AI, so writing documents always goes through the chat handoff.
    if (scanned()) return showErr('#apply-error', SCANNED);
    const page = await jobPage();
    if (!page) return showErr('#apply-error', 'Open the job post you scored, then try again.');
    return startHandoff({ mode: 'gen', want, page, back: 'apply', chat: chatOf(S.settings.chatSite), prompt: genPrompt(S.resume.text, page, S.entry.result, want) });
  }
  if (!S.settings.apiKey) return openSettings();
  const ctrl = (S.abort = new AbortController());
  loading(want === 'both' ? 'Writing your resume and cover letter' : want === 'resume' ? 'Writing your resume' : 'Writing your cover letter', STEPS.gen);
  try {
    const page = await jobPage();
    if (ctrl !== S.abort) return;
    if (!page) throw new Error('Open the job post you scored, then try again.');
    step(1);
    const out = await callClaude({ ...apiArgs(), system: GEN_SYSTEM, content: genContent(S.resume, page, S.entry.result, want), schema: GEN_SCHEMA, signal: ctrl.signal, stream: true });
    if (ctrl !== S.abort) return; // a newer request replaced this one
    S.gen = { resume: want === 'cover_letter' ? '' : out.resume || '', cover_letter: want === 'resume' ? '' : out.cover_letter || '' };
    if (!S.gen.resume && !S.gen.cover_letter) throw new Error('Claude returned empty documents. Try again.');
    S.genTab = S.gen.resume ? 'resume' : 'cover_letter';
    renderGenerated();
    show('generated');
  } catch (e) {
    if (ctrl !== S.abort) return;
    if (e.name === 'AbortError') return show('apply');
    show('apply');
    showErr('#apply-error', e.message);
  } finally {
    if (S.abort === ctrl) S.abort = null;
  }
}

function renderGenerated() {
  const both = !!(S.gen.resume && S.gen.cover_letter);
  $('#gen-tabs').hidden = !both;
  $('#gen-title').textContent = both ? 'Your documents' : S.genTab === 'resume' ? 'Your resume' : 'Your cover letter';
  for (const t of document.querySelectorAll('#gen-tabs [role="tab"]')) {
    const on = t.dataset.doc === S.genTab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  $('#gen-text').value = S.gen[S.genTab];
}

// ---------- settings ----------
function openSettings() {
  if (S.view === 'settings') return goBack();
  S.prevView = S.view;
  show('settings');
}

let stampTimer;
async function saveSetting(key, value) {
  S.settings[key] = value;
  await store.setSetting(key, value);
  const st = $('#stamp');
  st.textContent = 'Saved';
  clearTimeout(stampTimer);
  stampTimer = setTimeout(() => (st.textContent = ''), 1500);
  updateStart();
}

const ENGINE_HELP = {
  handoff: 'Free. Copies a prompt and opens your chat site. Paste it there, then paste the reply back here.',
  quick: 'Free and instant. Checks keywords, years, education and warning signs on this device. Writing a resume or cover letter still uses your AI chat.',
  api: 'Paid per use. Sends your resume and the page to the Claude API with your own key.',
};

function fillSettings() {
  if (!ENGINE_HELP[S.settings.engine]) S.settings.engine = store.DEFAULTS.engine;
  const eng = S.settings.engine;
  $('#engine').value = eng;
  $('#engine-help').textContent = ENGINE_HELP[eng];
  $('#api-fields').hidden = eng !== 'api';
  $('#chat-field').hidden = eng === 'api';
  $('#chat-site').value = S.settings.chatSite;
  if (!$('#chat-site').value) $('#chat-site').value = 'claude'; // unknown stored value
  if (document.activeElement !== $('#key')) $('#key').value = S.settings.apiKey;
  $('#model').value = S.settings.model;
  $('#effort').value = S.settings.effort;
}

// ---------- wiring ----------
function wire() {
  $('#back').addEventListener('click', goBack);
  $('#open-settings').addEventListener('click', openSettings);
  $('#hint-settings').addEventListener('click', openSettings);
  window.addEventListener('scroll', () => $('#top').classList.toggle('scrolled', window.scrollY > 2), { passive: true });

  // resume
  const file = $('#file');
  $('#choose').addEventListener('click', () => file.click());
  $('#resume-replace').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    handleFile(file.files[0]);
    file.value = '';
  });
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handleFile(e.dataTransfer.files[0]);
  });
  for (const ev of ['dragover', 'drop']) document.addEventListener(ev, (e) => e.preventDefault());
  $('#paste-toggle').addEventListener('click', (e) => {
    const box = $('#paste-box');
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) $('#paste').focus();
  });
  $('#paste-save').addEventListener('click', () => {
    const text = $('#paste').value.trim();
    if (text.length < 50) return showErr('#resume-error', 'Paste the full text of your resume.');
    useResume({ name: 'Pasted resume', kind: 'txt', size: new Blob([text]).size, text, addedAt: Date.now() });
    $('#paste').value = '';
    $('#paste-box').hidden = true;
  });
  $('#resume-remove').addEventListener('click', async () => {
    await store.removeResume();
    S.resume = null;
    renderResume();
    toast('Resume removed');
  });

  // scoring
  $('#start').addEventListener('click', startScoring);
  $('#view-last').addEventListener('click', () => {
    renderResults();
    show('results');
  });
  $('#cancel').addEventListener('click', () => S.abort?.abort());
  $('#apply').addEventListener('click', openApply);
  $('#save').addEventListener('click', toggleSave);
  downloadMenu($('#dl-results'), () => {
    const [company, role] = jobNames();
    return { text: reportText(S.entry.result, { url: S.entry.meta.url, scoredAt: S.entry.scoredAt }), title: `Fit report - ${role}`, base: fileBase(company, role, 'Fit Report') };
  });

  // apply
  $('#gen-both').addEventListener('click', () => generate('both'));
  $('#gen-one').addEventListener('click', () => generate(document.querySelector('input[name="one"]:checked').value));
  $('#apply-back').addEventListener('click', () => show('results'));

  // generated
  $('#gen-text').addEventListener('input', (e) => (S.gen[S.genTab] = e.target.value));
  const tabs = [...document.querySelectorAll('#gen-tabs [role="tab"]')];
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      S.genTab = t.dataset.doc;
      renderGenerated();
    })
  );
  $('#gen-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    S.genTab = S.genTab === 'resume' ? 'cover_letter' : 'resume';
    renderGenerated();
    tabs.find((t) => t.dataset.doc === S.genTab).focus();
  });
  $('#gen-copy').addEventListener('click', () => copyText($('#gen-text').value));
  $('#gen-back').addEventListener('click', () => show('results'));
  downloadMenu($('#dl-gen'), () => {
    const [company, role] = jobNames();
    const kind = S.genTab === 'resume' ? 'Resume' : 'Cover Letter';
    return { text: $('#gen-text').value, title: `${kind} - ${role}`, base: fileBase(company, role, kind) };
  });

  // settings
  let keyTimer;
  $('#key').addEventListener('input', (e) => {
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => saveSetting('apiKey', e.target.value.trim()), 400);
  });
  $('#key-show').addEventListener('click', (e) => {
    const input = $('#key');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    e.currentTarget.textContent = showing ? 'Show' : 'Hide';
    e.currentTarget.setAttribute('aria-pressed', String(!showing));
  });
  $('#engine').addEventListener('change', async (e) => {
    await saveSetting('engine', e.target.value);
    fillSettings();
  });
  $('#chat-site').addEventListener('change', (e) => saveSetting('chatSite', e.target.value));
  $('#model').addEventListener('change', (e) => saveSetting('model', e.target.value));
  $('#effort').addEventListener('change', (e) => saveSetting('effort', e.target.value));
  $('#settings-done').addEventListener('click', goBack);

  // paste the AI reply
  $('#paste-go').addEventListener('click', usePaste);
  $('#paste-copy').addEventListener('click', async () => {
    if (S.handoff) $('#prompt-box').hidden = await copyText(S.handoff.prompt, 'Prompt copied');
  });
  $('#paste-open').addEventListener('click', openChat);
  $('#paste-cancel').addEventListener('click', goBack);
  $('#prompt-select').addEventListener('click', () => {
    const t = $('#prompt-text');
    t.focus();
    t.select();
  });
}

// Keep this panel in step with panels in other windows.
function onStorageChange(changes, area) {
  if (area === 'local') {
    const keys = ['engine', 'chatSite', 'apiKey', 'model', 'effort'].filter((k) => changes[k]);
    for (const k of keys) S.settings[k] = changes[k].newValue ?? store.DEFAULTS[k];
    if (keys.length) {
      fillSettings();
      updateStart();
    }
    if (changes.resume) {
      S.resume = changes.resume.newValue || null;
      renderResume();
    }
    if (changes.savedJobs) {
      S.saved = changes.savedJobs.newValue || [];
      renderSaved();
      if (S.entry) updateSaveBtn();
    }
  }
}

// Re-read the page when this window's active tab changes or navigates (SPA URL changes included).
// The main view only: other views keep the job they are working on. show('main') re-reads anyway.
let readTimers = [];
function queueRead(delays) {
  readTimers.forEach(clearTimeout);
  readTimers = delays.map((ms) => setTimeout(() => S.view === 'main' && refreshPage(), ms));
}

function watchTabs() {
  chrome.tabs.onActivated.addListener(({ windowId }) => windowId === S.windowId && queueRead([50]));
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (tab.windowId !== S.windowId || !tab.active) return;
    // Read soon, then again as SPA content settles: the LinkedIn job pane fills 3-9 s after
    // the URL changes, with no further tab event. Each event restarts the timers.
    if (info.url || info.status === 'complete' || info.title) queueRead([300, 1500, 4000, 8000]);
  });
}

async function init() {
  S.windowId = (await chrome.windows.getCurrent()).id;
  wire();
  [S.settings, S.resume, S.saved] = await Promise.all([store.getSettings(), store.getResume(), store.getSaved()]);
  chrome.storage.onChanged.addListener(onStorageChange);
  fillSettings();
  renderResume();
  renderSaved();
  backfillPdfText();
  await refreshPage();
  if (S.entry && S.page && S.entry.meta.key === S.page.key) {
    renderResults();
    show('results');
  }
  watchTabs();
}

init();
