/* The observation window.
   Left: the room, drawn. Right: the instrument panel — the scores are shown
   rather than the decision asserted. Under the room: the palette, because the
   room starts empty and everything in it is something you put there. */

const el = id => document.getElementById(id);
const canvas = el('room'), ctx = canvas.getContext('2d');
const TILE = 34;
let S = null, logSig = '', smooth = null, tool = null, hover = null;

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

/* ---------- drawing ---------- */

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Each thing draws itself into a TILE-sized box centred on (0,0). Kept small
// and flat on purpose — the room should read at a glance, not be admired.
const ART = {
  tap(c) {
    c.fillStyle = '#8d99a3'; rr(-4, -10, 8, 7, 2); c.fill();
    c.fillRect(-2, -4, 4, 8);
    c.fillStyle = '#6d7a85'; rr(-9, 4, 18, 6, 2); c.fill();
    c.fillStyle = '#4d94b8'; rr(-6, 6, 12, 3, 1.5); c.fill();
  },
  dispenser(c) {
    c.fillStyle = '#7d8590'; rr(-11, -10, 22, 16, 3); c.fill();
    c.fillStyle = '#161c20'; rr(-8, -6, 16, 9, 2); c.fill();
    c.fillStyle = '#b8a05a'; rr(-6, 0, 12, 3, 1.5); c.fill();
  },
  bed(c, t) {
    c.fillStyle = '#5b4a3c'; rr(-13, -8, 26, 17, 3); c.fill();
    c.fillStyle = t && t.state && t.state.bedded ? '#9fb4a8' : '#3b4247';
    rr(-11, -6, 22, 13, 2); c.fill();
    c.fillStyle = '#cdd6d1'; rr(-10, -5, 8, 11, 2); c.fill();
  },
  chair(c) {
    c.fillStyle = '#6b5642'; rr(-8, -10, 16, 5, 2); c.fill();
    rr(-9, -3, 18, 6, 2); c.fill();
    c.fillStyle = '#4a3c2e'; c.fillRect(-8, 3, 3, 7); c.fillRect(5, 3, 3, 7);
  },
  table(c) {
    c.fillStyle = '#7a6449'; rr(-14, -6, 28, 7, 2); c.fill();
    c.fillStyle = '#54452f'; c.fillRect(-12, 1, 3, 9); c.fillRect(9, 1, 3, 9);
  },
  lamp(c, t) {
    const on = !t || t.enabled;
    if (on) {
      const g = c.createRadialGradient(0, 0, 2, 0, 0, 22);
      g.addColorStop(0, 'rgba(255,226,150,.45)');
      g.addColorStop(1, 'rgba(255,226,150,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 22, 0, 7); c.fill();
    }
    c.fillStyle = '#8d99a3'; c.fillRect(-1, -12, 2, 6);
    c.fillStyle = on ? '#ffe9a8' : '#3f474c';
    c.beginPath(); c.moveTo(-9, 2); c.lineTo(9, 2); c.lineTo(5, -6);
    c.lineTo(-5, -6); c.closePath(); c.fill();
  },
  crate(c, t) {
    const open = t && t.state && t.state.open;
    c.fillStyle = '#7d6440'; rr(-11, -9, 22, 19, 2); c.fill();
    c.fillStyle = '#5e4a2e';
    c.fillRect(-11, -2, 22, 2); c.fillRect(-1, -9, 2, 19);
    if (open) { c.fillStyle = '#c9d3cd'; rr(-7, -6, 14, 6, 1.5); c.fill(); }
    else { c.fillStyle = '#9a7f52'; rr(-11, -11, 22, 4, 1.5); c.fill(); }
  },
  button(c) {
    c.fillStyle = '#4b545a'; rr(-8, -8, 16, 16, 3); c.fill();
    c.fillStyle = '#c25b45'; c.beginPath(); c.arc(0, 0, 5, 0, 7); c.fill();
    c.fillStyle = '#e08672'; c.beginPath(); c.arc(-1.4, -1.4, 2, 0, 7); c.fill();
  },
  'wall marks'(c, t) {
    c.strokeStyle = '#8b949c'; c.lineWidth = 1.4;
    const n = Math.min(14, (t && t.state && t.state.marks) || 19);
    for (let i = 0; i < n; i++) {
      const x = -11 + (i % 7) * 3.2, y = i < 7 ? -5 : 3;
      c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x + 1.4, y + 4); c.stroke();
    }
  },
  drain(c) {
    c.fillStyle = '#2a3237'; c.beginPath(); c.arc(0, 0, 9, 0, 7); c.fill();
    c.strokeStyle = '#495359'; c.lineWidth = 1.4;
    for (let i = -6; i <= 6; i += 4) {
      c.beginPath(); c.moveTo(-7, i); c.lineTo(7, i); c.stroke();
    }
  },
  door(c) {
    c.fillStyle = '#4a5157'; rr(-10, -11, 20, 22, 2); c.fill();
    c.fillStyle = '#333a3f'; rr(-7, -8, 14, 16, 1.5); c.fill();
    c.fillStyle = '#9aa4ab'; c.fillRect(4, -1, 3, 3);
  },
  wire(c) {
    c.strokeStyle = '#9d9384'; c.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(-2 + i * 1.6, i - 2, 6 - i * 0.7, 0.4 + i, 4.6 + i);
      c.stroke();
    }
  },
  papers(c) {
    for (let i = 3; i >= 0; i--) {
      c.fillStyle = ['#d9d3c4', '#cdc7b8', '#c2bcad', '#b6b0a1'][i];
      rr(-10 + i, -8 + i * 2.2, 20, 12, 1); c.fill();
    }
    c.strokeStyle = '#8d8778'; c.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      c.beginPath(); c.moveTo(-6, -3 + i * 3); c.lineTo(6, -3 + i * 3); c.stroke();
    }
  },
  plant(c) {
    c.fillStyle = '#8a6a4c'; c.beginPath();
    c.moveTo(-7, 2); c.lineTo(7, 2); c.lineTo(5, 11); c.lineTo(-5, 11);
    c.closePath(); c.fill();
    c.fillStyle = '#5f8f63';
    for (const a of [-0.9, -0.2, 0.5]) {
      c.beginPath(); c.ellipse(Math.sin(a) * 5, -4 + Math.cos(a) * 2, 5.5, 2.6, a, 0, 7);
      c.fill();
    }
  },
};

function drawThing(t) {
  const px = t.x * TILE + TILE / 2, py = t.y * TILE + TILE / 2;
  ctx.save();
  ctx.translate(px, py);
  if (!t.known) ctx.globalAlpha = 0.34;      // it hasn't worked this out yet
  else if (t.spent) ctx.globalAlpha = 0.5;
  const art = ART[t.kind];
  if (art) art(ctx, t);
  else { ctx.fillStyle = '#8d99a3'; rr(-8, -8, 16, 16, 3); ctx.fill(); }
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = t.known ? (t.spent ? '#7b5b4e' : '#93a7ae') : '#4d585e';
  ctx.fillText(t.known ? t.label : '?', px, py + TILE / 2 - 1);
  // A supply that has run dry, from your side of the glass only.
  if (t.known && t.cap) {
    const w = TILE - 12, f = Math.max(0, Math.min(1, (t.uses || 0) / t.cap));
    ctx.fillStyle = '#11171a'; ctx.fillRect(px - w / 2, py - TILE / 2 + 2, w, 3);
    ctx.fillStyle = f > 0.3 ? '#4d94b8' : '#a8552f';
    ctx.fillRect(px - w / 2, py - TILE / 2 + 2, w * f, 3);
  }
}

function draw() {
  if (!S) return requestAnimationFrame(draw);
  if (canvas.width !== S.w * TILE) {
    canvas.width = S.w * TILE;
    canvas.height = S.h * TILE;
  }
  for (let y = 0; y < S.h; y++) {
    for (let x = 0; x < S.w; x++) {
      const c = S.rows[y][x];
      if (c === '#') {
        ctx.fillStyle = '#161d21';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        ctx.fillStyle = '#1e272c';
        ctx.fillRect(x * TILE, y * TILE, TILE, 3);
      } else if (c === '=') {
        const g = ctx.createLinearGradient(x * TILE, 0, x * TILE + TILE, 0);
        g.addColorStop(0, '#2c4854'); g.addColorStop(1, '#3d6172');
        ctx.fillStyle = g;
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(x * TILE + 3, y * TILE, 2, TILE);
      } else {
        ctx.fillStyle = (x + y) % 2 ? '#2a343a' : '#2f3a40';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        ctx.strokeStyle = 'rgba(0,0,0,.20)';
        ctx.strokeRect(x * TILE + .5, y * TILE + .5, TILE - 1, TILE - 1);
      }
    }
  }

  for (const t of S.things) drawThing(t);

  // the subject
  const s = S.subject;
  if (!smooth) smooth = { x: s.x, y: s.y };
  smooth.x += (s.x - smooth.x) * 0.18;
  smooth.y += (s.y - smooth.y) * 0.18;
  const px = smooth.x * TILE + TILE / 2, py = smooth.y * TILE + TILE / 2;
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath(); ctx.ellipse(px, py + 11, 10, 4, 0, 0, 7); ctx.fill();
  const down = !s.alive || s.verb === 'sleep' || (s.verb === 'break' && s.by === 'break');
  ctx.save();
  ctx.translate(px, py);
  if (down) ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = !s.alive ? '#6d4438' : s.verb === 'break' ? '#c76a4e' : '#f2c14e';
  rr(-5.5, -4, 11, 14, 3); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -9, 5.5, 0, 7); ctx.fill();
  if (s.carrying) {                   // it has something in its hands
    ctx.fillStyle = '#cdd6d1'; rr(-6, 1, 12, 5, 1.5); ctx.fill();
  }
  ctx.restore();

  // night, and whatever light there is in it
  if (S.dark) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,10,14,.62)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-out';
    for (const t of S.things) {
      if (t.kind !== 'lamp' || !t.enabled) continue;
      const g = ctx.createRadialGradient(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2,
        4, t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, TILE * 4);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();
  }

  // where the thing you're holding would go
  if (hover && tool) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    if (tool === 'remove') {
      ctx.strokeStyle = '#e0603f'; ctx.lineWidth = 2;
      ctx.strokeRect(hover.x * TILE + 3, hover.y * TILE + 3, TILE - 6, TILE - 6);
    } else {
      ctx.translate(hover.x * TILE + TILE / 2, hover.y * TILE + TILE / 2);
      const art = ART[tool];
      if (art) art(ctx, null);
    }
    ctx.restore();
  }
  requestAnimationFrame(draw);
}

/* ---------- panel ---------- */

function tone(v) { return v > 0.6 ? '#6bbf8a' : v > 0.3 ? '#d8a44e' : '#e0603f'; }

const WHO = {
  thought: ['decided', 'The head chose this.'],
  habit: ['habit', 'It has done this often enough to stop deciding it.'],
  reflex: ['reflex', 'The body did this. Nothing was decided.'],
  urge: ['', 'What it wanted most.'],
  break: ['breaking', 'Mood took the body away.'],
};

function paint() {
  const s = S.subject;
  el('clock').textContent = S.clock + (S.dark ? ' · dark' : '');
  el('day').textContent = 'day ' + S.day;
  el('subj-doing').textContent = s.alive ? s.doing : 'not moving';
  const who = WHO[s.by];
  const byEl = el('by');
  byEl.textContent = S.thinking ? 'thinking…' : who ? who[0] : '';
  byEl.title = S.thinking ? `Because: ${S.thinking}` : who ? who[1] : '';
  byEl.className = 'who ' + (S.thinking ? 'thinking' : s.by || '');
  el('mind').textContent = 'head: ' + (S.mind_on ? 'on' : 'off');
  el('mind').classList.toggle('on', S.mind_on);
  el('pause').textContent = S.running ? 'pause' : 'resume';
  el('blackout').classList.toggle('on', !!S.blackout);
  el('seedtag').textContent = '#' + S.seed;

  const miss = S.missing || [];
  const warn = el('warn');
  warn.classList.toggle('hidden', !miss.length || !s.alive);
  warn.textContent = miss.length ? 'nothing in here for ' + miss.join(' or ') : '';

  el('traits').innerHTML = (s.traits || []).map(t =>
    `<span class="trait" title="${esc(t.note)}">${esc(t.label)}</span>`).join('');

  el('needs').innerHTML = s.needs.map(n => `
    <div class="need" title="${esc(n.note)}">
      <span>${esc(n.label)}</span>
      <div class="track"><div class="fill" style="width:${n.level * 100}%;background:${tone(n.level)}"></div></div>
      <span class="num">${Math.round(n.level * 100)}</span>
    </div>`).join('');

  const mood = s.mood || { level: 0.5, state: '', thoughts: [] };
  el('moodstate').textContent = mood.state;
  const mf = el('moodbar').firstElementChild;
  mf.style.width = (mood.level * 100) + '%';
  mf.style.background = tone(mood.level);
  el('thoughts').innerHTML = mood.thoughts.length
    ? mood.thoughts.map(t => `<div class="th ${t.delta < 0 ? 'bad' : 'good'}">
        <span>${esc(t.label)}</span>
        <b>${t.delta > 0 ? '+' : ''}${t.delta.toFixed(2)}</b></div>`).join('')
    : '<div class="none">Nothing in particular either way.</div>';

  el('story').innerHTML = (s.story || []).slice().reverse().map(r => `
    <div class="ev ${esc(r.by)}"><span class="t">${r.t}</span>
      <span class="x">${esc(r.label)}${r.why ? ` — ${esc(r.why)}` : ''}</span>
      <span class="tag2">${WHO[r.by] ? WHO[r.by][0] : ''}</span></div>`).join('')
    || '<div class="none">Nothing yet.</div>';

  const live = S.table.filter(r => r.score !== null);
  el('tablenote').textContent = !live.length ? 'nothing it can do'
    : S.mind_on ? 'the head is not shown this' : '';
  const dead = S.table.filter(r => r.score === null);
  el('table').innerHTML = live.map((r, i) => `
      <div class="opt ${i === 0 ? 'top' : ''} ${s.verb === r.key ? 'took' : ''}">
        <span class="nm">${esc(r.label)}</span>
        <div class="track"><div class="bar" style="width:${r.score * 100}%"></div></div>
        <span class="val">${r.score.toFixed(2)}</span>
        <span class="why">${esc(r.why)}</span>
      </div>`).join('')
    + (dead.length ? `<div class="cant"><b>can't:</b> ${
        dead.map(r => esc(r.label)).join(' · ')}</div>` : '');

  const ctrl = S.things.filter(t => t.controllable);
  el('supply').innerHTML = ctrl.map(t =>
    `<button data-supply="${t.id}" class="${t.enabled ? 'on' : 'off'}">${
      esc(t.known ? t.label : t.kind)}: ${t.enabled ? 'on' : 'cut'}</button>`).join('')
    || '<span class="none">Nothing in here to switch on or off.</span>';

  el('waiting').classList.toggle('hidden', !S.waiting);
  el('auto').checked = !!S.auto_honour;
  el('deals').innerHTML = (S.deals || []).map(d => `
    <div class="d">“${esc(d.said)}” <b>${Math.round(d.belief * 100)}% believed</b>
      · ${esc(d.state)}${d.tested ? ` · kept ${d.kept}/${d.tested}` : ' · never tested'}</div>`).join('');

  el('learned').innerHTML = s.learned.length
    ? s.learned.map(l => `<div>${esc(l)}</div>`).join('')
    : '<div class="none">Nothing yet. It only just woke up.</div>';

  el('habits').innerHTML = (S.habits || []).length
    ? S.habits.map(h => `<div class="ev"><span class="x">when ${esc(h.when)} → ${
        esc(h.do)}</span><span class="tag2">${h.n}×</span></div>`).join('')
    : '<div class="none">Habits only form with a head attached — they are what '
      + 'it stops needing to decide.</div>';

  paintPalette();

  const sig = S.log.length && S.log[S.log.length - 1].n;
  if (sig !== logSig) {
    logSig = sig;
    const box = el('log');
    box.innerHTML = S.log.map(e =>
      `<div class="line ${e.kind}"><span class="t">${e.t}</span><span class="x">${esc(e.text)}</span></div>`).join('');
    box.scrollTop = box.scrollHeight;
  }
}

let palSig = '';
function paintPalette() {
  const cat = S.catalogue || [];
  const sig = cat.map(c => c.kind).join(',');
  if (sig !== palSig) {
    palSig = sig;
    const groups = {};
    for (const c of cat) (groups[c.group] = groups[c.group] || []).push(c);
    el('palrows').innerHTML = Object.entries(groups).map(([g, items]) => `
      <div class="palrow"><span class="glabel">${esc(g)}</span>
        ${items.map(c => `<button class="tool" data-kind="${esc(c.kind)}"
            title="${esc(c.blurb)}">${esc(c.label)}</button>`).join('')}
      </div>`).join('');
  }
  for (const b of document.querySelectorAll('#palette .tool')) {
    b.classList.toggle('picked',
      (b.dataset.kind && b.dataset.kind === tool) ||
      (b.id === 'tool-remove' && tool === 'remove'));
  }
  el('palnote').textContent = !tool ? 'Pick a thing, then click the floor.'
    : tool === 'remove' ? 'Click something in the room to take it away.'
    : 'Click the floor to put it down. Esc to stop.';
}

/* ---------- talking to the server ---------- */

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

function cell(ev) {
  const b = canvas.getBoundingClientRect();
  return {
    x: Math.floor((ev.clientX - b.left) / (b.width / S.w)),
    y: Math.floor((ev.clientY - b.top) / (b.height / S.h)),
  };
}

canvas.addEventListener('mousemove', e => { if (S) hover = cell(e); });
canvas.addEventListener('mouseleave', () => { hover = null; });
canvas.addEventListener('click', e => {
  if (!S || !tool) return;
  const c = cell(e);
  if (tool === 'remove') {
    const t = S.things.find(t => Math.round(t.x) === c.x && Math.round(t.y) === c.y);
    if (t) post('/api/lab/remove', { id: t.id });
    return;
  }
  post('/api/lab/place', { kind: tool, x: c.x, y: c.y });
});

el('palrows').addEventListener('click', e => {
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  tool = tool === b.dataset.kind ? null : b.dataset.kind;
  paintPalette();
});
el('tool-remove').addEventListener('click', () => {
  tool = tool === 'remove' ? null : 'remove'; paintPalette();
});
el('tool-none').addEventListener('click', () => { tool = null; paintPalette(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { tool = null; paintPalette(); }
});

el('supply').addEventListener('click', e => {
  const b = e.target.closest('[data-supply]');
  if (!b) return;
  const t = S.things.find(x => x.id === b.dataset.supply);
  post('/api/lab/supply', { id: b.dataset.supply, on: !(t && t.enabled) });
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
el('waiting').addEventListener('click', e => {
  const b = e.target.closest('[data-keep]');
  if (b) post('/api/lab/honour', { keep: b.dataset.keep === '1' });
});
el('auto').addEventListener('change', () => post('/api/lab/auto', { on: el('auto').checked }));
el('mind').addEventListener('click', () => post('/api/lab/mind', { on: !S.mind_on }));
el('pause').addEventListener('click', () => post('/api/lab/pause'));
el('blackout').addEventListener('click', () => post('/api/lab/blackout'));
el('reset').addEventListener('click', e => {
  smooth = null; logSig = ''; palSig = '';
  // Shift for a bare room — nothing in it at all, and it will die in six
  // hours unless you put water somewhere.
  post('/api/lab/reset', { furnished: !e.shiftKey });
});

poll();
setInterval(poll, 400);
requestAnimationFrame(draw);
