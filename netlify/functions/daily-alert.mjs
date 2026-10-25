import { store, json, authed, sendChat, refOf, notifyCfg, buildAlerts, buildWeekly, buildMonthly, ymOf, todayBKK } from '../lib/core.mjs';

export default async (req) => {
  if (!authed(req)) return json({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const { mode = 'test' } = await req.json().catch(() => ({}));
  const rec = await store().get('main', { type: 'json' });
  if (!rec) return json({ error: 'ยังไม่มีข้อมูลบนคลาวด์' }, 404);

  const S = rec.data, ref = refOf(S), n = notifyCfg(S);
  const text =
    mode === 'alerts'  ? buildAlerts(S, ref, n.daysBefore, true) :
    mode === 'weekly'  ? buildWeekly(S, ref) :
    mode === 'monthly' ? buildMonthly(S, ymOf(ref), ref, true) :
    `✅ *เชื่อมต่อสำเร็จ*\nMoney Manager ส่งข้อความเข้า Google Chat ได้แล้ว (${todayBKK()})`;

  try {
    const r = await sendChat(text);
    return json({ ok: r.ok, status: r.status, error: r.ok ? undefined : await r.text() }, r.ok ? 200 : 502);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

export const config = { path: '/api/daily-alert' };
