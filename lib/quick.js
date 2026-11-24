// Free "Quick check" engine: keyword, years, education and red-flag rules. No AI, no network.
// Pure functions (no DOM, no chrome), so they run in node for tests.
// Output has the same shape as the Claude API result.
import { verdictFor, normalizeResult } from './handoff.js';

// ---------- dictionary: "canonical|variant|variant" ----------
const HARD = `customer service|customer support|customer care|client service|client support
call center|call centre|contact center|contact centre|bpo
inbound calls|inbound
outbound calls|outbound
voice account|voice support|voice process
non-voice|non voice|chat support|email support
technical support|tech support|helpdesk|help desk|service desk
troubleshooting|troubleshoot
customer satisfaction|csat
net promoter score|nps
average handle time|aht
first call resolution|fcr
kpi|kpis|key performance indicators
sla|service level agreement
escalations|escalation|escalate
ticketing|ticket management|support tickets
complaint handling|handle complaints|complaints
order processing
billing|billing inquiries
collections|debt collection
data entry|encoding|encoder|data encoder
typing speed|wpm|words per minute
healthcare|health care|healthcare account
medical terminology
claims processing|insurance claims
hipaa
medical billing
medical coding
prior authorization
pharmacy
financial services|finance account
banking
accounts payable
accounts receivable
bookkeeping|bookkeeper
accounting
payroll
reconciliation|bank reconciliation
quickbooks|quickbooks online
xero
invoicing|invoices
financial reporting
virtual assistant|virtual assistance|va
administrative support|admin support|administrative tasks|admin tasks|administrative assistant
executive assistant
calendar management|calendar|appointment scheduling|meeting scheduling
appointment setting|appointment setter|book appointments
email management|inbox management
travel booking|travel arrangements
file management|document management
transcription
internet research|online research|research
lead generation|lead gen|prospecting
cold calling|cold calls
data management
project management|project coordination|project coordinator
asana
trello
monday.com
clickup
notion
slack
microsoft teams|ms teams
zoom
google workspace|g suite|gsuite|google suite
google docs
google sheets
google drive
microsoft office|ms office|microsoft 365|office 365
excel|ms excel|microsoft excel|advanced excel
ms word|microsoft word
powerpoint|ms powerpoint
outlook|ms outlook
social media management|social media manager|smm
social media marketing|social media
content creation|content creator
content writing|content writer
copywriting|copywriter
seo|search engine optimization
search engine marketing|sem
ppc|pay per click
google ads|adwords
facebook ads|meta ads|fb ads
email marketing
mailchimp
klaviyo
digital marketing
marketing automation
content strategy
community management
influencer marketing
google analytics|ga4|analytics
wordpress
shopify
ecommerce|e-commerce
amazon seller central|amazon fba
etsy
landing pages|landing page
sales funnels|sales funnel|funnel building|funnels
clickfunnels
gohighlevel|go high level|highlevel|ghl
crm|customer relationship management
hubspot
salesforce
zoho|zoho crm
pipedrive
activecampaign|active campaign
keap|infusionsoft
zapier
make.com|integromat
n8n
workflow automation|automations|automation|workflows
api|apis|rest api
webhooks|webhook
airtable
calendly
twilio
sms marketing
sales
b2b|b2b sales
b2c
inside sales
account management|account manager
sales closing|closer|closing deals
upselling|upsell|cross selling|cross-selling
sales pipeline|pipeline management
real estate
telemarketing|telesales
javascript|js
typescript
python
java
php
html
css
react|reactjs|react.js
node.js|nodejs
sql|mysql|postgresql
vba|excel vba
git|github
aws|amazon web services
azure
linux
network administration|networking
windows
active directory
cybersecurity|information security
quality assurance|software testing|qa testing|qa
cloud computing|cloud
power bi|powerbi
tableau
data analysis|data analytics|analyze data
machine learning
chatgpt|ai tools|generative ai
graphic design|graphic designer
canva
photoshop|adobe photoshop
illustrator|adobe illustrator
adobe creative suite|adobe creative cloud
figma
video editing|video editor
premiere pro|adobe premiere
after effects
capcut
ui design|ux design|ui/ux|ux
branding
zendesk
freshdesk
intercom
gorgias
help scout
english|english communication|fluent english|english proficiency
written communication|writing skills|written english
verbal communication|oral communication|spoken english
human resources
recruitment|recruiting|talent acquisition|sourcing
onboarding
logistics
supply chain
inventory management|inventory
procurement|purchasing
dispatch|dispatching
property management
tutoring|esl|english tutor|teaching`;

const SOFT = `communication skills|communication|communicate
problem solving|problem-solving|solve problems
attention to detail|detail oriented|detail-oriented|eye for detail
time management
multitasking|multi-tasking|multitask
teamwork|team player|collaboration|collaborate
leadership|team lead|team leader
customer focus|customer-centric|customer oriented
empathy|empathetic
patience
adaptability|adaptable
self-motivated|self motivated|self-starter|proactive
organizational skills|organization skills|organized
critical thinking
decision making
interpersonal skills
active listening|listening skills
work under pressure|under pressure|fast-paced|fast paced
reliability|reliable|dependable
integrity|honesty
creativity|creative thinking
analytical skills|analytical
negotiation|negotiation skills
conflict resolution|de-escalation|resolve conflicts
professionalism
willing to learn|eager to learn|fast learner|quick learner|coachable
positive attitude
work independently|minimal supervision`;

// ---------- text helpers ----------
// Simple stemmer: one form for manage/managed/managing/manages, plan/planning, process/processes.
// Words whose -ing form is the skill itself (accounting is not account, banking is not bank).
const NOSTEM = new Set(['accounting', 'banking', 'marketing', 'networking', 'branding', 'billing', 'ticketing', 'encoding']);
export function stem(w) {
  if (NOSTEM.has(w)) return w;
  let s = w;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && /(ss|x|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s !== w && /([bdgmnprt])\1$/.test(s)) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}
const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9+#./]+/g, ' ')
    .replace(/[./](?=\s|$)|(^|\s)[./]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
export const norm = (s) => ' ' + words(s).map(stem).join(' ') + ' ';

// Display names: acronyms in caps, brand casing, otherwise Title Case.
const ACR = new Set('bpo csat nps aht fcr kpi kpis sla crm seo sem ppc smm ga4 ghl api apis b2b b2c qa ux ui/ux js php html css sql vba aws hipaa wpm va esl n8n'.split(' '));
const BRAND = { gohighlevel: 'GoHighLevel', hubspot: 'HubSpot', quickbooks: 'QuickBooks', activecampaign: 'ActiveCampaign', clickup: 'ClickUp', clickfunnels: 'ClickFunnels', wordpress: 'WordPress', javascript: 'JavaScript', typescript: 'TypeScript', 'node.js': 'Node.js', 'monday.com': 'monday.com', 'make.com': 'Make.com', 'power bi': 'Power BI', chatgpt: 'ChatGPT', 'ms word': 'MS Word', ecommerce: 'E-commerce', n8n: 'n8n', capcut: 'CapCut', 'help scout': 'Help Scout' };
const SMALL = new Set(['and', 'of', 'to', 'for', 'in', 'on', 'with']);
export const display = (label) =>
  BRAND[label] || label.split(' ').map((w, i) => (ACR.has(w) ? w.toUpperCase() : i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

const dict = (src, soft) =>
  src.split('\n').map((line) => {
    const [label, ...rest] = line.split('|');
    return { label: display(label), soft, forms: [...new Set([label, ...rest].map((v) => norm(v)))] };
  });
export const DICT = [...dict(HARD, false), ...dict(SOFT, true)];
const has = (n, term) => term.forms.some((f) => n.includes(f));

const STOP = new Set(
  `a an the and or of to in on for with at by from as is are be been being this that these those it its our your you we they their will can may must should would could not no all any each other such than then into over under about up out more most very also etc per via using use used able ability strong good great excellent well new work working job role position team company candidate candidates applicant applicants experience year years month months day days time including include includes required require requirement requirements preferred plus least minimum skill skills knowledge understanding responsibilities responsible duties qualifications benefits apply application please who what which when where how have has had do does did get make ensure provide support within across like one two three per hour week`
    .split(' ')
    .map(stem)
);

// ---------- job page ----------
function jsonLdJob(page) {
  try {
    const list = JSON.parse(page.jsonLd || '[]');
    return (Array.isArray(list) ? list : [list]).find((x) => x && typeof x === 'object') || null;
  } catch {
    return null; // shortcut: jsonLd is cut at 15000 chars by content.js; a cut blob is skipped
  }
}
const stripHtml = (s) =>
  String(s || '')
    .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n\s*/g, '\n')
    .trim();

const TAIL = /\n(?:similar jobs|more jobs (?:like this|from)|people also (?:viewed|searched)|recommended (?:jobs|for you)|jobs you may (?:like|be interested)|you may also like|related jobs|be careful\b|report this job)/i;

function cleanTitle(t) {
  const parts = String(t || '').split(/\s+[|–—-]\s+/);
  if (parts.length > 1) parts.pop(); // site name
  return parts.join(' - ').replace(/\s+jobs? in\s.+$/i, '').trim();
}

// The main job text: selection, else JSON-LD description, else the page text from the title to the "similar jobs" tail.
function jobText(page, ld, title) {
  if (page.selectionText) return page.selectionText;
  if (ld?.description) return stripHtml(ld.description);
  let t = String(page.text || '');
  const i = title ? t.indexOf('\n' + title) : -1;
  if (i >= 0) t = t.slice(i + 1);
  const m = t.slice(300).match(TAIL);
  if (m) t = t.slice(0, 300 + m.index);
  return t;
}

const EMP = [
  [/full[\s-]?time|full_time/i, 'Full time'],
  [/part[\s-]?time|part_time/i, 'Part time'],
  [/contract\s*\/\s*temp|\bcontract(?:ual|or)?\b|\btemporary\b|\btemp\b/i, 'Contract/Temp'],
  [/\bfreelance\b|project[\s-]based/i, 'Freelance'],
  [/\bintern(?:ship)?\b/i, 'Internship'],
];
const SETUP = [
  [/\bhybrid\b/i, 'Hybrid'],
  [/\bremote\b|work from home|\bwfh\b|telecommute/i, 'Remote'],
  [/\bon[\s-]?site\b|office[\s-]based|\bin[\s-]office\b|work from office|\bwfo\b/i, 'On-site'],
];
const firstOf = (list, s) => list.find(([re]) => re.test(s))?.[1] || 'Not stated';

const MONEY = String.raw`(?:₱|PHP|Php|USD|US\$|\$|P(?=\s?\d{1,3}(?:,\d{3})))\s?\d[\d,]*(?:\.\d+)?\s?[kK]?`;
const SALARY = new RegExp(
  String.raw`${MONEY}(?:\s*(?:-|–|to)\s*(?:${MONEY}|\d[\d,]*(?:\.\d+)?\s?[kK]?))?(?:\s*(?:per|\/|a)\s*(?:hour|hr|month|mo|year|yr|annum|day|week))?` +
    String.raw`|\b\d{1,3}(?:,\d{3})+\s*(?:-|–|to)\s*\d{1,3}(?:,\d{3})+\s*(?:per|\/|a)\s*(?:month|mo|year|yr|hour|hr|day|week)\b`
);

function ldLocation(ld) {
  if (/telecommute/i.test(String(ld?.jobLocationType || ''))) return 'Remote';
  const locs = [].concat(ld?.jobLocation || []);
  const out = locs
    .map((l) => {
      const a = l?.address || {};
      return typeof a === 'string' ? a : [a.streetAddress, a.addressLocality, a.addressRegion, a.addressCountry?.name || a.addressCountry].filter((x) => typeof x === 'string' && x).join(', ');
    })
    .filter(Boolean);
  return out.join('; ');
}
function ldSalary(ld) {
  const b = ld?.baseSalary;
  if (!b) return '';
  const v = b.value || {};
  const cur = b.currency || v.currency || '';
  const n = (x) => (Number(x) ? Number(x).toLocaleString('en-US') : '');
  const range = v.minValue || v.maxValue ? [n(v.minValue), n(v.maxValue)].filter(Boolean).join(' - ') : n(v.value ?? (typeof v === 'number' ? v : ''));
  if (!range) return '';
  return `${cur} ${range}${v.unitText ? ' per ' + String(v.unitText).toLowerCase() : ''}`.trim();
}
const EMP_LD = { FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACTOR: 'Contract/Temp', TEMPORARY: 'Contract/Temp', INTERN: 'Internship', PER_DIEM: 'Contract/Temp' };

function ago(iso, now) {
  const t = Date.parse(iso);
  if (!t) return '';
  const d = Math.floor((now - t) / 864e5);
  return d <= 0 ? 'Posted today' : d === 1 ? 'Posted 1 day ago' : d < 60 ? `Posted ${d} days ago` : `Posted ${new Date(t).toISOString().slice(0, 10)}`;
}

const PLACE = /\b(city|metro manila|manila|cebu|davao|makati|taguig|pasig|quezon|ortigas|bgc|alabang|pampanga|cavite|laguna|iloilo|bacolod|philippines|province|remote)\b/i;

// Job facts: JSON-LD first, then heuristics on the page text.
export function jobMeta(page, now = Date.now()) {
  const ld = jsonLdJob(page);
  const title = (typeof ld?.title === 'string' && ld.title.trim()) || cleanTitle(page.title) || 'Not stated';
  const text = jobText(page, ld, title);
  const all = String(page.text || '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const top = lines.slice(0, 15);
  const org = ld?.hiringOrganization;
  let company = (typeof org === 'string' ? org : org?.name) || '';
  if (!company) {
    const i = top.findIndex((l) => l === title);
    const next = i >= 0 ? top[i + 1] : '';
    const orgLike = /\b(inc|corp|corporation|ltd|llc|co|company|solutions|services|group|technologies|outsourcing|bpo)\b\.?/i.test(next);
    if (next && next.length < 80 && (orgLike || !PLACE.test(next)) && !SALARY.test(next) && !/^[\d.·•|\s]+$|reviews?|posted|updated|apply|save/i.test(next)) company = next;
    else company = String(page.title || '').match(/\bat\s+([^|–—-]{2,60})/i)?.[1]?.trim() || '';
  }
  const rating = all.match(/\b([1-5]\.\d)\s*(?:★|stars?)?\s*[·•|(]?\s*\n?\s*[·•|]?\s*\(?\s*([\d,.]+k?)\s*reviews?\b/i);
  const loc = ldLocation(ld) || top.find((l) => l.length < 80 && l !== company && l !== title && PLACE.test(l) && !SALARY.test(l)) || '';
  const emp = [].concat(ld?.employmentType || []).map((e) => EMP_LD[String(e).toUpperCase()] || String(e)).join(', ');
  const posted = (ld?.datePosted && ago(ld.datePosted, now)) || all.match(/\b(?:posted\s+(?:on\s+)?[^\n]{1,25}?\s+ago|posted\s+(?:today|yesterday)|just posted|updated\s+[a-z]{3,9}\.?\s\d{1,2},?\s\d{4}|\d+\+?\s*(?:minutes?|hours?|days?|weeks?|months?)\s+ago)\b/i)?.[0] || '';
  return {
    text,
    hasLd: !!ld,
    job: {
      title,
      company: company.trim() || 'Not stated',
      location: loc.trim() || 'Not stated',
      salary: ldSalary(ld) || text.match(SALARY)?.[0]?.trim() || 'Not stated',
      employment_type: emp || [top.join('\n'), text].map((s) => firstOf(EMP, s)).find((v) => v !== 'Not stated') || 'Not stated',
      work_setup: /telecommute/i.test(String(ld?.jobLocationType || '')) ? 'Remote' : firstOf(SETUP, `${title}\n${text}`),
      posted: posted ? posted.replace(/^./, (c) => c.toUpperCase()) : 'Not stated',
      rating: rating ? rating[1] : 'Not stated',
      reviews: rating ? `${rating[2]} reviews` : 'Not stated',
      industry: (typeof ld?.industry === 'string' && ld.industry) || 'Not stated',
    },
  };
}

// ---------- sections ----------
const HEAD_REQ = /^(?:job\s+|minimum\s+|preferred\s+|basic\s+)?(?:qualifications?|requirements?|what we(?:'| a)re looking for|what you need|what you(?:'ll| will)? bring|who you are|must[- ]haves?|about you|(?:the\s+)?ideal candidate|skills(?:\s*(?:and|&)\s*(?:experience|qualifications))?|experience(?:\s*(?:and|&)\s*skills)?)\b/i;
const HEAD_RESP = /^(?:key\s+|main\s+|job\s+|your\s+)?(?:responsibilities|duties|what you(?:'ll| will) do|(?:the|your) role|role overview|job description|about the (?:role|job)|day[- ]to[- ]day|job summary)\b/i;
const HEAD_BEN = /^(?:benefits|perks|what we offer|why (?:join|work)|compensation|we offer)\b/i;
const W = { req: 2, resp: 1.2, other: 1, ben: 0 };

export function sections(text) {
  let cur = 'other';
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.length <= 60 || /^[^:]{3,40}:/.test(line);
    const kind = head && (HEAD_REQ.test(line) ? 'req' : HEAD_RESP.test(line) ? 'resp' : HEAD_BEN.test(line) ? 'ben' : null);
    if (kind) {
      cur = kind;
      const rest = line.replace(/^[^:]*:\s*/, '');
      if (rest !== line && rest) out.push({ kind, line: rest });
      continue;
    }
    out.push({ kind: cur, line });
  }
  return out;
}

// ---------- keywords ----------
// Dictionary terms plus 1-3 word phrases that repeat in requirement/duty lines.
export function jobKeywords(text) {
  const secs = sections(text);
  const hasSecs = secs.some((s) => s.kind === 'req' || s.kind === 'resp');
  const terms = new Map(); // label -> { label, weight, soft, forms }
  const add = (term, kind) => {
    const w = W[kind];
    if (!w) return;
    const t = terms.get(term.label);
    if (!t) terms.set(term.label, { ...term, weight: w });
    else t.weight = Math.max(t.weight, w);
  };
  for (const s of secs) {
    const n = norm(s.line);
    for (const term of DICT) if (has(n, term)) add(term, s.kind);
  }
  // Drop a term when a longer found term already covers it ("sales" inside "inside sales").
  for (const a of [...terms.values()]) {
    for (const b of terms.values()) if (a !== b && b.forms[0].includes(a.forms[0]) && b.weight >= a.weight) terms.delete(a.label);
  }
  const counts = new Map();
  for (const s of secs) {
    if (hasSecs ? s.kind !== 'req' && s.kind !== 'resp' : false) continue;
    const raw = words(s.line);
    const st = raw.map(stem);
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= st.length; i++) {
        const g = st.slice(i, i + n);
        if (STOP.has(g[0]) || STOP.has(g[n - 1]) || g.some((x) => x.length < 3 || /^\d/.test(x))) continue;
        const key = ' ' + g.join(' ') + ' ';
        const c = counts.get(key) || { label: raw.slice(i, i + n).join(' '), n: 0, weight: 0 };
        c.n++;
        c.weight = Math.max(c.weight, W[s.kind]);
        counts.set(key, c);
      }
    }
  }
  const rank = ([key, c]) => c.n * (c.weight || 1) * key.trim().split(' ').length;
  const covered = (key) => [...terms.values()].some((t) => t.forms.some((f) => f.includes(key) || key.includes(f)));
  const phrases = [...counts.entries()]
    .filter(([key, c]) => c.n >= (key.trim().includes(' ') ? 2 : 4) && !covered(key))
    .sort((a, b) => rank(b) - rank(a));
  const picked = [];
  for (const [key, c] of phrases) {
    if (picked.length >= 8) break;
    if (picked.some((p) => p.forms[0].includes(key) || key.includes(p.forms[0]))) continue;
    picked.push({ label: c.label.charAt(0).toUpperCase() + c.label.slice(1), soft: false, phrase: true, weight: c.weight || 1, forms: [key] });
  }
  return { terms: [...terms.values(), ...picked].sort((a, b) => b.weight - a.weight), hasSecs };
}

// ---------- years and education ----------
export function jobYears(text) {
  const t = String(text).toLowerCase();
  if (/\b(no (?:prior |work )?experience (?:is )?(?:required|needed|necessary)|without experience|fresh graduates?(?: are)? (?:welcome|accepted)|no experience)\b/.test(t)) return 0;
  const m = t.match(/(\d{1,2})\s*(?:\+|plus)?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\b[^.\n]{0,50}?experience|experience[^.\n]{0,30}?(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)\b/);
  return m ? Number(m[1] || m[2]) : null;
}

export function resumeYears(text, now = new Date()) {
  const t = String(text).toLowerCase();
  const cy = now.getFullYear();
  const spans = [...t.matchAll(/\b((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|now|today)\b/g)]
    .map((m) => [Number(m[1]), /^\d/.test(m[2]) ? Number(m[2]) : cy])
    .filter(([a, b]) => b >= a && a <= cy)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of spans) {
    const s = Math.max(a, end);
    if (b > s) total += b - s;
    end = Math.max(end, b);
  }
  const claim = Math.max(0, ...[...t.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:\w+\s+){0,3}experience/g)].map((m) => Number(m[1])));
  return Math.max(total, claim);
}

const EDU = [
  [5, /\b(ph\.?\s?d|doctorate|doctoral)\b/],
  [4, /\b(master'?s?|mba|m\.s\.|post[\s-]?graduate)\b/],
  [3, /\b(bachelor'?s?|college graduate|college degree|university degree|degree holder|bs[a-z]{0,4}\b|b\.s\.|a\.b\.|\d-year course)\b/],
  [2, /\b(college level|college undergrad(?:uate)?|undergraduate|associate'?s?(?: degree)?|vocational|tesda|\d years? (?:of )?college|some college)\b/],
  [1, /\b(high school|senior high|shs|k-?12|grade 12|secondary)\b/],
];
const EDU_NAME = { 1: 'senior high or high school', 2: 'college level or vocational', 3: "a bachelor's degree", 4: "a master's degree", 5: 'a doctorate' };
export function eduLevels(text) {
  const t = String(text).toLowerCase();
  return EDU.filter(([, re]) => re.test(t)).map(([n]) => n);
}

// ---------- legitimacy ----------
const BOARDS = /(^|\.)(jobstreet|linkedin|indeed|onlinejobs|upwork|kalibrr|glassdoor|jora|bossjob|foundit|monster|ziprecruiter|workable|greenhouse|lever|smartrecruiters|myworkdayjobs|seek|jobsdb|careerjet|wellfound)\./i;

// Monthly pay in PHP from a salary string, for the "too good to be true" rule.
export function monthlyPhp(s) {
  const t = String(s || '').toLowerCase();
  const nums = [...t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?/g)].map((m) => parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)).filter((n) => n > 0);
  if (!nums.length) return 0;
  let v = Math.max(...nums);
  if (/usd|\$/.test(t)) v *= 56;
  if (/hour|hr\b/.test(t)) v *= 160;
  else if (/\bday\b/.test(t)) v *= 22;
  else if (/week/.test(t)) v *= 4.3;
  else if (/year|yr|annum/.test(t)) v /= 12;
  return v;
}

const sentences = (s) => String(s).split(/(?<=[.!?])\s+|\n+/);
const unless = /\b(don'?t|do not|never|careful|scam|fraud|will not|won'?t)\b/i;

export function legitimacy(page, meta, secs) {
  const text = meta.text;
  const all = String(page.text || '');
  const j = meta.job;
  const red = [];
  const green = [];
  const missing = [];
  const said = (re, s = text) => sentences(s).some((x) => re.test(x) && !unless.test(x));
  if (said(/\b(?:training|registration|processing|placement|application|starter kit|onboarding|reservation|membership)\s+fees?\b|\bpay(?:ment)?\s+(?:a\s+)?(?:small\s+)?(?:fee|deposit)\b|\b(?:refundable\s+)?deposit\s+of\b|\bpay to (?:apply|start|join)\b|\bfee of\b/i)) red.push('Asks you to pay a fee or deposit');
  if (said(/t\.me\/|wa\.me\/|(?:contact|message|msg|chat|add|reach|text|dm|apply|send)[^.\n]{0,40}\b(?:telegram|whatsapp|viber)\b|\b(?:telegram|whatsapp|viber)\b[^.\n]{0,25}(?:\+?\d[\d\s-]{6,}|@\w+)/i)) red.push('Contact only through a chat app (Telegram, WhatsApp or Viber)');
  const mail = text.match(/[\w.+-]+@(gmail|yahoo|ymail|outlook|hotmail|live|aol|icloud)\.com/i);
  if (mail) red.push(`Contact uses a personal email address (${mail[1].toLowerCase()}.com)`);
  const noExp = jobYears(text) === 0;
  if (noExp && known(j.salary) && monthlyPhp(j.salary) > 80000) red.push(`Pay (${j.salary}) is far above normal for a role that needs no experience`);
  const hasSecs = secs.some((s) => s.kind === 'req') && secs.some((s) => s.kind === 'resp');
  const urgent = /\b(urgent(?:ly)? hiring|urgent|start (?:today|immediately|asap)|immediate start|limited slots?|slots? (?:are )?limited|hiring now|apply (?:now|today) before)\b/i.test(text);
  if (urgent && (!hasSecs || text.length < 800)) red.push('Urgency pressure ("urgent hiring", "limited slots") with vague duties');
  if (said(/\b(?:send|provide|submit|share|give)\b[^.\n]{0,40}\b(?:bank (?:account|details)|gcash|paymaya|maya account|credit card|valid id|government id|id (?:photo|picture)|sss (?:number|no)|tin (?:number|no)|otp)\b/i)) red.push('Asks for bank, GCash or ID details early');
  if (text.trim().length < 400) red.push('Very short job description');
  if (!known(j.company)) red.push('No company name');

  if (known(j.company)) green.push(`Company named: ${j.company}`);
  if (/\bverified\b/i.test(all)) green.push('Verified badge shown on the page');
  if (known(j.rating)) green.push(`Company rating ${j.rating}${known(j.reviews) ? ` from ${j.reviews}` : ''}`);
  if (hasSecs) green.push('Clear responsibilities and qualifications sections');
  const perks = [...new Set((all.match(/\b(hmo|medical|dental|13th month(?: pay)?|paid (?:time off|leave)|health insurance|life insurance|retirement|night differential|free meals?|transportation allowance|rice allowance)\b/gi) || []).map((p) => p.replace(/^./, (c) => c.toUpperCase())))];
  if (perks.length) green.push(`Benefits listed: ${perks.slice(0, 4).join(', ')}`);
  let host = '';
  try {
    host = new URL(page.url).hostname;
  } catch {}
  if (BOARDS.test('.' + host)) green.push(`Posted on a known job site (${host.replace(/^www\./, '')})`);

  if (!known(j.salary)) missing.push('Salary');
  if (!known(j.location)) missing.push('Location');
  const first = known(j.company) ? j.company.split(/\s+/)[0].replace(/[^\w&-]/g, '') : '';
  const profile = /\babout (?:us|the company|the employer|our company)|company (?:profile|overview)|who we are|our company\b/i.test(all) || (first.length > 1 && new RegExp(`\\babout ${first}\\b`, 'i').test(all));
  if (!profile) missing.push('Company profile');

  const verdict = red.length >= 2 ? 'suspicious' : red.length === 1 || missing.length >= 2 ? 'caution' : 'legit';
  const clamp = (n, a, b) => Math.max(a, Math.min(b, Math.round(n)));
  const score =
    verdict === 'legit' ? clamp(72 + 5 * green.length - 4 * missing.length, 70, 100) : verdict === 'caution' ? clamp(62 + 2 * green.length - 4 * missing.length - 8 * red.length, 40, 69) : clamp(36 - 6 * (red.length - 2) + green.length, 0, 39);
  const advice =
    verdict === 'legit'
      ? 'No warning signs found. Apply through the job site and never pay to apply.'
      : verdict === 'caution'
        ? 'Check the company yourself before you apply: look up its website and reviews, and never pay a fee or share bank or ID details.'
        : 'This post shows several scam warning signs. Do not pay anything or share bank, GCash or ID details; report it to the job site.';
  return { verdict, score, green_flags: green, red_flags: red, missing_info: missing, advice };
}

const known = (v) => v && v !== 'Not stated';

// ---------- score ----------
export function quickScore(page, resumeText, now = new Date()) {
  const meta = jobMeta(page, now.getTime());
  const { job, text } = meta;
  const secs = sections(text);
  const { terms, hasSecs } = jobKeywords(text);
  const rn = norm(resumeText);
  const rl = String(resumeText || '').toLowerCase();
  const found = terms.filter((t) => has(rn, t));
  const miss = terms.filter((t) => !has(rn, t));
  const cov = (list, d) => {
    const all = list.reduce((s, t) => s + t.weight, 0);
    return all ? Math.round((100 * list.filter((t) => found.includes(t)).reduce((s, t) => s + t.weight, 0)) / all) : d;
  };
  const hard = terms.filter((t) => !t.soft && !t.phrase);
  const soft = terms.filter((t) => t.soft);
  const skills = cov(hard, 60);

  const need = jobYears(text);
  const have = resumeYears(resumeText, now);
  const exp = need === 0 ? 90 : need == null ? clampTo(65 + have * 6, 65, 90) : have >= need ? 95 : Math.round(35 + (55 * have) / need);
  const expNote = need === 0 ? 'The post says no experience is required.' : need == null ? `The post states no years of experience. Your resume shows about ${have} year${have === 1 ? '' : 's'}.` : `The post asks for ${need}+ years. Your resume shows about ${have}.`;

  const jobEdu = eduLevels(secs.filter((s) => s.kind !== 'ben').map((s) => s.line).join('\n'));
  const needEdu = jobEdu.length ? Math.min(...jobEdu) : 0;
  const haveEdu = Math.max(0, ...eduLevels(resumeText));
  const edu = !needEdu ? (haveEdu ? 85 : 70) : !haveEdu ? 50 : haveEdu >= needEdu ? 95 : haveEdu === needEdu - 1 ? 60 : 35;
  const eduNote = !needEdu ? 'The post names no education level.' : !haveEdu ? `The post asks for ${EDU_NAME[needEdu]}; no education level was found in your resume.` : haveEdu >= needEdu ? `The post asks for ${EDU_NAME[needEdu]}; your resume meets it.` : `The post asks for ${EDU_NAME[needEdu]}; your resume shows ${EDU_NAME[haveEdu]}.`;

  const places = known(job.location) ? job.location.split(/[,;]/).map((p) => p.trim().toLowerCase()).filter((p) => p.length >= 4 && p !== 'philippines') : [];
  const near = places.some((p) => rl.includes(p));
  const remoteOk = /\b(remote|work from home|wfh|home[\s-]based)\b/.test(rl);
  const shift = /\b(night shift|graveyard|shifting schedule|rotating shifts?|us shift|holidays|weekends)\b/i.exec(text)?.[0];
  const shiftOk = shift && /\b(night shift|graveyard|shifting|rotating|us shift|us hours|weekends)\b/.test(rl);
  let loc = job.work_setup === 'Remote' ? (remoteOk ? 95 : 85) : near ? 95 : places.length ? 60 : 70;
  if (shift && !shiftOk) loc = Math.max(0, loc - 10);
  const locNote = [
    job.work_setup === 'Remote' ? (remoteOk ? 'Remote role, and your resume shows remote work.' : 'Remote role.') : near ? `Your resume mentions ${job.location}.` : places.length ? `Check the commute to ${job.location}.` : 'No clear location in the post.',
    shift ? (shiftOk ? `The post mentions ${shift.toLowerCase()} and your resume shows similar shifts.` : `The post mentions ${shift.toLowerCase()}; say so if you can work it.`) : '',
  ].filter(Boolean).join(' ');

  const ats = cov(terms, 60);
  const softScore = cov(soft, 75);
  const breakdown = [
    { category: 'Skills', score: skills, notes: hard.length ? `${hard.filter((t) => found.includes(t)).length} of ${hard.length} skills and tools from the post are in your resume.` : 'No known skill terms found in the post.' },
    { category: 'Experience', score: exp, notes: expNote },
    { category: 'Qualifications/Education', score: edu, notes: eduNote },
    { category: 'Location & schedule', score: loc, notes: locNote },
    { category: 'ATS keywords', score: ats, notes: `${found.length} of ${terms.length} key terms from the post appear in your resume.` },
    { category: 'Soft skills', score: softScore, notes: soft.length ? `${soft.filter((t) => found.includes(t)).length} of ${soft.length} soft skills from the post are named in your resume.` : 'The post names no specific soft skills.' },
  ];
  // No known terms: nothing to match on, so cap the score instead of trusting the defaults.
  const raw = Math.round(0.3 * skills + 0.2 * exp + 0.15 * edu + 0.1 * loc + 0.15 * ats + 0.1 * softScore);
  const score = text.length < 200 ? 0 : terms.length ? raw : Math.min(raw, 50);

  const strengths = found.slice(0, 8).map((t) => t.label);
  if (need != null && have >= need && need > 0) strengths.push(`${need}+ years of experience`);
  if (needEdu && haveEdu >= needEdu) strengths.push(`Education: ${EDU_NAME[needEdu]}`);
  const gaps = miss.slice(0, 8).map((t) => t.label);
  if (need && have < need) gaps.push(`${need}+ years of experience (resume shows about ${have})`);
  if (needEdu && haveEdu && haveEdu < needEdu) gaps.push(`Education: ${EDU_NAME[needEdu]}`);

  const top = miss.slice(0, 3);
  const improvements = [
    ...top.map((t) => `"${t.label}" is in the post but not in your resume. If it is true for you, add it to your Skills section and to one Experience bullet.`),
    need && have < need ? `The post asks for ${need}+ years. Put your total years in your Summary line so it is easy to see.` : null,
    !hasSecs && !page.selectionText ? 'For a cleaner check, select the job description on the page, then score again.' : null,
    'For a full read with tailored advice, switch to "Paste into your AI chat" in Settings.',
  ].filter(Boolean);
  const resume_suggestions = miss.slice(0, 4).map((t) => ({
    section: t.soft ? 'Summary (only if true)' : 'Experience (only if true)',
    text: t.soft ? `If it is true for you, add a line such as: "Known for ${t.label.toLowerCase()} in [your field], shown by [example]."` : `If you have done ${t.label}, add a bullet such as: "Used ${t.label} to [what you did], which [result]."`,
  }));

  const pct = terms.length ? Math.round((100 * found.length) / terms.length) : 0;
  const summary = text.length < 200
    ? 'Quick check could not find a job description on this page. Select the job text and score again.'
    : [terms.length ? `Quick check: your resume matches ${found.length} of ${terms.length} key terms from this post (${pct}%).` : 'Quick check found no known skill terms in this post, so the score rests on experience, education and location only.', expNote, need == null ? eduNote : '', 'This is a keyword match, not an AI review.'].filter(Boolean).join(' ');

  return normalizeResult({
    job,
    fit: { score, verdict: verdictFor(score), summary },
    breakdown,
    matched_strengths: strengths,
    gaps,
    improvements,
    resume_suggestions,
    ats_keywords_missing: miss.slice(0, 12).map((t) => t.label),
    legitimacy: legitimacy(page, meta, secs),
  });
}

const clampTo = (n, a, b) => Math.max(a, Math.min(b, Math.round(n)));
