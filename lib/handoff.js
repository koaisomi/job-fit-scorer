// Free "paste into your AI chat" engine: build one prompt, parse the reply the user pastes back.
// Pure functions (no DOM, no chrome), so they run in node for tests.
import { SCORE_SYSTEM, SCORE_SCHEMA, GEN_SYSTEM, escTags, pageBlock, scoringBlock, today } from './prompts.js';

export const CHATS = {
  claude: { label: 'claude.ai', url: 'https://claude.ai/new' },
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/' },
  gemini: { label: 'Gemini', url: 'https://gemini.google.com/app' },
};
export const chatOf = (id) => CHATS[id] || CHATS.claude;

// ---------- prompts ----------
// JSON schema -> example object: "<note>" for text, "a | b" for enums.
function example(s) {
  if (s.type === 'object') return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, example(v)]));
  if (s.type === 'array') return [s.items.type === 'string' ? `<${s.description || 'text'}>` : example(s.items)];
  if (s.enum) return s.enum.join(' | ');
  if (s.type === 'integer') return `<integer${s.description ? ': ' + s.description : ''}>`;
  return s.description ? `<${s.description}>` : '<text>';
}

// The selection, when there is one, replaces the full page text to keep the prompt short.
const handoffPage = (page) => pageBlock({ ...page, text: page.selectionText ? '(see selected_text)' : page.text });
const resumeBlock = (text) => `<resume>\n${escTags(text)}\n</resume>`;

export function scorePrompt(resumeText, page) {
  return `${SCORE_SYSTEM}

Output format
Reply with only one \`\`\`json code block and nothing else. Use exactly this JSON shape and these keys. Text in <angle brackets> describes the value to write; "a | b" means pick one of the options. Scores are plain integers from 0 to 100, not strings.
\`\`\`json
${JSON.stringify(example(SCORE_SCHEMA), null, 1)}
\`\`\`

${handoffPage(page)}

${resumeBlock(resumeText)}

Today is ${today()}. Score this candidate for the job posting above. Reply with only one \`\`\`json code block.`;
}

export const MARK = { resume: '=== RESUME ===', cover_letter: '=== COVER LETTER ===' };

export function genPrompt(resumeText, page, result, want) {
  const docs = want === 'both' ? ['resume', 'cover_letter'] : [want];
  const ask = want === 'both' ? 'Write both the targeted resume and the cover letter.' : want === 'resume' ? 'Write the targeted resume only.' : 'Write the cover letter only.';
  const system = GEN_SYSTEM.replace(/\n+Return an empty string[^\n]*$/, '');
  return `${system}

Output format
Reply in plain text: no markdown, no code block, no notes before or after. Start ${docs.length > 1 ? 'each document' : 'the document'} with this exact marker line on its own line:
${docs.map((d) => MARK[d]).join('\n')}

${handoffPage(page)}

${resumeBlock(resumeText)}

${scoringBlock(result)}

Today is ${today()}. ${ask} Use the exact marker line${docs.length > 1 ? 's' : ''}: ${docs.map((d) => MARK[d]).join(' and ')}.`;
}

// ---------- reply parsing ----------
export const TIP = 'Tip: ask the chat "Reply with only the JSON code block", then copy the whole reply again.';

export function parseScoreReply(text) {
  let s = String(text || '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].includes('{')) s = fence[1];
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error(`No JSON found in the reply. ${TIP}`);
  const raw = s.slice(a, b + 1);
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    try {
      obj = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); // trailing commas, a common chat slip
    } catch {
      throw new Error(`The reply is not complete, valid JSON. ${TIP}`);
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || (!obj.fit && !obj.job)) throw new Error(`The reply does not look like a scoring result. ${TIP}`);
  return normalizeResult(obj);
}

export function parseGenReply(text, want) {
  const s = String(text || '').replace(/\r\n?/g, '\n').replace(/^\s*```[\w-]*\s*$/gm, '').trim();
  const r = s.match(/^[\s*#_]*={2,}\s*RESUME\s*={2,}[\s*_]*$/im);
  const c = s.match(/^[\s*#_]*={2,}\s*COVER\s+LETTER\s*={2,}[\s*_]*$/im);
  const cut = (m, other) => (m ? s.slice(m.index + m[0].length, other && other.index > m.index ? other.index : s.length).trim() : '');
  let resume = cut(r, c);
  let cover = cut(c, r);
  if (!r && !c && want !== 'both') want === 'resume' ? (resume = s) : (cover = s);
  if (want === 'resume') cover = '';
  if (want === 'cover_letter') resume = '';
  if (!resume && !cover) {
    throw new Error(s ? `Could not find the ${MARK.resume} and ${MARK.cover_letter} lines. Tip: ask the chat to use those exact marker lines, then copy the reply again.` : 'Paste the reply first.');
  }
  return { resume, cover_letter: cover };
}

// ---------- normalising (all engines) ----------
const VERDICTS = ['Strong fit', 'Good fit', 'Partial fit', 'Weak fit', 'Not a fit'];
export const verdictFor = (n) => (n >= 85 ? 'Strong fit' : n >= 70 ? 'Good fit' : n >= 50 ? 'Partial fit' : n >= 30 ? 'Weak fit' : 'Not a fit');
export const clampScore = (n, d = 0) => {
  const x = typeof n === 'string' ? parseFloat(n) : Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : d;
};
const o = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const txt = (v, d = 'Not stated') => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : d);
const strs = (v) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? Object.values(x).join(': ') : String(x ?? '')))
    .map((x) => x.trim())
    .filter(Boolean);
const JOB_KEYS = ['title', 'company', 'location', 'salary', 'employment_type', 'work_setup', 'posted', 'rating', 'reviews', 'industry'];

// Missing or odd fields get safe defaults so rendering never crashes.
export function normalizeResult(input) {
  const r = o(input);
  const j = o(r.job);
  const f = o(r.fit);
  const l = o(r.legitimacy);
  const score = clampScore(f.score);
  const lv = String(l.verdict || '').trim().toLowerCase();
  return {
    job: Object.fromEntries(JOB_KEYS.map((k) => [k, txt(j[k])])),
    fit: { score, verdict: VERDICTS.find((v) => v.toLowerCase() === String(f.verdict || '').trim().toLowerCase()) || verdictFor(score), summary: txt(f.summary, '') },
    breakdown: (Array.isArray(r.breakdown) ? r.breakdown : []).map(o).map((b) => ({ category: txt(b.category, 'Other'), score: clampScore(b.score), notes: txt(b.notes, '') })),
    matched_strengths: strs(r.matched_strengths),
    gaps: strs(r.gaps),
    improvements: strs(r.improvements),
    resume_suggestions: (Array.isArray(r.resume_suggestions) ? r.resume_suggestions : [])
      .map((s) => (typeof s === 'string' ? { section: 'Resume', text: s.trim() } : { section: txt(o(s).section, 'Resume'), text: txt(o(s).text, '') }))
      .filter((s) => s.text),
    ats_keywords_missing: strs(r.ats_keywords_missing),
    legitimacy: {
      verdict: ['legit', 'caution', 'suspicious'].includes(lv) ? lv : 'caution',
      score: clampScore(l.score, 50),
      green_flags: strs(l.green_flags),
      red_flags: strs(l.red_flags),
      missing_info: strs(l.missing_info),
      advice: txt(l.advice, ''),
    },
  };
}
