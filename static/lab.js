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

function paint() {
  const s = S.subject;
  el('clock').textContent = S.clock;
  el('subj-doing').textContent = s.alive ? s.doing : 'not moving';
  el('thr').textContent = S.fork_threshold.toFixed(2);
  el('counts').textContent = `${S.forks} ties · ${S.consulted} asked`;
  el('counts').title = `The scores came out level ${S.forks} times. `
    + (S.mind_on ? `The mind was asked ${S.consulted} of those.`
                 : 'The mind is off, so all of them broke on score.');
  el('mind').textContent = 'mind: ' + (S.mind_on ? 'on' : 'off');
  el('mind').classList.toggle('on', S.mind_on);
  el('pause').textContent = S.running ? 'pause' : 'resume';

  el('needs').innerHTML = s.needs.map(n => `
    <div class="need" title="${esc(n.note)}">
      <span>${esc(n.label)}</span>
      <div class="track"><div class="fill" style="width:${n.level * 100}%;background:${tone(n.level)}"></div></div>
      <span class="num">${Math.round(n.level * 100)}</span>
    </div>`).join('');

  const live = S.table.filter(r => r.score !== null);
  const gap = live.length > 1 ? live[0].score - live[1].score : 1;
  const tied = live.length > 1 && gap < S.fork_threshold && live[0].score >= S.stakes;
  el('tablenote').textContent = !live.length ? ''
    : tied ? `level — within ${gap.toFixed(3)}`
    : live[0].score < S.stakes ? 'nothing much at stake'
    : `clear by ${gap.toFixed(2)}`;
  el('table').innerHTML = S.table.map((r, i) => {
    const dead = r.score === null;
    return `<div class="opt ${i === 0 && !dead ? 'top' : ''} ${dead ? 'dead' : ''}">
        <span class="nm">${esc(r.label)}</span>
        <div class="track"><div class="bar" style="width:${dead ? 0 : r.score * 100}%"></div></div>
        <span class="val">${dead ? '—' : r.score.toFixed(2)}</span>
        <span class="why">${esc(r.why)}</span>
      </div>`;
  }).join('') + (tied
    ? `<div class="tie">These are level. ${S.mind_on
        ? 'The mind decides this one.' : 'Nothing to break the tie but the order.'}</div>` : '');

  // your side of the glass
  const ctrl = S.things.filter(t => t.controllable);
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
  if (data.error) { alert(data.error); return; }
  S = data; paint();
}

el('supply').addEventListener('click', e => {
  const b = e.target.closest('[data-supply]');
  if (!b) return;
  const t = S.things.find(x => x.key === b.dataset.supply);
  post('/api/lab/supply', { key: b.dataset.supply, on: !(t && t.enabled) });
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
