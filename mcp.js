// MCP server: the plug between the user's own Claude and Tailor. Claude does the thinking; these tools only store data.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as core from './core.js';

const L = core.LIMITS;

const INSTRUCTIONS = `Tailor stores a candidate's master profile, saved job descriptions (JDs), and one-page resumes tailored to each JD.
You (Claude) do all the thinking and writing; Tailor saves, renders and lets the person edit.

Typical flows:
1. Build profile: user shares an old resume/LinkedIn text → call update_profile with every detail you can extract (be exhaustive; the profile is the master record).
2. Tailor a resume: user says "tailor my resume for job #N" (or pastes a JD — then call add_job first). Call get_profile and get_job, then write a ONE-PAGE resume that prioritises the experiences most relevant to the JD, and call save_resume with a 2–3 paragraph message explaining: what the JD emphasises, which experiences you prioritised and why, and what you left out.
3. Apply edits: user says "apply my pending edits for job #N" → get_job, read thread messages with kind=edit_request and status=pending, revise, call save_resume with a short reply saying what changed.
Rules: never invent facts, numbers, employers or dates not in the profile. Always follow profile.instructions. If the JD is unreadable or has no real requirements, call post_message with needs_clarification=true instead of guessing.`;

const resumeSchema = z.object({
  name: z.string(),
  headline: z.string().optional().describe('One line, e.g. "Product Manager — Payments & Integrations"'),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
  summary: z.string().optional().describe(`Max ${L.maxSummaryWords} words, tailored to the JD`),
  experience: z.array(z.object({
    role: z.string(), company: z.string(),
    location: z.string().optional(),
    dates: z.string().optional().describe('e.g. "Jan 2024 – Present"'),
    bullets: z.array(z.string()).describe(`Max ${L.maxBulletsPerRole} bullets, each max ${L.maxBulletWords} words; lead with impact + numbers`),
  })).optional().describe(`Max ${L.maxRoles} roles, most relevant first within reverse-chronological order`),
  education: z.array(z.object({
    degree: z.string(), school: z.string(), dates: z.string().optional(), details: z.string().optional(),
  })).optional(),
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })).optional().describe(`Max ${L.maxSkillGroups} groups`),
  projects: z.array(z.string()).optional().describe(`Max ${L.maxExtrasItems}, one line each`),
  achievements: z.array(z.string()).optional().describe(`Max ${L.maxExtrasItems}, one line each`),
  certifications: z.array(z.string()).optional().describe(`Max ${L.maxExtrasItems}, one line each`),
});

const entry = z.record(z.string(), z.any());

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

const jobSummary = j => ({ job_id: j.id, title: j.title, company: j.company, status: j.status, has_resume: !!j.resume, pending_edits: j.thread.filter(m => m.kind === 'edit_request' && m.status === 'pending').length, updated_at: j.updated_at });

export function buildMcpServer(appUrl) {
  const server = new McpServer({ name: 'tailor-resumes', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const wrap = (name, fn) => async (args) => {
    try { await core.touchClaude(name); return await fn(args || {}); }
    catch (e) { return fail(e.message); }
  };

  server.registerTool('get_profile', {
    title: 'Get candidate profile',
    description: "Read the candidate's full master profile: contact, links, summary, every experience/education/achievement/certification/skill/project, and standing instructions you must follow.",
    inputSchema: {},
  }, wrap('get_profile', async () => text(await core.getProfile())));

  server.registerTool('update_profile', {
    title: 'Update candidate profile',
    description: `Create or update the master profile (e.g. importing an old resume). Be exhaustive — include every detail, number, tool and learning. List sections: ${core.SECTION_KEYS.join(', ')}, links. Entry shapes: experience {role, company, location, start, end, details, domains}; education {degree, school, start, end, details}; achievements/other {title, details}; certifications {title, issuer, year, details}; skills {group, items:[...]}; projects {title, details, link}; links {label, url}. mode "merge" replaces only the sections you send; "append" adds entries to existing sections.`,
    inputSchema: {
      mode: z.enum(['merge', 'append']).default('merge'),
      name: z.string().optional(), headline: z.string().optional(), email: z.string().optional(),
      phone: z.string().optional(), location: z.string().optional(), summary: z.string().optional(),
      links: z.array(entry).optional(),
      experience: z.array(entry).optional(), education: z.array(entry).optional(),
      achievements: z.array(entry).optional(), certifications: z.array(entry).optional(),
      skills: z.array(entry).optional(), projects: z.array(entry).optional(), other: z.array(entry).optional(),
    },
  }, wrap('update_profile', async ({ mode, ...patch }) => {
    const p = await core.saveProfile(patch, mode);
    const counts = Object.fromEntries(core.SECTION_KEYS.map(k => [k, p[k].length]));
    return text({ ok: true, counts, view: `${appUrl}/#/profile` });
  }));

  server.registerTool('list_jobs', {
    title: 'List saved jobs',
    description: 'List every saved job with its status and whether it has pending edit requests from the user.',
    inputSchema: {},
  }, wrap('list_jobs', async () => text((await core.listJobs()).map(jobSummary))));

  server.registerTool('get_job', {
    title: 'Get a job',
    description: 'Get one job: full JD text, current resume (if any), and the thread (including pending edit requests the user typed in the app).',
    inputSchema: { job_id: z.string().describe('Job number, e.g. "3"') },
  }, wrap('get_job', async ({ job_id }) => {
    const j = await core.getJob(String(job_id).replace('#', ''));
    if (!j) return fail(`Job #${job_id} not found. Call list_jobs.`);
    const { versions, ...rest } = j;
    if (!j.jd_text) rest.note = j.url ? `JD text could not be extracted from ${j.url}. Fetch the link yourself if you can, otherwise ask the user to paste it.` : 'No JD text saved.';
    return text(rest);
  }));

  server.registerTool('add_job', {
    title: 'Save a job description',
    description: 'Save a new job description the user gave you in chat (text and/or link). Returns the job_id. If you fetched a link yourself, pass the extracted text as jd_text.',
    inputSchema: {
      title: z.string(), company: z.string().optional(),
      jd_text: z.string().optional(), url: z.string().optional(),
    },
  }, wrap('add_job', async (a) => {
    if (!a.jd_text && !a.url) return fail('Provide jd_text or url.');
    const j = await core.createJob(a);
    return text({ job_id: j.id, status: j.status, link_error: j.link_error, view: `${appUrl}/#/job/${j.id}` });
  }));

  server.registerTool('save_resume', {
    title: 'Save tailored resume',
    description: `Save (or replace) the ONE-PAGE resume for a job. Hard limits enforced: total ≤ ${L.maxWords} words, ≤ ${L.maxRoles} roles, ≤ ${L.maxBulletsPerRole} bullets per role, ≤ ${L.maxBulletWords} words per bullet, summary ≤ ${L.maxSummaryWords} words. If rejected, trim and call again. Marks all pending edit requests as done. "message" is shown to the user beside the resume: on first save, 2–3 short paragraphs on what the JD wants, what you prioritised and why, and what you left out; on edits, a short note of what changed.`,
    inputSchema: {
      job_id: z.string(),
      resume: resumeSchema,
      message: z.string().describe('Rationale / change note shown in the app thread (markdown allowed)'),
    },
  }, wrap('save_resume', async ({ job_id, resume, message }) => {
    const r = await core.saveResume(String(job_id).replace('#', ''), resume, message);
    if (!r.ok) return fail(`Not saved — the one-page rule failed:\n- ${r.errors.join('\n- ')}\nTrim and call save_resume again.`);
    return text({ ok: true, words: r.words, edits_marked_done: r.handled, view: `${appUrl}/#/job/${r.job.id}` });
  }));

  server.registerTool('post_message', {
    title: 'Post a message to a job thread',
    description: 'Post a message beside the resume in the app, e.g. a question for the user. Set needs_clarification=true when the JD is unreadable or too vague to tailor against.',
    inputSchema: { job_id: z.string(), message: z.string(), needs_clarification: z.boolean().default(false) },
  }, wrap('post_message', async ({ job_id, message, needs_clarification }) => {
    const j = await core.postClaudeMessage(String(job_id).replace('#', ''), message, { flag: needs_clarification });
    return text({ ok: true, status: j.status });
  }));

  return server;
}
