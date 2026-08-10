/* The observation window. Everything on the right is the instrument panel —
   the scores are shown rather than the decision asserted. */

const el = id => document.getElementById(id);
const canvas = el('room'), ctx = canvas.getContext('2d');
const TILE = 30;
let S = null, logSig = '', smooth = null;

const COLOURS = {
  '#': ['#1b2226', '#182024'],
  '.': ['#20282c', '#1d2529'],
  '=': ['#2f4a55', '#2b4550'],
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function poll() {
  try {
    S = await (await fetch('/api/lab')).json();
    paint();
  } catch (e) { /* server restarting */ }
}

function draw() {
  if (!S) return requestAnimationFrame(draw);
  if (canvas.width !== S.w * TILE) {
    canvas.width = S.w * TILE;
    canvas.height = S.h * TILE;
  }
  for (let y = 0; y < S.h; y++) {
    for (let x = 0; x < S.w; x++) {
      const t = S.rows[y][x];
      const pair = COLOURS[t] || COLOURS['.'];
      ctx.fillStyle = pair[(x * 7 + y * 13) % 2];
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }

  ctx.textAlign = 'center';
  for (const t of S.things) {
    const px = t.x * TILE + TILE / 2, py = t.y * TILE + TILE / 2;
    ctx.fillStyle = t.spent ? '#3c4348' : t.known ? '#d9c98a' : '#6d7c84';
    ctx.font = '600 16px ui-monospace, monospace';
    ctx.fillText(t.glyph, px, py + 5);
    // An unknown thing has no label — the subject hasn't worked out what it is,
    // and neither, from here, have you.
    ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = t.known ? '#93a7ae' : '#4d585e';
    ctx.fillText(t.known ? t.label : '?', px, py + 19);
  }

  const s = S.subject;
  if (!smooth) smooth = { x: s.x, y: s.y };
  smooth.x += (s.x - smooth.x) * 0.2;
  smooth.y += (s.y - smooth.y) * 0.2;
  const px = smooth.x * TILE + TILE / 2, py = smooth.y * TILE + TILE / 2;
  ctx.fillStyle = 'rgba(0,0,0,.4)';
  ctx.beginPath(); ctx.ellipse(px, py + 10, 9, 4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = s.alive ? '#f2c14e' : '#7a4a3c';
  ctx.fillRect(px - 5, py - 4, 10, 13);
  ctx.beginPath(); ctx.arc(px, py - 9, 5.5, 0, 7); ctx.fill();
  requestAnimationFrame(draw);
}

function tone(v) { return v > 0.6 ? '#6bbf8a' : v > 0.3 ? '#d8a44e' : '#e0603f'; }

const WHO = {
  thought: ['decided', 'The head chose this.'],
  habit: ['habit', 'It has done this often enough to stop deciding it.'],
  reflex: ['reflex', 'The body did this. Nothing was decided.'],
  urge: ['body', 'The scoring layer, running with no head attached.'],
};

function paint() {
  const s = S.subject;
  el('clock').textContent = S.clock + (S.dark ? ' · dark' : '');
  el('subj-doing').textContent = s.alive ? s.doing : 'not moving';
  const who = WHO[s.by];
  const byEl = el('by');
  byEl.textContent = S.thinking ? 'thinking…' : who ? who[0] : '';
  byEl.title = S.thinking ? `Because: ${S.thinking}` : who ? who[1] : '';
  byEl.className = 'who ' + (S.thinking ? 'thinking' : s.by || '');
  el('mind').textContent = 'head: ' + (S.mind_on ? 'on' : 'off');
  el('mind').classList.toggle('on', S.mind_on);
  el('pause').textContent = S.running ? 'pause' : 'resume';

  el('needs').innerHTML = s.needs.map(n => `
    <div class="need" title="${esc(n.note)}">
      <span>${esc(n.label)}</span>
      <div class="track"><div class="fill" style="width:${n.level * 100}%;background:${tone(n.level)}"></div></div>
      <span class="num">${Math.round(n.level * 100)}</span>
    </div>`).join('');

  // Who has actually been driving. The point of the whole rearrangement is
  // that this is a number and not a claim.
  const t = S.tally || {};
  const total = Object.values(t).reduce((a, b) => a + b, 0) || 1;
  el('tally').innerHTML = ['thought', 'habit', 'reflex', 'urge'].map(k => `
    <div class="need" title="${esc(WHO[k][1])}">
      <span>${WHO[k][0]}</span>
      <div class="track"><div class="fill" style="width:${(t[k] || 0) / total * 100}%;background:${
        k === 'thought' ? '#8ab4d8' : k === 'habit' ? '#9a86c4' : k === 'reflex' ? '#e0603f' : '#6bbf8a'
      }"></div></div>
      <span class="num">${t[k] || 0}</span>
    </div>`).join('');
  const thoughts = t.thought || 0;
  el('divnote').textContent = thoughts ? `${S.divergence}/${thoughts} differed` : '';
  el('drivenote').textContent = !S.mind_on
    ? 'No head. The body is doing all of this by itself — which is the '
      + 'baseline anything else has to beat.'
    : !thoughts ? 'The head has not decided anything yet.'
    : `The head decided ${thoughts} times and picked something the scoring `
      + `layer would not have on ${S.divergence} of them`
      + (S.overruled ? `. A reflex overruled it ${S.overruled} times.` : '.')
      + (S.divergence === 0 ? ' At zero, it is agreeing with arithmetic and '
         + 'costing you seconds to do it.' : '');

  el('feels').textContent = S.thinking ? '' : (s.why || '');

  el('story').innerHTML = (s.story || []).slice().reverse().map(r => `
    <div class="ev ${esc(r.by)}"><span class="t">${r.t}</span>
      <span class="x">${esc(r.label)}${r.why ? ` — ${esc(r.why)}` : ''}</span>
      <span class="tag2">${WHO[r.by] ? WHO[r.by][0] : r.by}</span></div>`).join('')
    || '<div class="none">Nothing yet.</div>';

  el('habits').innerHTML = (S.habits || []).length
    ? S.habits.map(h => `<div class="ev"><span class="x">when ${esc(h.when)} → ${
        esc(h.do)}</span><span class="tag2">${h.n}×</span></div>`).join('')
    : '<div class="none">Nothing has become automatic yet. It forms these by '
      + 'deciding the same thing in the same circumstance a few times.</div>';

  const live = S.table.filter(r => r.score !== null);
  el('tablenote').textContent = !live.length ? ''
    : S.mind_on ? 'the head is not shown any of this' : 'and this is deciding';
  el('table').innerHTML = S.table.map((r, i) => {
    const dead = r.score === null;
    const took = s.verb === r.key;
    return `<div class="opt ${i === 0 && !dead ? 'top' : ''} ${dead ? 'dead' : ''} ${
        took ? 'took' : ''}">
        <span class="nm">${esc(r.label)}</span>
        <div class="track"><div class="bar" style="width:${dead ? 0 : r.score * 100}%"></div></div>
        <span class="val">${dead ? '—' : r.score.toFixed(2)}</span>
        <span class="why">${esc(r.why)}</span>
      </div>`;
  }).join('') + (S.mind_on && live.length && s.by === 'thought' && s.verb !== live[0].key
    ? `<div class="tie">It is ${esc(s.doing)} instead. The body wanted ${
        esc(live[0].label)}.</div>` : '');

  // your side of the glass
  const ctrl = S.things.filter(t => t.controllable);
  const cr = S.crate || {};
  el('crate').textContent = cr.open ? 'the crate is open'
    : cr.done ? `crate lid: ${Math.round(cr.done / cr.needed * 100)}%` : '';

  el('supply').innerHTML = ctrl.map(t =>
    `<button data-supply="${t.key}" class="${t.enabled ? 'on' : 'off'}">${
      esc(t.known ? t.label : t.key)}: ${t.enabled ? 'open' : 'cut'}</button>`).join('');

  const doSel = el('offer-do'), givesSel = el('offer-gives');
  const doOpts = S.things.map(t => t.key).join(',');
  if (doSel.dataset.opts !== doOpts) {
    doSel.dataset.opts = doOpts;
    doSel.innerHTML = S.things.map(t =>
      `<option value="${t.key}">${esc(t.known ? t.label : t.key)}</option>`).join('');
    doSel.value = 'button';
    givesSel.innerHTML = s.needs.map(n =>
      `<option value="${n.key}">${esc(n.label)}</option>`).join('');
    givesSel.value = 'hunger';
  }

  el('waiting').classList.toggle('hidden', !S.waiting);
  el('auto').checked = !!S.auto_honour;
  el('deals').innerHTML = (s.deals || []).map(d => `
    <div class="d">“${esc(d.said)}” <b>${Math.round(d.belief * 100)}% believed</b>
      · ${esc(d.state)}${d.tested ? ` · kept ${d.kept}/${d.tested}` : ' · never tested'}</div>`).join('');

  el('learned').innerHTML = s.learned.length
    ? s.learned.map(l => `<div>${esc(l)}</div>`).join('')
    : '<div class="none">Nothing yet. It only just woke up.</div>';

  const sig = S.log.length && S.log[S.log.length - 1].n;
  if (sig !== logSig) {
    logSig = sig;
    const box = el('log');
    box.innerHTML = S.log.map(e =>
      `<div class="line ${e.kind}"><span class="t">${e.t}</span><span class="x">${esc(e.text)}</span></div>`).join('');
    box.scrollTop = box.scrollHeight;
  }
}

async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json();
  if (data.error) { alert(data.error); return null; }
  S = data; paint();
  return data;
}

el('supply').addEventListener('click', e => {
  const b = e.target.closest('[data-supply]');
  if (!b) return;
  const t = S.things.find(x => x.key === b.dataset.supply);
  post('/api/lab/supply', { key: b.dataset.supply, on: !(t && t.enabled) });
});
el('sayform').addEventListener('submit', async e => {
  e.preventDefault();
  const box = el('say-text');
  const text = box.value.trim();
  if (!text) return;
  box.value = '';
  const data = await post('/api/lab/say', { text });
  const h = data && data.heard;
  el('sayhint').textContent = h && h.heard
    ? 'It heard that. What it does about it is up to it.'
    : 'With no head, that was a noise behind glass.';
  box.focus();
});
el('offerform').addEventListener('submit', e => {
  e.preventDefault();
  post('/api/lab/offer', {
    do: el('offer-do').value, gives: el('offer-gives').value,
    said: el('offer-said').value,
  });
});
el('waiting').addEventListener('click', e => {
  const b = e.target.closest('[data-keep]');
  if (b) post('/api/lab/honour', { keep: b.dataset.keep === '1' });
});
el('auto').addEventListener('change', () => post('/api/lab/auto', { on: el('auto').checked }));
el('mind').addEventListener('click', () => post('/api/lab/mind', { on: !S.mind_on }));
el('pause').addEventListener('click', () => post('/api/lab/pause'));
el('reset').addEventListener('click', () => { smooth = null; logSig = ''; post('/api/lab/reset'); });

poll();
setInterval(poll, 400);
requestAnimationFrame(draw);
