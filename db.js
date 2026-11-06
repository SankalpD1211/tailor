// Tiny document store: Postgres (DATABASE_URL) in production, JSON file locally.
import fs from 'fs';
import pg from 'pg';

const FILE = process.env.DATA_FILE || './data.json';
let pool = null;
let mem = { profile: null, jobs: {}, meta: {} };

export async function initDb() {
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS docs (
      coll TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (coll, id))`);
  } else if (fs.existsSync(FILE)) {
    mem = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  }
}

function flush() {
  if (!pool) fs.writeFileSync(FILE, JSON.stringify(mem, null, 2));
}

export async function get(coll, id) {
  if (pool) {
    const r = await pool.query('SELECT data FROM docs WHERE coll=$1 AND id=$2', [coll, id]);
    return r.rows[0]?.data ?? null;
  }
  return mem[coll]?.[id] ?? null;
}

export async function put(coll, id, data) {
  if (pool) {
    await pool.query(
      `INSERT INTO docs (coll,id,data,updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (coll,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
      [coll, id, data]);
    return data;
  }
  mem[coll] = mem[coll] || {};
  mem[coll][id] = data;
  flush();
  return data;
}

export async function list(coll) {
  if (pool) {
    const r = await pool.query('SELECT data FROM docs WHERE coll=$1', [coll]);
    return r.rows.map(x => x.data);
  }
  return Object.values(mem[coll] || {});
}

export async function del(coll, id) {
  if (pool) { await pool.query('DELETE FROM docs WHERE coll=$1 AND id=$2', [coll, id]); return; }
  if (mem[coll]) delete mem[coll][id];
  flush();
}
