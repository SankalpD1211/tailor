import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as db from './db.js';
import * as core from './core.js';
import { buildMcpServer } from './mcp.js';
import { seedIfEmpty } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'youruser@gmail.com';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Admin@123';
const MCP_KEY = process.env.MCP_KEY || 'demo-key-change-me';
const SECRET = process.env.SESSION_SECRET || 'tailor-dev-secret';
// URL-safe path token derived from MCP_KEY (raw keys can contain / + = which break the URL)
const MCP_PATH = crypto.createHash('sha256').update(MCP_KEY).digest('hex').slice(0, 32);

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const baseUrl = req => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const token = () => `${DEMO_EMAIL}.${sign(DEMO_EMAIL)}`;

// ---------- No OAuth: answer 404 so Claude connects without sign-in ----------
app.all(/^\/\.well-known\//, (req, res) => res.status(404).json({ error: 'not_found' }));

// ---------- MCP endpoint (stateless Streamable HTTP) ----------
app.post('/mcp/:key', async (req, res) => {
  if (req.params.key !== MCP_PATH) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid MCP key' }, id: null });
  core.touchClaude(req.body?.method || 'connect').catch(() => {});
  try {
    const server = buildMcpServer(baseUrl(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('MCP error', e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});
app.all('/mcp/:key', (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if ((email || '').trim().toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) return res.status(401).json({ error: 'Wrong email or password' });
  res.cookie('tailor', token(), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 86400e3 });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie('tailor'); res.json({ ok: true }); });

const auth = (req, res, next) => (req.cookies.tailor === token() ? next() : res.status(401).json({ error: 'Not logged in' }));
const h = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.status(400).json({ error: e.message }); } };

app.get('/api/me', auth, (req, res) => res.json({ email: DEMO_EMAIL }));

// ---------- Profile ----------
app.get('/api/profile', auth, h(() => core.getProfile()));
app.put('/api/profile', auth, h(req => core.saveProfile(req.body, 'merge')));

// ---------- Jobs ----------
app.get('/api/jobs', auth, h(() => core.listJobs()));
app.post('/api/jobs', auth, h(async req => {
  const { title, company, url, jd_text } = req.body || {};
  if (!title?.trim()) throw new Error('Job title is required');
  if (!url?.trim() && !jd_text?.trim()) throw new Error('Paste the JD text or a link');
  if (jd_text && jd_text.trim().length < 200) throw new Error("This looks too short to be a full job description. Paste the whole JD.");
  return core.createJob({ title, company, url, jd_text });
}));
app.get('/api/jobs/:id', auth, h(async req => {
  const j = await core.getJob(req.params.id);
  if (!j) throw new Error('Job not found');
  return j;
}));
app.patch('/api/jobs/:id', auth, h(async req => {
  const { title, company, jd_text, url } = req.body || {};
  const patch = {};
  if (title !== undefined) patch.title = title;
  if (company !== undefined) patch.company = company;
  if (url !== undefined) patch.url = url;
  if (jd_text !== undefined) {
    patch.jd_text = jd_text; patch.jd_source = 'text'; patch.link_error = null;
    const j = await core.getJob(req.params.id);
    if (j && [core.STATUS.LINK_FAILED, core.STATUS.CLARIFY].includes(j.status)) patch.status = j.resume ? core.STATUS.READY : core.STATUS.WAITING;
  }
  return core.updateJob(req.params.id, patch);
}));
app.delete('/api/jobs/:id', auth, h(async req => { await core.deleteJob(req.params.id); return { ok: true }; }));
app.post('/api/jobs/:id/retry-link', auth, h(async req => {
  const j = await core.getJob(req.params.id);
  const r = await core.fetchJdFromUrl(j.url);
  if (!r.ok) return core.updateJob(j.id, { link_error: r.error, status: core.STATUS.LINK_FAILED });
  return core.updateJob(j.id, { jd_text: r.text, jd_source: 'link', link_error: null, status: j.resume ? core.STATUS.READY : core.STATUS.WAITING });
}));
app.put('/api/jobs/:id/resume', auth, h(req => core.saveResumeManual(req.params.id, req.body)));
app.post('/api/jobs/:id/edits', auth, h(req => {
  const t = (req.body?.text || '').trim();
  if (!t) throw new Error('Type what you want changed');
  return core.addEditRequest(req.params.id, t);
}));

// ---------- Settings ----------
app.get('/api/settings', auth, h(async req => ({ ...(await core.getSettings()), mcp_url: `${baseUrl(req)}/mcp/${MCP_PATH}`, limits: core.LIMITS })));
app.put('/api/settings', auth, h(req => core.saveSettings({ page: req.body?.page === 'Letter' ? 'Letter' : 'A4' })));

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));
app.get(/^\/(?!api|mcp).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

await db.initDb();
await seedIfEmpty();
app.listen(PORT, () => console.log(`Tailor running on :${PORT}  MCP: /mcp/${MCP_KEY}`));
