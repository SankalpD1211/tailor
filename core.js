// Business logic shared by the web API and the MCP server. No AI anywhere in here.
import crypto from 'crypto';
import * as db from './db.js';

export const uid = (p = '') => p + crypto.randomBytes(5).toString('hex');
const now = () => new Date().toISOString();

// ---------- Profile ----------
export const SECTION_KEYS = ['experience', 'education', 'achievements', 'certifications', 'skills', 'projects', 'other'];

export function emptyProfile() {
  return {
    name: '', headline: '', email: '', phone: '', location: '',
    links: [], // {label, url}
    summary: '',
    instructions: '', // standing instructions Claude must follow every time
    experience: [],   // {id, role, company, location, start, end, details, domains}
    education: [],    // {id, degree, school, start, end, details}
    achievements: [], // {id, title, details}
    certifications: [], // {id, title, issuer, year, details}
    skills: [],       // {id, group, items}
    projects: [],     // {id, title, details, link}
    other: [],        // {id, title, details}
    updated_at: now(),
  };
}

export async function getProfile() {
  return (await db.get('profile', 'me')) || emptyProfile();
}

export async function saveProfile(patch, mode = 'merge') {
  const p = await getProfile();
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined || v === null) continue;
    if (SECTION_KEYS.includes(k) || k === 'links') {
      const items = (Array.isArray(v) ? v : [v]).map(x => ({ id: x.id || uid(), ...x }));
      if (mode === 'append') p[k] = [...(p[k] || []), ...items];
      else p[k] = items;
    } else {
      p[k] = v;
    }
  }
  p.updated_at = now();
  return db.put('profile', 'me', p);
}

// ---------- Jobs ----------
export const STATUS = {
  JD_SAVED: 'JD saved',
  WAITING: 'Waiting for Claude',
  READY: 'Resume ready',
  EDITS: 'Edits pending',
  LINK_FAILED: 'Link failed',
  CLARIFY: 'Needs clarification',
  GENERATING: 'Writing resume…',
};

export async function listJobs() {
  const jobs = await db.list('jobs');
  return jobs.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

export async function getJob(id) {
  return db.get('jobs', String(id));
}

export async function nextJobNumber() {
  const meta = (await db.get('meta', 'counters')) || { job: 0 };
  meta.job += 1;
  await db.put('meta', 'counters', meta);
  return meta.job;
}

export async function createJob({ title, company, url, jd_text }, { auto = false } = {}) {
  const n = await nextJobNumber();
  const job = {
    id: String(n), number: n,
    title: (title || '').trim() || 'Untitled role',
    company: (company || '').trim(),
    url: (url || '').trim(),
    jd_text: (jd_text || '').trim(),
    jd_source: jd_text ? 'text' : (url ? 'link' : 'none'),
    status: STATUS.JD_SAVED,
    resume: null,
    thread: [],
    created_at: now(), updated_at: now(),
  };
  if (job.url && !job.jd_text) {
    const r = await fetchJdFromUrl(job.url);
    if (r.ok) { job.jd_text = r.text; job.jd_source = 'link'; }
    else { job.status = STATUS.LINK_FAILED; job.link_error = r.error; }
  }
  if (job.status === STATUS.JD_SAVED) {
    job.thread.push(sysMsg(auto ? `JD saved (${job.jd_text.split(/\s+/).length} words). Claude is writing your resume…` : `JD saved (${job.jd_text.split(/\s+/).length} words). Ask Claude: "Tailor my resume for job #${n}".`));
    job.status = STATUS.WAITING;
  }
  await db.put('jobs', job.id, job);
  return job;
}

export async function updateJob(id, patch) {
  const job = await getJob(id);
  if (!job) throw new Error(`Job #${id} not found`);
  Object.assign(job, patch, { updated_at: now() });
  return db.put('jobs', job.id, job);
}

export async function deleteJob(id) { return db.del('jobs', String(id)); }

function sysMsg(text) { return { id: uid('m_'), role: 'system', kind: 'info', text, at: now() }; }

export async function addEditRequest(id, text) {
  const job = await getJob(id);
  if (!job) throw new Error(`Job #${id} not found`);
  job.thread.push({ id: uid('m_'), role: 'user', kind: 'edit_request', status: 'pending', text, at: now() });
  job.status = STATUS.EDITS;
  job.updated_at = now();
  return db.put('jobs', job.id, job);
}

export async function postClaudeMessage(id, text, { flag = false } = {}) {
  const job = await getJob(id);
  if (!job) throw new Error(`Job #${id} not found`);
  job.thread.push({ id: uid('m_'), role: 'claude', kind: flag ? 'flag' : 'reply', text, at: now() });
  if (flag) job.status = STATUS.CLARIFY;
  job.updated_at = now();
  return db.put('jobs', job.id, job);
}

// ---------- Resume + one-page rule ----------
export const LIMITS = {
  maxWords: 480,
  maxSummaryWords: 60,
  maxRoles: 4,
  maxBulletsPerRole: 5,
  maxBulletWords: 32,
  maxEducation: 3,
  maxSkillGroups: 5,
  maxExtrasItems: 4, // achievements / certifications / projects each
};

const words = s => (s || '').toString().trim().split(/\s+/).filter(Boolean).length;

export function resumeWordCount(r) {
  let n = words(r.name) + words(r.headline) + words(r.summary);
  for (const e of r.experience || []) {
    n += words(e.role) + words(e.company) + words(e.location) + words(e.dates);
    for (const b of e.bullets || []) n += words(b);
  }
  for (const e of r.education || []) n += words(e.degree) + words(e.school) + words(e.dates) + words(e.details);
  for (const s of r.skills || []) n += words(s.group) + words((s.items || []).join(' '));
  for (const k of ['achievements', 'certifications', 'projects']) for (const x of r[k] || []) n += words(x);
  return n;
}

export function validateResume(r) {
  const errs = [];
  if (!r || typeof r !== 'object') return ['resume must be an object'];
  if (!r.name) errs.push('name is required');
  if (words(r.summary) > LIMITS.maxSummaryWords) errs.push(`summary is ${words(r.summary)} words; max ${LIMITS.maxSummaryWords}`);
  const exp = r.experience || [];
  if (exp.length > LIMITS.maxRoles) errs.push(`${exp.length} roles; max ${LIMITS.maxRoles} — drop the least relevant`);
  exp.forEach((e, i) => {
    const b = e.bullets || [];
    if (b.length > LIMITS.maxBulletsPerRole) errs.push(`role ${i + 1} (${e.role}) has ${b.length} bullets; max ${LIMITS.maxBulletsPerRole}`);
    b.forEach((t, j) => { if (words(t) > LIMITS.maxBulletWords) errs.push(`role ${i + 1} bullet ${j + 1} is ${words(t)} words; max ${LIMITS.maxBulletWords}`); });
  });
  if ((r.education || []).length > LIMITS.maxEducation) errs.push(`max ${LIMITS.maxEducation} education entries`);
  if ((r.skills || []).length > LIMITS.maxSkillGroups) errs.push(`max ${LIMITS.maxSkillGroups} skill groups`);
  for (const k of ['achievements', 'certifications', 'projects'])
    if ((r[k] || []).length > LIMITS.maxExtrasItems) errs.push(`max ${LIMITS.maxExtrasItems} ${k}`);
  const total = resumeWordCount(r);
  if (total > LIMITS.maxWords) errs.push(`total ${total} words; one page allows max ${LIMITS.maxWords} — trim ${total - LIMITS.maxWords}+ words`);
  return errs;
}

export async function saveResume(id, resume, message) {
  const job = await getJob(id);
  if (!job) throw new Error(`Job #${id} not found`);
  const errs = validateResume(resume);
  if (errs.length) return { ok: false, errors: errs };
  const versions = job.versions || [];
  if (job.resume) versions.push({ at: job.resume_updated_at, resume: job.resume });
  job.versions = versions.slice(-10);
  job.resume = resume;
  job.resume_updated_at = now();
  // Claude has handled any pending edit requests
  let handled = 0;
  for (const m of job.thread) if (m.kind === 'edit_request' && m.status === 'pending') { m.status = 'done'; handled++; }
  if (message) job.thread.push({ id: uid('m_'), role: 'claude', kind: job.versions.length ? 'reply' : 'summary', text: message, at: now() });
  job.status = STATUS.READY;
  job.updated_at = now();
  await db.put('jobs', job.id, job);
  return { ok: true, job, handled, words: resumeWordCount(resume) };
}

// Manual edit by a person (no limits enforced server-side; the UI shows the one-page badge)
export async function saveResumeManual(id, resume) {
  const job = await getJob(id);
  if (!job) throw new Error(`Job #${id} not found`);
  job.resume = resume;
  job.resume_updated_at = now();
  job.updated_at = now();
  return db.put('jobs', job.id, job);
}

// ---------- JD link fetch (plain HTML parsing, no AI) ----------
const decode = s => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

function htmlToText(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

export async function fetchJdFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Only http(s) links are supported.' };
    if (/linkedin\.com/.test(u.hostname) && !/\/jobs\/view\//.test(u.pathname))
      return { ok: false, error: 'LinkedIn needs a login to show this page. Paste the JD text instead.' };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TailorBot/1.0)', Accept: 'text/html' } });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: `The site answered ${res.status}. Paste the JD text instead.` };
    const html = await res.text();
    // Prefer structured JobPosting data when the page has it
    let text = '';
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const arr = [].concat(JSON.parse(m[1].trim()));
        const flat = arr.flatMap(x => x['@graph'] || [x]);
        const jp = flat.find(x => [].concat(x['@type']).includes('JobPosting'));
        if (jp?.description) { text = `${jp.title || ''}\n${jp.hiringOrganization?.name || ''}\n\n${htmlToText(decode(jp.description))}`; break; }
      } catch { /* ignore bad JSON-LD */ }
    }
    if (!text) text = htmlToText(html);
    text = text.slice(0, 20000);
    if (text.length < 300) return { ok: false, error: "This page didn't contain a readable job description (it may need a login or JavaScript). Paste the JD text instead." };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'The link took too long to respond. Paste the JD text instead.' : 'Could not open this link. Paste the JD text instead.' };
  }
}

// ---------- Settings / connection status ----------
export async function getSettings() {
  return (await db.get('meta', 'settings')) || { page: 'A4', last_claude_call: null, last_tool: null };
}
export async function touchClaude(tool) {
  const s = await getSettings();
  s.last_claude_call = now(); s.last_tool = tool;
  await db.put('meta', 'settings', s);
}
export async function saveSettings(patch) {
  const s = await getSettings();
  Object.assign(s, patch);
  return db.put('meta', 'settings', s);
}
