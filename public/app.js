// Tailor front-end — vanilla JS, hash routing. No AI here: the user's own Claude talks to the server via MCP.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
let pollTimer = null;
let settingsCache = null;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { location.hash = '#/login'; throw new Error('Not logged in'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
async function copy(text, label = 'Copied') { try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } toast(label); }
const ago = iso => { if (!iso) return 'never'; const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return new Date(iso).toLocaleDateString(); };
const claudeUrl = prompt => 'https://claude.ai/new?q=' + encodeURIComponent(prompt);

function md(text) {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*(.+?)\*/g, '$1<i>$2</i>');
    if (/^\s*[-•*]\s+/.test(raw)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + l.replace(/^\s*[-•*]\s+/, '') + '</li>'; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (l.trim()) html += '<p>' + l + '</p>';
  }
  if (inList) html += '</ul>';
  return html;
}

// ---------------- Router ----------------
window.addEventListener('hashchange', route);
async function route() {
  clearInterval(pollTimer);
  document.body.classList.remove('expanded');
  const h = location.hash || '#/profile';
  const [, view, id] = h.split('/');
  if (view === 'login') return renderLogin();
  try { await api('/me'); } catch { return; }
  if (view === 'jobs' && id === 'new') return renderShell('jobs', renderNewJob);
  if (view === 'jobs') return renderShell('jobs', renderJobs);
  if (view === 'job') return renderWorkspace(id);
  if (view === 'settings') return renderShell('settings', renderSettings);
  return renderShell('profile', renderProfile);
}

async function renderShell(active, fn) {
  if (!settingsCache) settingsCache = await api('/settings').catch(() => ({}));
  const on = settingsCache.last_claude_call && (Date.now() - new Date(settingsCache.last_claude_call)) < 7 * 86400e3;
  app.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand"><div class="logo">T</div><div>Tailor<small>Resumes by your Claude</small></div></div>
      <nav class="nav">
        <a href="#/profile" class="${active === 'profile' ? 'active' : ''}"><span class="ico">◉</span>Profile</a>
        <a href="#/jobs" class="${active === 'jobs' ? 'active' : ''}"><span class="ico">▤</span>Jobs</a>
        <a href="#/settings" class="${active === 'settings' ? 'active' : ''}"><span class="ico">⚙</span>Settings</a>
      </nav>
      <div class="foot"><span class="dot ${on ? 'on' : ''}"></span>${on ? 'Claude connected' : 'Claude not connected yet'}<br><span class="muted">Last call: ${ago(settingsCache.last_claude_call)}</span></div>
    </aside>
    <main class="main"><div class="page" id="page"></div></main>
  </div>`;
  await fn($('#page'));
}

// ---------------- Login ----------------
function renderLogin() {
  app.innerHTML = `
  <div class="login">
    <div class="pitch">
      <div class="brand" style="padding:0"><div class="logo" style="background:#fff;color:#141414">T</div><div>Tailor</div></div>
      <h1>A one-page resume for every job, written by your own Claude.</h1>
      <p>Keep everything you've ever done in one profile. Paste a job description. Your Claude picks what matters, writes the resume and explains why. Tailor keeps it saved, editable and ready as a PDF.</p>
      <div class="flow"><span>1 · Build your profile</span><span>2 · Add a JD</span><span>3 · Ask Claude</span><span>4 · Edit & download</span></div>
    </div>
    <form id="lf">
      <h2>Sign in</h2>
      <div class="stack">
        <div><label class="f">Email</label><input class="in" name="email" value="demo@tailor.app" autocomplete="username"></div>
        <div><label class="f">Password</label><input class="in" name="password" type="password" placeholder="volopay2026" autocomplete="current-password"></div>
        <button class="btn primary" style="width:100%;justify-content:center">Sign in</button>
        <div class="err" id="lerr"></div>
        <p class="muted" style="font-size:12.5px">Demo account: demo@tailor.app / volopay2026</p>
      </div>
    </form>
  </div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api('/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } }); location.hash = '#/profile'; }
    catch (err) { $('#lerr').textContent = err.message; }
  };
}

// ---------------- Profile ----------------
const SECTIONS = [
  { key: 'experience', title: 'Experience', icon: '💼', hint: 'Add every role — internships and side gigs too. In "Everything you remember", dump it all: projects, numbers, tools, team size, what you learned. Claude picks what fits each job, so more detail = better resumes.',
    fields: [['role', 'Role / title'], ['company', 'Company'], ['location', 'Location'], ['start', 'Start (e.g. Mar 2023)'], ['end', 'End (or Present)'], ['domains', 'Domains (e.g. fintech, integrations)']], long: ['details', 'Everything you remember about this role'] },
  { key: 'education', title: 'Education', icon: '🎓', hint: 'Degree, school, dates — plus grades, projects, clubs, coursework you are proud of.',
    fields: [['degree', 'Degree'], ['school', 'School / university'], ['start', 'Start'], ['end', 'End']], long: ['details', 'Grades, projects, coursework, activities'] },
  { key: 'skills', title: 'Skills', icon: '🧰', hint: 'Group them (Product, Technical, Tools, Languages…). Comma-separate items.',
    fields: [['group', 'Group (e.g. Technical)']], long: ['items', 'Skills, comma separated'], isSkills: true },
  { key: 'certifications', title: 'Certifications & courses', icon: '📜', hint: 'Certificates, online courses, bootcamps — with issuer and year.',
    fields: [['title', 'Name'], ['issuer', 'Issuer'], ['year', 'Year']], long: ['details', 'What you learned / built'] },
  { key: 'achievements', title: 'Achievements', icon: '🏆', hint: 'Awards, hackathons, rankings, scholarships, academic achievements — with numbers where you can.',
    fields: [['title', 'Achievement']], long: ['details', 'Details'] },
  { key: 'projects', title: 'Projects', icon: '🛠', hint: 'Side projects, open source, case studies.',
    fields: [['title', 'Project'], ['link', 'Link']], long: ['details', 'What it is, your role, results'] },
  { key: 'other', title: 'Anything else', icon: '✚', hint: 'Volunteering, languages, publications, interests — anything that might matter for some job.',
    fields: [['title', 'Title']], long: ['details', 'Details'] },
];

async function renderProfile(page) {
  let p = await api('/profile');
  let dirty = false;
  const markDirty = () => { if (!dirty) { dirty = true; $('#savebar').style.display = 'flex'; } };

  const entryHtml = (sec, e, i) => `
    <div class="entry" data-sec="${sec.key}" data-i="${i}">
      <button class="btn ghost sm x" data-del="${sec.key}:${i}" title="Remove">✕</button>
      <div class="${sec.fields.length >= 3 ? 'grid3' : 'grid2'}">
        ${sec.fields.map(([k, ph]) => `<div><label class="f">${ph}</label><input class="in" data-k="${k}" value="${esc(e[k])}"></div>`).join('')}
      </div>
      <label class="f">${sec.long[1]}</label>
      <textarea class="in" data-k="${sec.long[0]}" rows="${sec.key === 'experience' ? 5 : 2}">${esc(sec.isSkills ? (e.items || []).join(', ') : e[sec.long[0]])}</textarea>
    </div>`;

  const draw = () => {
    page.innerHTML = `
    <div class="page-head"><div><h1>Your profile</h1><p>Your master record. Claude reads all of it every time it tailors a resume — be exhaustive.</p></div>
      <a class="btn claude" href="${claudeUrl('Here is my existing resume / LinkedIn text. Use the Tailor tools to build my profile with every detail you can find:\n\n[paste here]')}" target="_blank">✦ Import with Claude</a></div>

    <div class="card stack">
      <div class="grid2">
        <div><label class="f">Full name</label><input class="in" data-top="name" value="${esc(p.name)}"></div>
        <div><label class="f">Headline</label><input class="in" data-top="headline" value="${esc(p.headline)}" placeholder="e.g. Product Manager — B2B SaaS"></div>
      </div>
      <div class="grid3">
        <div><label class="f">Email</label><input class="in" data-top="email" value="${esc(p.email)}"></div>
        <div><label class="f">Phone</label><input class="in" data-top="phone" value="${esc(p.phone)}"></div>
        <div><label class="f">Location</label><input class="in" data-top="location" value="${esc(p.location)}"></div>
      </div>
      <div><label class="f">Profile summary</label><textarea class="in" data-top="summary" rows="3">${esc(p.summary)}</textarea></div>
      <div>
        <label class="f">Links (LinkedIn, GitHub, portfolio…)</label>
        <div id="links">${(p.links || []).map((l, i) => `<div class="grid2" style="grid-template-columns:160px 1fr 34px;margin-bottom:8px" data-link="${i}"><input class="in" data-lk="label" value="${esc(l.label)}" placeholder="Label"><input class="in" data-lk="url" value="${esc(l.url)}" placeholder="https://"><button class="btn ghost sm" data-dellink="${i}">✕</button></div>`).join('')}</div>
        <button class="btn sm" id="addlink">+ Add link</button>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>✦ Instructions for Claude</h2></div>
      <div class="hint">Standing rules Claude must follow every time it reads your profile — e.g. "Never drop my PayLane role", "Always quantify", "Keep a formal tone".</div>
      <textarea class="in" data-top="instructions" rows="3" placeholder="Your rules for Claude…">${esc(p.instructions)}</textarea>
    </div>

    ${SECTIONS.map(sec => `
      <div class="section">
        <div class="section-head"><h2>${sec.icon} ${sec.title} <span class="count">${(p[sec.key] || []).length}</span></h2><button class="btn sm" data-add="${sec.key}">+ Add</button></div>
        <div class="hint">${sec.hint}</div>
        ${(p[sec.key] || []).length ? p[sec.key].map((e, i) => entryHtml(sec, e, i)).join('') : `<div class="empty-sec">Nothing yet — add one, or let Claude import it.</div>`}
      </div>`).join('')}
    <div class="savebar" id="savebar" style="display:${dirty ? 'flex' : 'none'}">Unsaved changes <button class="btn sm" id="save">Save profile</button></div>`;
    bind();
  };

  const collect = () => {
    $$('[data-top]', page).forEach(el => { p[el.dataset.top] = el.value; });
    p.links = $$('[data-link]', page).map(r => ({ label: $('[data-lk=label]', r).value, url: $('[data-lk=url]', r).value }));
    for (const sec of SECTIONS) {
      p[sec.key] = $$(`.entry[data-sec=${sec.key}]`, page).map((el, i) => {
        const e = { ...(p[sec.key][i] || {}) };
        $$('[data-k]', el).forEach(inp => { e[inp.dataset.k] = inp.value; });
        if (sec.isSkills) e.items = (e.items || '').split(',').map(s => s.trim()).filter(Boolean);
        return e;
      });
    }
  };

  const bind = () => {
    $$('input,textarea', page).forEach(el => el.addEventListener('input', markDirty));
    $$('[data-add]', page).forEach(b => b.onclick = () => { collect(); const k = b.dataset.add; p[k] = [...(p[k] || []), k === 'skills' ? { items: [] } : {}]; markDirty(); draw(); $$(`.entry[data-sec=${k}]`, page).pop()?.querySelector('input')?.focus(); });
    $$('[data-del]', page).forEach(b => b.onclick = () => { collect(); const [k, i] = b.dataset.del.split(':'); p[k].splice(+i, 1); markDirty(); draw(); });
    $('#addlink').onclick = () => { collect(); p.links = [...(p.links || []), { label: '', url: '' }]; markDirty(); draw(); };
    $$('[data-dellink]', page).forEach(b => b.onclick = () => { collect(); p.links.splice(+b.dataset.dellink, 1); markDirty(); draw(); });
    $('#save').onclick = async () => { collect(); try { p = await api('/profile', { method: 'PUT', body: p }); dirty = false; draw(); toast('Profile saved'); } catch (e) { toast(e.message); } };
  };
  draw();
  window.onbeforeunload = () => (dirty ? true : undefined);
}

// ---------------- Jobs ----------------
const statusPill = s => {
  const cls = { 'Resume ready': 'ok', 'Waiting for Claude': 'claude', 'Edits pending': 'warn', 'Link failed': 'bad', 'Needs clarification': 'bad' }[s] || '';
  return `<span class="pill ${cls}">${esc(s)}</span>`;
};

async function renderJobs(page) {
  window.onbeforeunload = null;
  const jobs = await api('/jobs');
  page.innerHTML = `
    <div class="page-head"><div><h1>Jobs</h1><p>One tailored, one-page resume per job description.</p></div><a class="btn primary" href="#/jobs/new">+ Add Job Description</a></div>
    ${jobs.length ? `<div class="jobs">${jobs.map(j => `
      <a class="job" href="#/job/${j.id}">
        <div class="num">#${j.number}</div>
        <div><h3>${esc(j.title)}</h3><div class="sub">${esc(j.company || '—')} · updated ${ago(j.updated_at)}</div></div>
        ${statusPill(j.status)}
        <span class="muted">→</span>
      </a>`).join('')}</div>`
      : `<div class="empty-big"><h3>No jobs yet</h3><p>Add a job description and your Claude will tailor a one-page resume to it.</p><a class="btn primary" href="#/jobs/new">+ Add Job Description</a></div>`}`;
}

async function renderNewJob(page) {
  let mode = 'text';
  page.innerHTML = `
    <div class="page-head"><div><a class="muted" href="#/jobs" style="text-decoration:none">← Jobs</a><h1 style="margin-top:6px">Add a job description</h1><p>Paste the JD or a link. Tailor saves it; your Claude does the tailoring.</p></div></div>
    <form class="card stack" id="jf">
      <div class="grid2">
        <div><label class="f">Job title *</label><input class="in" name="title" placeholder="e.g. Product Manager — Integrations" required></div>
        <div><label class="f">Company</label><input class="in" name="company" placeholder="e.g. Volopay"></div>
      </div>
      <div class="tabs"><button type="button" data-m="text" class="on">Paste text</button><button type="button" data-m="link">Link</button></div>
      <div id="mtext"><label class="f">Job description</label><textarea class="in" name="jd_text" rows="12" placeholder="Paste the full job description — responsibilities, requirements, nice-to-haves…"></textarea><div class="muted" id="wc" style="font-size:12px;margin-top:4px">0 words</div></div>
      <div id="mlink" style="display:none"><label class="f">Link to the job post</label><input class="in" name="url" placeholder="https://company.com/careers/product-manager"><div class="muted" style="font-size:12px;margin-top:6px">Tailor opens the page and pulls out the text. Pages behind a login (e.g. most LinkedIn links) can't be read — paste the text instead.</div></div>
      <div class="err" id="jerr"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><a class="btn ghost" href="#/jobs">Cancel</a><button class="btn primary" id="jsub">Save JD</button></div>
    </form>`;
  $$('.tabs button', page).forEach(b => b.onclick = () => { mode = b.dataset.m; $$('.tabs button', page).forEach(x => x.classList.toggle('on', x === b)); $('#mtext').style.display = mode === 'text' ? '' : 'none'; $('#mlink').style.display = mode === 'link' ? '' : 'none'; });
  $('[name=jd_text]').oninput = e => { $('#wc').textContent = e.target.value.trim().split(/\s+/).filter(Boolean).length + ' words'; };
  $('#jf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { title: f.get('title'), company: f.get('company') };
    if (mode === 'text') body.jd_text = f.get('jd_text'); else body.url = f.get('url');
    $('#jsub').disabled = true; $('#jsub').textContent = mode === 'link' ? 'Reading link…' : 'Saving…'; $('#jerr').textContent = '';
    try { const j = await api('/jobs', { method: 'POST', body }); location.hash = '#/job/' + j.id; }
    catch (err) { $('#jerr').textContent = err.message; $('#jsub').disabled = false; $('#jsub').textContent = 'Save JD'; }
  };
}

// ---------------- Resume rendering ----------------
function renderPaper(r, { editing = false, page = 'A4' } = {}) {
  const ce = editing ? 'contenteditable="true" spellcheck="true"' : '';
  const f = (path, val, ph = '', tag = 'span', extra = '') => `<${tag} data-path="${path}" data-ph="${esc(ph)}" ${ce} ${extra}>${esc(val)}</${tag}>`;
  const contact = [
    r.email && f('email', r.email), r.phone && f('phone', r.phone), r.location && f('location', r.location),
    ...(r.links || []).map((l, i) => f(`links.${i}.url`, l.url.replace(/^https?:\/\/(www\.)?/, ''))),
  ].filter(Boolean);
  return `
  <div class="paper ${page === 'Letter' ? 'letter' : ''} ${editing ? 'editing' : ''}" id="paper">
    ${f('name', r.name, 'Your name', 'div', 'class="r-name"')}
    ${r.headline || editing ? f('headline', r.headline, 'Headline', 'div', 'class="r-headline"') : ''}
    <div class="r-contact">${contact.map(c => `<span>${c}</span>`).join('')}</div>
    ${r.summary ? `<h4>Summary</h4>${f('summary', r.summary, 'Summary', 'p', 'class="r-summary"')}` : ''}
    ${(r.experience || []).length ? `<h4>Experience</h4>${r.experience.map((e, i) => `
      <div class="r-item">
        <div class="r-row"><div>${f(`experience.${i}.role`, e.role, 'Role', 'b')}, ${f(`experience.${i}.company`, e.company, 'Company')}${e.location ? ` — ${f(`experience.${i}.location`, e.location)}` : ''}</div>${f(`experience.${i}.dates`, e.dates, 'Dates', 'span', 'class="r-dates"')}</div>
        <ul>${(e.bullets || []).map((b, j) => f(`experience.${i}.bullets.${j}`, b, 'Bullet', 'li')).join('')}</ul>
      </div>`).join('')}` : ''}
    ${(r.projects || []).length ? `<h4>Projects</h4><ul>${r.projects.map((x, i) => f(`projects.${i}`, x, '', 'li')).join('')}</ul>` : ''}
    ${(r.education || []).length ? `<h4>Education</h4>${r.education.map((e, i) => `
      <div class="r-item"><div class="r-row"><div>${f(`education.${i}.degree`, e.degree, 'Degree', 'b')}, ${f(`education.${i}.school`, e.school, 'School')}</div>${f(`education.${i}.dates`, e.dates, 'Dates', 'span', 'class="r-dates"')}</div>
      ${e.details ? f(`education.${i}.details`, e.details, '', 'div', 'class="r-sub"') : ''}</div>`).join('')}` : ''}
    ${(r.skills || []).length ? `<h4>Skills</h4><div class="r-skills">${r.skills.map((s, i) => `<div>${f(`skills.${i}.group`, s.group, 'Group', 'b')}: ${f(`skills.${i}.items`, (s.items || []).join(', '), 'Skills')}</div>`).join('')}</div>` : ''}
    ${(r.achievements || []).length ? `<h4>Achievements</h4><ul>${r.achievements.map((x, i) => f(`achievements.${i}`, x, '', 'li')).join('')}</ul>` : ''}
    ${(r.certifications || []).length ? `<h4>Certifications</h4><ul>${r.certifications.map((x, i) => f(`certifications.${i}`, x, '', 'li')).join('')}</ul>` : ''}
  </div>`;
}

function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[isNaN(ks[i]) ? ks[i] : +ks[i]];
  const last = ks[ks.length - 1];
  if (path.match(/^skills\.\d+\.items$/)) val = val.split(',').map(s => s.trim()).filter(Boolean);
  o[isNaN(last) ? last : +last] = val;
}
function cleanResume(r) {
  const c = JSON.parse(JSON.stringify(r));
  for (const e of c.experience || []) e.bullets = (e.bullets || []).filter(b => b.trim());
  for (const k of ['projects', 'achievements', 'certifications']) if (c[k]) c[k] = c[k].filter(x => x.trim());
  return c;
}

function preparePrint(resume, pageSize) {
  let root = document.getElementById('printroot');
  if (!root) { root = document.createElement('div'); root.id = 'printroot'; document.body.appendChild(root); }
  root.innerHTML = renderPaper(resume, { editing: false, page: pageSize });
}
window.preparePrint = preparePrint;

// ---------------- Job workspace ----------------
async function renderWorkspace(id) {
  window.onbeforeunload = null;
  if (!settingsCache) settingsCache = await api('/settings').catch(() => ({}));
  let job;
  try { job = await api('/jobs/' + id); } catch (e) { location.hash = '#/jobs'; return; }
  let editing = false, scale = 1, lastSig = '', saveT = null;
  const pageSize = settingsCache.page || 'A4';
  const tailorPrompt = `Use Tailor to tailor my resume for job #${job.number} (${job.title}${job.company ? ' at ' + job.company : ''}). Read my profile and the JD, keep it to one page, and explain what you prioritised.`;
  const editPrompt = `Apply my pending edits in Tailor for job #${job.number}.`;

  app.innerHTML = `
  <div class="ws">
    <section class="ws-left">
      <div class="ws-bar">
        <a class="btn ghost sm" href="#/jobs">← Jobs</a>
        <div class="title"><span class="muted">#${job.number}</span><span class="t">${esc(job.title)}${job.company ? ' · ' + esc(job.company) : ''}</span><span id="spill"></span></div>
        <span id="fit"></span>
        <button class="btn sm" id="bedit">✎ Edit</button>
        <button class="btn sm" id="bexp">⤢ Expand</button>
        <button class="btn sm primary" id="bpdf">⬇ Download PDF</button>
      </div>
      <div class="stage" id="stage"></div>
    </section>
    <aside class="ws-right">
      <div class="head"><h3><span class="claude-mark">✦</span> Claude</h3><div class="muted" style="font-size:12.5px;margin-top:4px">Claude's reasoning and your edit requests for this resume.</div></div>
      <div class="jdbox" id="jdbox"></div>
      <div class="thread" id="thread"></div>
      <div id="handoff"></div>
      <div class="compose">
        <textarea class="in" id="ask" placeholder="Ask Claude to change something… e.g. “Make the integrations work stand out more”"></textarea>
        <div class="row"><span class="muted" style="font-size:12px">Saved here, applied by your Claude</span><button class="btn primary sm" id="send">Send to Claude</button></div>
      </div>
    </aside>
  </div>`;

  const fitBadge = () => {
    const p = $('#paper'); if (!p) { $('#fit').innerHTML = ''; return; }
    $$('.overflow-line', p).forEach(x => x.remove());
    const over = p.scrollHeight > p.clientHeight + 1;
    $('#fit').innerHTML = over ? `<span class="pill bad">⚠ Over one page</span>` : `<span class="pill ok">✓ Fits one page</span>`;
    p.style.overflow = over ? 'visible' : 'hidden';
    if (over) { const l = document.createElement('div'); l.className = 'overflow-line'; l.style.top = p.clientHeight + 'px'; p.appendChild(l); }
  };
  const fitScale = () => {
    const st = $('#stage'), w = $('.paper-wrap'); if (!w) return;
    const avail = st.clientWidth - 56; const pw = w.firstElementChild.offsetWidth;
    scale = Math.min(1, avail / pw); w.style.transform = `scale(${scale})`; w.style.height = (w.firstElementChild.offsetHeight * scale) + 'px'; w.style.width = (pw * scale) + 'px';
    w.style.transformOrigin = 'top left';
  };

  const drawLeft = () => {
    const st = $('#stage');
    if (job.resume) {
      st.innerHTML = `<div class="paper-wrap">${renderPaper(job.resume, { editing, page: pageSize })}</div>`;
      if (editing) {
        $$('[data-path]', st).forEach(el => {
          el.addEventListener('input', () => { setPath(job.resume, el.dataset.path, el.innerText.replace(/\n+/g, ' ').trim()); fitBadge(); clearTimeout(saveT); saveT = setTimeout(saveManual, 900); });
          el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
        });
      }
      $('#bedit').disabled = false; $('#bpdf').disabled = false;
    } else {
      const failed = job.status === 'Link failed', clarify = job.status === 'Needs clarification';
      st.innerHTML = `<div class="placeholder"><div class="inner">
        ${failed || clarify ? '<div style="font-size:34px">⚠</div>' : '<div class="spinner"></div>'}
        <h3>${failed ? "We couldn't read that link" : clarify ? 'Claude needs a clearer JD' : 'Waiting for your Claude'}</h3>
        <p>${failed ? 'Paste the full JD text in the box on the right and save — then ask Claude.' : clarify ? 'See Claude’s note on the right. Paste a fuller JD and ask again.' : 'Open Claude (with Tailor connected) and send this prompt. The resume appears here automatically.'}</p>
        ${!failed ? `<div class="copyrow" style="margin-top:14px"><input class="in" readonly value="${esc(tailorPrompt)}"><button class="btn sm" id="cp1">Copy</button></div>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:center"><a class="btn claude" target="_blank" href="${claudeUrl(tailorPrompt)}">✦ Open in Claude</a></div>
        <p class="muted" style="font-size:12px;margin-top:12px">Not connected yet? <a href="#/settings">Connect Claude in Settings</a></p>` : ''}
      </div></div>`;
      $('#cp1') && ($('#cp1').onclick = () => copy(tailorPrompt, 'Prompt copied — paste it in Claude'));
      $('#bedit').disabled = true; $('#bpdf').disabled = true;
    }
    requestAnimationFrame(() => { fitScale(); fitBadge(); });
    $('#bedit').textContent = editing ? '✓ Done editing' : '✎ Edit';
    $('#bedit').classList.toggle('primary', editing);
    $('#spill').innerHTML = statusPill(job.status);
  };

  const drawRight = () => {
    const failed = job.status === 'Link failed' || job.status === 'Needs clarification';
    $('#jdbox').innerHTML = failed ? `
      <div class="banner ${job.status === 'Link failed' ? 'bad' : 'warn'}" style="flex-direction:column;margin-bottom:10px"><b>${job.status === 'Link failed' ? 'Link could not be read' : 'Claude flagged this JD'}</b><span style="font-size:12.5px">${esc(job.link_error || 'Add the full JD text below.')}</span></div>
      <textarea class="in" id="jdfix" rows="6" placeholder="Paste the full job description here…">${esc(job.jd_text || '')}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px">${job.url ? '<button class="btn sm" id="retry">↻ Retry link</button>' : ''}<button class="btn sm primary" id="savejd">Save JD</button></div>`
      : `<details><summary>Job description ${job.url ? `· <a href="${esc(job.url)}" target="_blank">source</a>` : ''}</summary><pre>${esc(job.jd_text)}</pre></details>`;
    if (failed) {
      $('#savejd').onclick = async () => { const t = $('#jdfix').value.trim(); if (t.length < 200) return toast('That looks too short for a full JD'); job = await api('/jobs/' + job.id, { method: 'PATCH', body: { jd_text: t } }); toast('JD saved'); drawAll(); };
      $('#retry') && ($('#retry').onclick = async () => { job = await api(`/jobs/${job.id}/retry-link`, { method: 'POST' }); toast(job.status === 'Link failed' ? 'Still could not read it' : 'Link read'); drawAll(); });
    }
    const th = $('#thread');
    th.innerHTML = job.thread.map(m => `
      <div class="msg ${m.role} ${m.kind === 'flag' ? 'flag claude' : ''}">
        ${m.role !== 'system' ? `<div class="who">${m.role === 'claude' ? '<span class="claude-mark" style="width:16px;height:16px;font-size:10px">✦</span> Claude' + (m.kind === 'summary' ? ' · why this resume' : '') : 'You' + (m.status === 'pending' ? ' · <span class="pill warn" style="padding:1px 7px">pending</span>' : ' · ✓ applied')} · ${ago(m.at)}</div>` : ''}
        <div class="body">${md(m.text)}</div>
      </div>`).join('') || '<div class="msg system"><div class="body">No messages yet.</div></div>';
    th.scrollTop = th.scrollHeight;
    const pending = job.thread.filter(m => m.kind === 'edit_request' && m.status === 'pending').length;
    $('#handoff').innerHTML = pending ? `
      <div class="handoff"><b>${pending} edit${pending > 1 ? 's' : ''} waiting for Claude.</b> Tell your Claude to apply them — this page updates by itself.
        <div class="copyrow"><input class="in" readonly value="${esc(editPrompt)}"><button class="btn sm" id="cp2">Copy</button><a class="btn sm claude" target="_blank" href="${claudeUrl(editPrompt)}">✦ Open</a></div></div>` : '';
    $('#cp2') && ($('#cp2').onclick = () => copy(editPrompt, 'Prompt copied — paste it in Claude'));
  };

  const drawAll = () => { lastSig = sig(job); drawLeft(); drawRight(); };
  const sig = j => j.updated_at + '|' + j.thread.length + '|' + j.status;

  const saveManual = async () => { try { await api(`/jobs/${job.id}/resume`, { method: 'PUT', body: cleanResume(job.resume) }); const j = await api('/jobs/' + job.id); job.updated_at = j.updated_at; lastSig = sig(j); toast('Saved'); } catch (e) { toast(e.message); } };

  $('#bedit').onclick = async () => { if (editing) { clearTimeout(saveT); job.resume = cleanResume(job.resume); await saveManual(); } editing = !editing; drawLeft(); };
  $('#bexp').onclick = () => { document.body.classList.toggle('expanded'); $('#bexp').textContent = document.body.classList.contains('expanded') ? '⤡ Collapse' : '⤢ Expand'; requestAnimationFrame(fitScale); };
  $('#bpdf').onclick = () => {
    const over = $('#fit').textContent.includes('Over');
    if (over && !confirm('This resume runs over one page. Download anyway? (Tip: ask Claude to trim it.)')) return;
    const t = document.title; document.title = `${job.resume.name || 'Resume'} - ${job.company || job.title}`.replace(/[\\/:*?"<>|]/g, '');
    let st = null; if (pageSize === 'Letter') { st = document.createElement('style'); st.textContent = '@page{size:Letter;margin:0}'; document.head.appendChild(st); }
    preparePrint(job.resume, pageSize); window.print(); document.title = t; st && st.remove();
  };
  $('#send').onclick = async () => {
    const t = $('#ask').value.trim(); if (!t) return;
    try { job = await api(`/jobs/${job.id}/edits`, { method: 'POST', body: { text: t } }); $('#ask').value = ''; drawAll(); toast('Saved — now tell Claude to apply it'); } catch (e) { toast(e.message); }
  };
  $('#ask').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#send').click(); });
  window.onresize = () => fitScale();

  drawAll();
  // Live updates: when Claude saves through MCP, the page refreshes itself.
  pollTimer = setInterval(async () => {
    if (editing || document.hidden) return;
    try { const j = await api('/jobs/' + job.id); if (sig(j) !== lastSig) { const hadResume = !!job.resume; job = j; drawAll(); toast(hadResume ? 'Claude updated your resume' : 'Claude delivered your resume ✦'); } } catch { }
  }, 3000);
}

// ---------------- Settings ----------------
async function renderSettings(page) {
  window.onbeforeunload = null;
  const s = settingsCache = await api('/settings');
  const on = s.last_claude_call;
  page.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p>Connect your own Claude. Tailor has no AI inside — your Claude plan does the thinking.</p></div></div>
    <div class="card stack">
      <h3 style="font-size:16px">Claude connection</h3>
      <div class="banner ${on ? 'ok' : 'warn'}"><span class="dot ${on ? 'on' : ''}" style="margin-top:7px"></span><div>${on ? `<b>Connected.</b> Last call ${ago(s.last_claude_call)} (<code class="k">${esc(s.last_tool)}</code>).` : '<b>Not connected yet.</b> Follow the steps below — takes about a minute.'}</div></div>
      <div><label class="f">Your MCP server URL (keep it private — it's your key)</label>
        <div class="copyrow"><input class="in" readonly value="${esc(s.mcp_url)}" id="murl"><button class="btn" id="cpm">Copy</button></div></div>
      <ol style="line-height:1.9;margin:0;padding-left:20px;color:var(--ink-2)">
        <li>Open <a href="https://claude.ai/settings/connectors" target="_blank">claude.ai → Settings → Connectors</a>.</li>
        <li>Click <b>Add custom connector</b>. Name it <code class="k">Tailor</code> and paste the URL above. Click <b>Add</b>.</li>
        <li>In a new chat, open the <b>tools menu</b> and make sure <b>Tailor</b> is switched on.</li>
        <li>Try: <code class="k">Use Tailor to tailor my resume for job #1</code></li>
      </ol>
      <div class="muted" style="font-size:12.5px">Works on Claude Free (1 custom connector), Pro, Max, Team and Enterprise. Claude may ask you to approve each tool the first time — choose "Always allow" for a smoother flow.</div>
    </div>

    <div class="card stack" style="margin-top:16px">
      <h3 style="font-size:16px">What Claude can do in Tailor</h3>
      <div style="display:grid;grid-template-columns:180px 1fr;gap:6px 14px;font-size:13px">
        <code class="k">get_profile</code><span>Read your master profile and instructions</span>
        <code class="k">update_profile</code><span>Build or update your profile (e.g. import an old resume)</span>
        <code class="k">list_jobs / get_job</code><span>Read saved JDs, resumes and your pending edit requests</span>
        <code class="k">add_job</code><span>Save a JD you pasted in Claude</span>
        <code class="k">save_resume</code><span>Save the tailored one-page resume + its reasoning</span>
        <code class="k">post_message</code><span>Leave a note or flag an unclear JD</span>
      </div>
    </div>

    <div class="card stack" style="margin-top:16px">
      <h3 style="font-size:16px">Resume</h3>
      <div class="grid2"><div><label class="f">Page size</label><select class="in" id="psize"><option ${s.page !== 'Letter' ? 'selected' : ''}>A4</option><option ${s.page === 'Letter' ? 'selected' : ''}>Letter</option></select></div>
      <div><label class="f">One-page rule (enforced on every Claude save)</label><div class="muted" style="font-size:12.5px;line-height:1.6">≤ ${s.limits.maxWords} words · ≤ ${s.limits.maxRoles} roles · ≤ ${s.limits.maxBulletsPerRole} bullets/role · ≤ ${s.limits.maxBulletWords} words/bullet</div></div></div>
    </div>

    <div class="card" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center"><div><b>Account</b><div class="muted" style="font-size:12.5px">demo@tailor.app</div></div><button class="btn danger" id="logout">Sign out</button></div>`;
  $('#cpm').onclick = () => copy(s.mcp_url, 'MCP URL copied');
  $('#psize').onchange = async e => { await api('/settings', { method: 'PUT', body: { page: e.target.value } }); settingsCache = null; toast('Saved'); };
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.hash = '#/login'; };
}

route();
