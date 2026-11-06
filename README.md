# Tailor — one-page resumes, tailored by your own Claude

Tailor keeps your master profile and saved job descriptions. Your own Claude, connected through MCP, reads the profile and the JD, writes a one-page resume tailored to that JD, and explains what it prioritised. Tailor saves the resume, lets you edit it, and exports it as a PDF.

**There is no AI inside Tailor.** It has no OpenAI or Anthropic keys and makes no model calls. The customer's own Claude plan does all the thinking.

## Try it
- App: `https://<your-app>.onrender.com` — login `demo@tailor.app` / `volopay2026`
- MCP URL: shown in **Settings** inside the app (`https://<your-app>.onrender.com/mcp/<key>`)

## Connect to Claude (1 minute)
1. Open claude.ai → **Settings → Connectors → Add custom connector**.
2. Name it `Tailor` and paste the MCP URL. Click **Add**.
3. In a new chat, turn on **Tailor** in the tools menu.
4. Type: `Use Tailor to tailor my resume for job #1`
5. Open the app → Jobs → #1. The resume and Claude's reasoning appear on their own. Edit any line, or type a change request and tell Claude `Apply my pending edits in Tailor for job #1`.

## MCP tools
| Tool | What it does |
|---|---|
| `get_profile` | Read the master profile and the standing instructions for Claude |
| `update_profile` | Build or update the profile (for example, import an old resume) |
| `list_jobs` / `get_job` | Read saved JDs, resumes and pending edit requests |
| `add_job` | Save a JD pasted in Claude |
| `save_resume` | Save the tailored resume and its reasoning. Enforces the one-page rule. |
| `post_message` | Leave a note, or flag an unclear JD |

## Run locally
```
npm install
npm start   # http://localhost:3000, data stored in data.json
```

## Deploy (Render)
Push to GitHub → Render → **New → Blueprint** → select the repo. `render.yaml` creates the web service and a free Postgres database.
