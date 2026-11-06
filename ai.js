// In-app resume generation via the Anthropic API.
// Only active when ANTHROPIC_API_KEY is set in the environment (never in code).
import * as core from './core.js';

const KEY = () => process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
export const aiEnabled = () => !!KEY();

const L = core.LIMITS;
const str = { type: 'string' };
const TOOL = {
  name: 'save_resume',
  description: 'Save the one-page tailored resume and a note for the candidate.',
  input_schema: {
    type: 'object',
    required: ['resume', 'message'],
    properties: {
      message: { type: 'string', description: 'Markdown note shown beside the resume. First version: 2-3 short paragraphs (what the JD wants, what you prioritised and why, what you left out). Revision: 1-3 sentences on what changed.' },
      resume: {
        type: 'object',
        required: ['name'],
        properties: {
          name: str, headline: str, email: str, phone: str, location: str,
          links: { type: 'array', items: { type: 'object', required: ['label', 'url'], properties: { label: str, url: str } } },
          summary: { type: 'string', description: `Max ${L.maxSummaryWords} words` },
          experience: { type: 'array', description: `Max ${L.maxRoles} roles`, items: { type: 'object', required: ['role', 'company', 'bullets'], properties: { role: str, company: str, location: str, dates: str, bullets: { type: 'array', description: `Max ${L.maxBulletsPerRole}, each max ${L.maxWordsPerBullet} words`, items: str } } } },
          education: { type: 'array', items: { type: 'object', required: ['degree', 'school'], properties: { degree: str, school: str, dates: str, details: str } } },
          skills: { type: 'array', description: `Max ${L.maxSkillGroups} groups`, items: { type: 'object', required: ['group', 'items'], properties: { group: str, items: { type: 'array', items: str } } } },
          projects: { type: 'array', items: str }, achievements: { type: 'array', items: str }, certifications: { type: 'array', items: str },
        },
      },
    },
  },
};

const SYSTEM = `You are Tailor's resume writer. Write a strictly ONE-PAGE resume for the candidate, tailored to the job description, using ONLY facts from the candidate's profile.
Rules:
- Never invent facts, numbers, employers, tools or dates that are not in the profile.
- Always follow the candidate's standing instructions in profile.instructions.
- Prioritise the experiences most relevant to the JD; lead bullets with impact and numbers; use action verbs.
- Hard limits: total <= ${L.maxWords} words, <= ${L.maxRoles} roles, <= ${L.maxBulletsPerRole} bullets per role, <= ${L.maxWordsPerBullet} words per bullet, summary <= ${L.maxSummaryWords} words, <= ${L.maxSkillGroups} skill groups, <= ${L.maxExtrasItems} items each for projects/achievements/certifications. Aim for 330-420 words.
- Always respond by calling the save_resume tool.`;

async function callClaude(messages) {
  const r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL(), max_tokens: 4096, system: SYSTEM, tools: [TOOL], tool_choice: { type: 'tool', name: 'save_resume' }, messages }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Claude API error ${r.status}`);
  const block = (data.content || []).find(b => b.type === 'tool_use');
  if (!block) throw new Error('Claude did not return a resume');
  return { block, content: data.content };
}

const running = new Set();

// Generate (or revise, if there are pending edit requests) the resume for a job. Runs in the background.
export function generate(jobId) {
  if (!aiEnabled() || running.has(jobId)) return;
  running.add(jobId);
  run(jobId).catch(async e => {
    console.error('AI generate failed', e);
    const job = await core.getJob(jobId);
    if (job) await core.updateJob(jobId, {
      status: job.resume ? core.STATUS.READY : core.STATUS.WAITING,
      ai_error: e.message,
      thread: [...job.thread, { id: core.uid('m_'), role: 'system', kind: 'info', text: `Couldn't create the resume: ${e.message}`, at: new Date().toISOString() }],
    });
  }).finally(() => running.delete(jobId));
}

async function run(jobId) {
  let job = await core.getJob(jobId);
  if (!job || !job.jd_text) return;
  await core.updateJob(jobId, { status: core.STATUS.GENERATING, ai_error: null });
  const profile = await core.getProfile();
  const pending = job.thread.filter(m => m.kind === 'edit_request' && m.status === 'pending').map(m => `- ${m.text}`);
  let prompt = `CANDIDATE PROFILE (JSON):\n${JSON.stringify(profile)}\n\nJOB: ${job.title}${job.company ? ' at ' + job.company : ''}\nJOB DESCRIPTION:\n${job.jd_text}`;
  if (job.resume && pending.length) prompt += `\n\nCURRENT RESUME (JSON):\n${JSON.stringify(job.resume)}\n\nThe candidate asked for these edits. Apply them (still following all rules) and save the revised resume:\n${pending.join('\n')}`;
  else prompt += `\n\nWrite the tailored one-page resume now.`;

  const messages = [{ role: 'user', content: prompt }];
  for (let attempt = 0; attempt < 3; attempt++) {
    const { block, content } = await callClaude(messages);
    const { resume, message } = block.input || {};
    const res = await core.saveResume(jobId, resume || {}, message || '');
    if (res.ok) return;
    messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Rejected — breaks the one-page rule: ${res.errors.join('; ')}. Trim and call save_resume again.` }] });
  }
  throw new Error('Resume kept exceeding one page after 3 tries');
}
