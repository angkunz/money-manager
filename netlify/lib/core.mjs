import { getStore } from '@netlify/blobs';

/* ---------- ทั่วไป ---------- */
export const env = k => globalThis.Netlify?.env?.get(k) ?? process.env[k];
export const store = () => getStore({ name: 'money', consistency: 'strong' });
export const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
export const authed = req => { const k = env('APP_PIN'); return !!k && req.headers.get('x-app-key') === k; };

/* ---------- วันที่ ---------- */
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const pad = n => String(n).padStart(2, '0');
const ymdUTC = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d || 1); };
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const ymOf = s => s.slice(0, 7);
export const addYM = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const dateIn = (ym, day) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(Math.min(+day, dim(y, m)))}`; };
const addMD = (s, k) => dateIn(addYM(ymOf(s), k), +s.slice(8, 10));
const addDays = (s, k) => ymdUTC(new Date(parse(s) + k * 864e5));
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
export const todayBKK = () => ymdUTC(new Date(Date.now() + 7 * 36e5));
export const refOf = S => S.settings?.refDate || todayBKK();
const dLabel = s => { if (!s) return '-'; const [y, m, d] = s.split('-').map(Number); return `${d} ${TH_M[m - 1]} ${y + 543}`; };
const ymLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${TH_M[m - 1]} ${y + 543}`; };
const baht = n => '฿' + Math.round(n || 0).toLocaleString('en-US');
const sum = (a, f = x => x.amount) => a.reduce((s, x) => s + (+f(x) || 0), 0);

/* ---------- การตั้งค่าแจ้งเตือน ---------- */
const NDEF = { enabled: true, daysBefore: 3, weekly: true, monthly: true };
export const notifyCfg = S => ({ ...NDEF, ...(S.settings?.notify || {}) });

/* ---------- คำนวณ (ตรงกับฝั่งแอป) ---------- */
function instCalc(i, ref = '9999-12-31') {
  const n = Math.max(1, +i.months || 1), total = Math.round(i.principal * (1 + (+i.rate || 0) / 100 * n)), per = Math.round(total / n), dues = [];
  for (let k = 0; k < n; k++) dues.push({ date: addMD(i.firstDue, k), amount: k === n - 1 ? total - per * (n - 1) : per });
  const done = dues.filter(d => d.date <= ref).length, paid = sum(dues.slice(0, done));
  return { ...i, total, dues, remain: total - paid };
}
const instDues = S => (S.inst || []).flatMap(i => instCalc(i).dues.map(d => ({ ...d, card: i.card, item: i.item })));
const instInMonth = (S, ym) => sum(instDues(S).filter(d => ymOf(d.date) === ym));

function monthAgg(S, ym) {
  let inc = 0, fix = 0, vari = 0;
  S.tx.forEach(t => { if (ymOf(t.date) !== ym) return; if (t.type === 'รายรับ') inc += +t.amount; else if (t.nature === 'คงที่') fix += +t.amount; else vari += +t.amount; });
  const inst = instInMonth(S, ym), exp = fix + vari + inst;
  return { inc, fix, vari, inst, exp, net: inc - exp };
}
function ledgerClose(S, until) {
  let bal = +S.settings.opening || 0, ym = S.settings.startMonth || until, g = 0;
  while (ym <= until && g++ < 240) { bal += monthAgg(S, ym).net; ym = addYM(ym, 1); }
  return bal;
}
function catSpend(S, ym) {
  const m = {}; S.tx.forEach(t => { if (t.type === 'รายจ่าย' && ymOf(t.date) === ym) m[t.category] = (m[t.category] || 0) + +t.amount; }); return m;
}
function stmtDue(c, date) {
  const ym = ymOf(date); let cut = dateIn(ym, c.cutoff); if (date > cut) cut = dateIn(addYM(ym, 1), c.cutoff);
  const cym = ymOf(cut); let due = dateIn(cym, c.due); if (due <= cut) due = dateIn(addYM(cym, 1), c.due); return due;
}
function cardPays(S, c) {
  const m = {}, add = (due, k, v) => { if (c.paidUntil && due <= c.paidUntil) return; (m[due] ??= { due, full: 0, inst: 0 })[k] += v; };
  S.tx.forEach(t => { if (t.type === 'รายจ่าย' && t.method === c.name) add(stmtDue(c, t.date), 'full', +t.amount); });
  instDues(S).forEach(d => { if (d.card === c.name) add(d.date, 'inst', d.amount); });
  return Object.values(m).sort((a, b) => a.due < b.due ? -1 : 1);
}
function alerts(S, ref) {
  const out = [];
  (S.bills || []).forEach(b => {
    let ym = ymOf(ref); if ((b.paid || []).includes(ym)) ym = addYM(ym, 1);
    const due = dateIn(ym, b.day);
    out.push({ name: b.name, amount: +b.amount, due, days: diffDays(due, ref), auto: b.auto === 'ใช่' });
  });
  (S.cards || []).forEach(c => cardPays(S, c).forEach((p, i) => {
    const days = diffDays(p.due, ref);
    if (i === 0 || days <= 35) out.push({ name: `ชำระ${c.name} (รอบ ${dLabel(p.due)})`, amount: p.full + p.inst, due: p.due, days, detail: `รูดเต็ม ${baht(p.full)} + ผ่อน ${baht(p.inst)}` });
  }));
  return out.sort((a, b) => a.days - b.days);
}
function rangeSum(S, from, to) {
  const inR = d => d >= from && d <= to, cats = {}; let inc = 0, fix = 0, vari = 0;
  S.tx.forEach(t => { if (!inR(t.date)) return; if (t.type === 'รายรับ') inc += +t.amount; else { t.nature === 'คงที่' ? fix += +t.amount : vari += +t.amount; cats[t.category] = (cats[t.category] || 0) + +t.amount; } });
  const inst = sum(instDues(S).filter(d => inR(d.date))), exp = fix + vari + inst;
  return { inc, fix, vari, inst, exp, net: inc - exp, top: Object.entries(cats).sort((a, b) => b[1] - a[1]) };
}

/* ---------- สร้าง Card V2 สำหรับ Google Chat ---------- */
function createAppButton() {
  const appUrl = env('URL') || 'https://moneychill.netlify.app';
  if (!appUrl) return [];
  return [{
    text: '🌐 เปิดแอปพลิเคชัน',
    onClick: { openLink: { url: appUrl } }
  }];
}

export function buildAlerts(S, ref, days, force = false) {
  const A = alerts(S, ref).filter(a => a.days <= days);
  const buttons = createAppButton();
  const btnWidget = buttons.length ? [{ buttonList: { buttons } }] : [];

  if (!A.length) {
    if (!force) return null;
    return {
      cardsV2: [{
        cardId: 'alert_empty',
        card: {
          header: { title: '🔔 แจ้งเตือนครบกำหนดชำระ', subtitle: `ข้อมูล ณ ${dLabel(ref)}` },
          sections: [{ widgets: [{ textParagraph: { text: `✅ ไม่มีรายการครบกำหนดใน ${days} วันข้างหน้า` } }, ...btnWidget] }]
        }
      }]
    };
  }

  const widgets = [];
  const groups = [['🔴 เกินกำหนด', a => a.days < 0], ['🟠 ครบกำหนดวันนี้', a => a.days === 0], [`🟡 ภายใน ${days} วัน`, a => a.days > 0]];

  groups.forEach(([title, filterFn]) => {
    const list = A.filter(filterFn);
    if (!list.length) return;
    widgets.push({ textParagraph: { text: `<b>${title}</b>` } });
    list.forEach(a => {
      let desc = `• <b>${a.name}</b>\n  ยอด: <b>${baht(a.amount)}</b> (ครบ ${dLabel(a.due)}${a.days < 0 ? `, เกิน ${-a.days} วัน` : a.days > 0 ? `, อีก ${a.days} วัน` : ''})`;
      if (a.auto) desc += '\n  <i>(ตัดบัญชีอัตโนมัติ)</i>';
      if (a.detail) desc += `\n  ${a.detail}`;
      widgets.push({ textParagraph: { text: desc } });
    });
  });

  widgets.push({ divider: {} });
  widgets.push({ textParagraph: { text: `💰 <b>รวมที่ต้องเตรียมทั้งหมด:</b> ${baht(sum(A))}` } });
  if (buttons.length) widgets.push({ buttonList: { buttons } });

  return {
    cardsV2: [{
      cardId: 'alerts_card',
      card: {
        header: { title: '🔔 แจ้งเตือนครบกำหนดชำระ', subtitle: `อัปเดต ณ ${dLabel(ref)}` },
        sections: [{ widgets }]
      }
    }]
  };
}

export function buildWeekly(S, ref) {
  const to = addDays(ref, -1), from = addDays(ref, -7), r = rangeSum(S, from, to);
  const [y, m] = to.split('-').map(Number), bud = (+S.settings.varBudget || 0) * 7 / dim(y, m), pct = bud ? r.vari / bud * 100 : 0;
  const mtd = rangeSum(S, ymOf(ref) + '-01', ref), next = alerts(S, ref).filter(a => a.days >= 0 && a.days <= 7);

  const topText = r.top.slice(0, 3).map((c, i) => `${i + 1}. ${c[0]} (${baht(c[1])})`).join(' • ') || '-';

  const widgets = [
    { textParagraph: { text: `🗓️ <b>ช่วงวันที่:</b> ${dLabel(from)} – ${dLabel(to)}` } },
    { divider: {} },
    { textParagraph: { text: `💵 รายรับ: <b>${baht(r.inc)}</b>\n💸 รายจ่ายรวม: <b>${baht(r.exp)}</b>\n&nbsp;&nbsp;&nbsp;&nbsp;• คงที่: ${baht(r.fix)}\n&nbsp;&nbsp;&nbsp;&nbsp;• ผันผวน: ${baht(r.vari)}\n&nbsp;&nbsp;&nbsp;&nbsp;• ผ่อนบัตร: ${baht(r.inst)}\n${r.net >= 0 ? '🟢' : '🔴'} คงเหลือสุทธิ: <b>${baht(r.net)}</b>` } },
    { textParagraph: { text: `🎯 <b>งบผันผวนสัปดาห์:</b> ${baht(bud)}<br>ใช้ไป ${pct.toFixed(0)}% ${pct > 100 ? '⚠️ <b>(เกินงบ)</b>' : '✅ <b>(อยู่ในงบ)</b>'}` } },
    { textParagraph: { text: `🏷️ <b>หมวดที่ใช้มากสุด:</b><br>${topText}` } },
    { divider: {} },
    { textParagraph: { text: `📆 <b>เดือน ${ymLabel(ymOf(ref))} ถึงวันนี้:</b><br>รับ ${baht(mtd.inc)} | จ่าย ${baht(mtd.exp)} | เหลือ <b>${baht(mtd.net)}</b><br>📌 ต้องจ่ายใน 7 วันนี้: ${next.length} รายการ (<b>${baht(sum(next))}</b>)` } }
  ];

  const buttons = createAppButton();
  if (buttons.length) widgets.push({ buttonList: { buttons } });

  return {
    cardsV2: [{
      cardId: 'weekly_card',
      card: {
        header: { title: '📅 รายงานประจำสัปดาห์', subtitle: 'สรุปสถานการณ์การเงินรอบ 7 วันที่ผ่านมา' },
        sections: [{ widgets }]
      }
    }]
  };
}

export function buildMonthly(S, ym, ref, partial = false) {
  const a = monthAgg(S, ym), rate = a.inc ? a.net / a.inc * 100 : 0, cs = catSpend(S, ym), B = S.settings.budgets || {};
  const top = Object.entries(cs).sort((x, y) => y[1] - x[1]).slice(0, 5), over = Object.entries(cs).filter(([c, v]) => B[c] && v > B[c]);
  const nx = addYM(ym, 1), debt = sum((S.inst || []).map(i => instCalc(i, ref)), i => i.remain);

  const topText = top.map((c, i) => `${i + 1}. ${c[0]}: ${baht(c[1])}`).join('<br>') || '-';
  const overText = over.map(([c, v]) => `• ${c}: ${baht(v)} / งบ ${baht(B[c])}`).join('<br>') || 'ไม่มีหมวดเกินงบ 🎉';

  const widgets = [
    { textParagraph: { text: `💵 รายรับ: <b>${baht(a.inc)}</b>\n💸 รายจ่ายรวม: <b>${baht(a.exp)}</b>\n&nbsp;&nbsp;&nbsp;&nbsp;• คงที่: ${baht(a.fix)}\n&nbsp;&nbsp;&nbsp;&nbsp;• ผันผวน: ${baht(a.vari)}\n&nbsp;&nbsp;&nbsp;&nbsp;• ผ่อนบัตร: ${baht(a.inst)}\n${a.net >= 0 ? '🟢' : '🔴'} คงเหลือสุทธิ: <b>${baht(a.net)}</b> (เงินเหลือ ${rate.toFixed(1)}% ${rate >= 20 ? '✅' : '⚠️ เป้า 20%'})` } },
    { textParagraph: { text: `🏦 ยอดยกไปเดือนหน้า: <b>${baht(ledgerClose(S, ym))}</b>` } },
    { divider: {} },
    { textParagraph: { text: `🏷️ <b>หมวดที่ใช้เงินสูงสุด:</b><br>${topText}` } },
    { textParagraph: { text: `⚠️ <b>หมวดที่ใช้เกินงบ:</b><br>${overText}` } },
    { divider: {} },
    { textParagraph: { text: `💳 ภาระผ่อน ${ymLabel(nx)}: <b>${baht(instInMonth(S, nx))}</b><br>📉 หนี้ผ่อนคงเหลือรวม: ${baht(debt)}` } },
  ];

  if (S.goals?.length) {
    const goalsText = S.goals.map(g => `• ${g.name}: ${(g.saved / g.target * 100).toFixed(0)}% (${baht(g.saved)} / ${baht(g.target)})`).join('<br>');
    widgets.push({ textParagraph: { text: `🎯 <b>เป้าหมายการออม:</b><br>${goalsText}` } });
  }

  const buttons = createAppButton();
  if (buttons.length) widgets.push({ buttonList: { buttons } });

  return {
    cardsV2: [{
      cardId: 'monthly_card',
      card: {
        header: { title: `📊 รายงานประจำเดือน ${ymLabel(ym)}${partial ? ' (ถึงวันนี้)' : ''}`, subtitle: 'สรุปภาพรวมและสถานะการเงินประจำเดือน' },
        sections: [{ widgets }]
      }
    }]
  };
}

export async function sendChat(cardData) {
  const url = env('GOOGLE_CHAT_WEBHOOK');
  if (!url) throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_CHAT_WEBHOOK');

  // รองรับทั้งแบบส่งข้อความธรรมดา (string) และแบบ Card V2 (object)
  const body = typeof cardData === 'string' ? { text: cardData } : cardData;

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body)
  });
}