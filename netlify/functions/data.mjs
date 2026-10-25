import { store, json, authed } from '../lib/core.mjs';

export default async (req) => {
  if (!authed(req)) return json({ error: 'unauthorized' }, 401);
  const st = store();

  if (req.method === 'GET') {
    const rec = await st.get('main', { type: 'json' });
    return rec ? json(rec) : json({ error: 'empty' }, 404);
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null);
    if (!body?.data?.tx) return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
    const cur = await st.get('main', { type: 'json' });
    if (cur && body.rev != null && body.rev !== cur.rev) return json(cur, 409); // มีเครื่องอื่นแก้ก่อน
    const rec = { rev: (cur?.rev || 0) + 1, updatedAt: new Date().toISOString(), data: body.data };
    await st.setJSON('main', rec);
    await st.setJSON('backup/' + rec.updatedAt.slice(0, 10), rec); // สำรองรายวัน
    return json({ rev: rec.rev, updatedAt: rec.updatedAt });
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/data' };
