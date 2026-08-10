/* Castaway — client. Renders the island, moves you around it, and shows what
   the model-driven survivors are saying and doing. */

const TILE = 26;
const SPEED = 4.2;              // tiles per second
const BLOCKED = new Set(['~', 'j', 'p', 'r', 'f', 'x']);

const canvas = document.getElementById('island');
const ctx = canvas.getContext('2d');
const el = id => document.getElementById(id);

let island = null;              // static map data
let S = null;                   // latest server snapshot
let me = { x: 16, y: 17 };
const keys = new Set();
const smooth = {};
let talking = false;
let filter = 'all';
let pinned = true;              // chat stuck to the bottom
let lastLogLen = 0;

// ---------------------------------------------------------------- boot

async function boot() {
  island = await (await fetch('/api/island')).json();
  canvas.width = island.width * TILE;
  canvas.height = island.height * TILE;
  const lm = island.landmarks.camp;
  me = { x: lm.x, y: lm.y };
  await poll();
  setInterval(poll, 420);
  requestAnimationFrame(frame);
  if (!localStorage.getItem('castaway-helped')) {
    el('help').classList.remove('hidden');
    localStorage.setItem('castaway-helped', '1');
  }
}

async function poll() {
  try {
    const r = await fetch(`/api/state?x=${me.x.toFixed(2)}&y=${me.y.toFixed(2)}`);
    S = await r.json();
    paintPanel();
  } catch (e) { /* server restarting; keep drawing */ }
}

// ---------------------------------------------------------------- input

const talkInput = () => el('talk');

addEventListener('keydown', e => {
  const sheetOpen = !el('settings').classList.contains('hidden') || !el('help').classList.contains('hidden');
  if (document.activeElement === talkInput()) {
    if (e.key === 'Escape') talkInput().blur();
    return;
  }
  if (sheetOpen) return;
  if (e.key === 'Enter') { talkInput().focus(); e.preventDefault(); return; }
  keys.add(e.key.toLowerCase());
  const verb = { e: 'gather', q: 'drink', f: 'eat', r: 'rest' }[e.key.toLowerCase()];
  if (verb) { act(verb); e.preventDefault(); }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function tileAt(x, y) {
  const row = island.rows[Math.round(y)];
  if (!row) return '~';
  return row[Math.round(x)] || '~';
}
const walkable = (x, y) => !BLOCKED.has(tileAt(x, y));

function move(dt) {
  if (!island || (S && (S.over || S.player.down))) return;
  let dx = 0, dy = 0;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;
  if (keys.has('w') || keys.has('arrowup')) dy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dy += 1;
  if (!dx && !dy) return;
  const len = Math.hypot(dx, dy) || 1;
  const nx = me.x + (dx / len) * SPEED * dt;
  const ny = me.y + (dy / len) * SPEED * dt;
  if (walkable(nx, me.y)) me.x = nx;
  if (walkable(me.x, ny)) me.y = ny;
}

// ---------------------------------------------------------------- drawing

const PALETTE = {
  '~': ['#123449', '#0f2c3f'], 'w': ['#2a6785', '#296078'],
  's': ['#d9c9a0', '#d2c096'], 'g': ['#3f6b41', '#3a6a3c'],
  'j': ['#254b2c', '#22462a'], 'p': ['#356b3f', '#31633a'],
  'r': ['#6a6a68', '#61615f'], 'h': ['#8a8a6d', '#838367'],
  'f': ['#3f8fb5', '#3a86ab'], 'x': ['#5a4632', '#53412e'],
  'c': ['#c2ac82', '#bba57b'],
};

function hash(x, y) { return ((x * 73856093) ^ (y * 19349663)) >>> 0; }

function drawMap() {
  for (let y = 0; y < island.height; y++) {
    for (let x = 0; x < island.width; x++) {
      const t = island.rows[y][x];
      const pair = PALETTE[t] || PALETTE['g'];
      ctx.fillStyle = pair[hash(x, y) % 2];
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);

      if (t === 'j' || t === 'p') {
        ctx.fillStyle = t === 'p' ? '#4f8a52' : '#1b3a20';
        ctx.beginPath();
        ctx.arc(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE * 0.42, 0, 7);
        ctx.fill();
        if (t === 'p') {
          ctx.fillStyle = '#8a6b3a';
          ctx.fillRect(x * TILE + TILE / 2 - 1.5, y * TILE + TILE / 2, 3, TILE * 0.4);
        }
      } else if (t === 'r') {
        ctx.fillStyle = '#4f4f4d';
        ctx.beginPath();
        ctx.arc(x * TILE + TILE / 2, y * TILE + TILE * 0.55, TILE * 0.34, 0, 7);
        ctx.fill();
      } else if (t === 'f') {
        ctx.fillStyle = '#7fd6f5';
        ctx.beginPath();
        ctx.arc(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE * 0.24, 0, 7);
        ctx.fill();
      } else if (t === 'g' && hash(x, y) % 7 === 0) {
        ctx.fillStyle = '#4a7a4c';
        ctx.fillRect(x * TILE + 6, y * TILE + 8, 4, 4);
      } else if (t === 's' && hash(x, y) % 11 === 0) {
        ctx.fillStyle = '#c9b78d';
        ctx.fillRect(x * TILE + 9, y * TILE + 11, 3, 3);
      } else if (t === 'x') {
        ctx.strokeStyle = '#3b2c1e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x * TILE + 3, y * TILE + TILE - 4);
        ctx.lineTo(x * TILE + TILE - 3, y * TILE + 5);
        ctx.stroke();
      }
    }
  }
}

function drawLandmarks() {
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const [name, l] of Object.entries(island.landmarks)) {
    const px = l.x * TILE + TILE / 2, py = l.y * TILE + TILE / 2;
    const harvests = island.harvest[name];
    const label = harvests ? `${name} · ${harvests.join('/')}` : name;
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(10,14,17,.66)';
    ctx.fillRect(px - w / 2, py - 23, w, 14);
    ctx.fillStyle = harvests ? '#d9e6ee' : '#9fb1bd';
    ctx.fillText(label, px, py - 13);
    ctx.strokeStyle = harvests ? 'rgba(217,230,238,.35)' : 'rgba(140,160,175,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, TILE * 1.1, 0, 7);
    ctx.stroke();
    if (name === 'camp') {
      ctx.strokeStyle = 'rgba(242,193,78,.45)';
      ctx.beginPath();
      ctx.arc(px, py, TILE * 3, 0, 7);
      ctx.stroke();
    }
  }
}

function drawPerson(px, py, colour, label, opts = {}) {
  const x = px * TILE + TILE / 2, y = py * TILE + TILE / 2;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 9, 8, 3.5, 0, 0, 7);
  ctx.fill();

  if (opts.down) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 11, 5, 0, 0, 7);
    ctx.fill();
  } else {
    ctx.fillStyle = colour;
    ctx.fillRect(x - 5, y - 4, 10, 13);
    ctx.beginPath();
    ctx.arc(x, y - 8, 5.2, 0, 7);
    ctx.fill();
  }
  if (opts.busy) {
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath();
    ctx.arc(x + 9, y - 13, 2.6, 0, 7);
    ctx.fill();
  }
  if (label) {
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(10,14,17,.75)';
    ctx.fillRect(x - w / 2, y - 31, w, 13);
    ctx.fillStyle = opts.unknown ? '#9aa8b2' : colour;
    ctx.fillText(label, x, y - 21);
  }
}

function lerpTo(key, tx, ty) {
  if (!smooth[key]) smooth[key] = { x: tx, y: ty };
  const s = smooth[key];
  s.x += (tx - s.x) * 0.22;
  s.y += (ty - s.y) * 0.22;
  return s;
}

function frame(ts) {
  frame.last = frame.last || ts;
  const dt = Math.min((ts - frame.last) / 1000, 0.1);
  frame.last = ts;
  move(dt);

  if (island) {
    drawMap();
    drawLandmarks();
    if (S) {
      for (const c of S.castaways) {
        if (!c.seen) continue;
        const p = lerpTo(c.key, c.x, c.y);
        drawPerson(p.x, p.y, c.colour, c.met ? c.short : '?',
          { down: c.down, busy: c.busy, unknown: !c.met });
      }
    }
    drawPerson(me.x, me.y, '#f2c14e', 'you', { down: S && S.player.down });
    if (S && S.night) {
      ctx.fillStyle = 'rgba(10,20,45,.42)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- panel

function tone(v) { return v > 60 ? '#6bbf8a' : v > 30 ? '#d8a44e' : '#e0603f'; }

function bar(label, v) {
  return `<div class="bar ${v <= 25 ? 'critical' : ''}"><span>${label}</span>
    <div class="track"><div class="fill" style="width:${v}%;background:${tone(v)}"></div></div>
    <span class="num">${v}</span></div>`;
}

function chips(obj, opts = {}) {
  const ks = Object.keys(obj || {}).filter(k => obj[k] > 0);
  if (!ks.length) return '<span class="chip empty">empty</span>';
  return ks.map(k => `<span class="chip">${k} ×${obj[k]}` +
    (opts.takeable ? `<button data-take="${k}">take</button>` : '') + '</span>').join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function paintPanel() {
  if (!S) return;
  el('clock').textContent = `Day ${S.day} · ${S.clock}`;
  el('weather').textContent = S.weather;
  el('seed').textContent = `island ${S.seed}`;
  const tag = el('llm');
  const kinds = { anthropic: 'claude', openai: 'local model', offline: 'offline' };
  tag.textContent = kinds[S.provider] || (S.online ? 'live' : 'offline');
  tag.className = 'tag ' + (S.online ? 'live' : 'off');
  tag.title = (S.llm_error ? S.llm_error + ' — ' : '') +
    `${S.model} · ${S.llm_calls} calls · click to change`;

  // context bar: what's here and what to press
  const c = S.context || {};
  el('ctx-where').textContent = c.where || '—';
  el('ctx-do').innerHTML = c.advice || '';
  el('context').classList.toggle('urgent', !!c.urgent);

  const p = S.player;
  el('you-bars').innerHTML =
    bar('thirst', p.thirst) + bar('hunger', p.hunger) +
    bar('energy', p.energy) + bar('condition', p.health);
  el('you-inv').innerHTML = chips(p.inventory);

  const blocs = (S.factions || []).filter(f => f.length > 1);
  el('factions').innerHTML = blocs.length
    ? blocs.map(f => `<span class="chip">${f.join(' + ')}</span>`).join('')
    : '<span class="chip empty">no alliances yet</span>';

  el('others').innerHTML = S.castaways.map(c => {
    if (!c.met) {
      return `<div class="person unknown"><div class="top"><span class="name">${
        c.seen ? 'someone, over there' : 'someone else may be out here'}</span></div>
        <div class="act">You haven't met them.</div></div>`;
    }
    const t = c.trust_player;
    const feel = t <= -8 ? 'has written you off' : t <= -3 ? "doesn't trust you"
      : t < 3 ? 'undecided about you' : t < 8 ? "thinks you're alright"
      : 'would trust you with their life';
    return `<div class="person ${c.down ? 'down' : ''}">
      <div class="top"><span class="name" style="color:${c.colour}">${c.name}</span>
        <span class="who">${c.pronouns} · ${c.role}</span></div>
      <div class="act">${c.down ? 'Collapsed. Needs water.' : escapeHtml(c.activity)} · ${c.emotion}</div>
      <div class="allegiance">working ${escapeHtml(c.allegiance)}</div>
      <div class="trust">${feel}</div>
      <div class="mini">
        ${['thirst', 'hunger', 'energy'].map(k =>
          `<div class="track" title="${k} ${c[k]}"><div class="fill" style="width:${c[k]}%;background:${tone(c[k])}"></div></div>`).join('')}
      </div>
      <div class="row">${chips(c.inventory)}</div>
    </div>`;
  }).join('');

  el('stores').innerHTML = chips(S.stores, { takeable: true });
  el('builds').innerHTML = Object.entries(S.structures).map(([n, s]) => {
    const pct = s.done ? 100 : Math.round((s.progress / s.needed) * 100);
    const cost = Object.entries(S.recipes[n]).map(([k, v]) => `${v} ${k}`).join(', ');
    return `<div class="build">
      <span class="nm">${n}</span>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      ${s.done ? '<span class="cost">done</span>' : `<button data-build="${n}" title="${cost}">work</button>`}
    </div>` + (s.started || s.done ? '' : `<div class="cost" style="margin:-2px 0 5px 66px">${cost}</div>`);
  }).join('');

  paintLog();

  const near = S.castaways.filter(x => x.met && !x.down &&
    Math.hypot(x.x - me.x, x.y - me.y) <= 4.5).map(x => x.short);
  el('earshot').textContent = near.length
    ? `In earshot: ${near.join(', ')}.`
    : 'Nobody is close enough to hear you.';

  const atCamp = Math.hypot(island.landmarks.camp.x - me.x, island.landmarks.camp.y - me.y) <= 3;
  const downNear = S.castaways.find(x => x.down && Math.hypot(x.x - me.x, x.y - me.y) <= 2.5);
  const buttons = [['gather', 'Gather (E)'], ['drink', 'Drink (Q)'], ['eat', 'Eat (F)'], ['rest', 'Rest (R)']];
  if (atCamp) buttons.push(['deposit', 'Deposit all']);
  if (downNear) buttons.push(['revive', `Revive ${downNear.short}`]);
  if (S.structures.raft.done && atCamp) buttons.push(['board', 'Board the raft']);
  const give = Object.keys(p.inventory).filter(k => p.inventory[k] > 0);
  el('actions').innerHTML = buttons.map(([a, l]) => `<button data-act="${a}">${l}</button>`).join('')
    + give.map(k => `<button data-act="give" data-target="${k}">Give ${k}</button>`).join('');

  if (S.over) {
    el('ending').classList.remove('hidden');
    el('ending-text').textContent = S.ending || '';
  } else {
    el('ending').classList.add('hidden');
  }
}

// ---- chat ----

function paintLog() {
  const box = el('log');
  const entries = S.log.filter(e => filter === 'all' || e.kind === 'speech');
  if (entries.length === lastLogLen) return;
  const grew = entries.length > lastLogLen;
  lastLogLen = entries.length;

  box.innerHTML = entries.map(e => {
    if (e.kind === 'speech') {
      const mine = e.who === 'You';
      return `<div class="msg ${mine ? 'mine' : ''}">
        <div class="head"><span class="name" style="color:${e.colour || '#f2c14e'}">${escapeHtml(e.who || '')}</span>
          <span class="when">${e.t}</span></div>
        <div class="bubble" style="border-left-color:${e.colour || '#f2c14e'}">${escapeHtml(e.text)}</div>
      </div>`;
    }
    return `<div class="note ${e.kind}"><span class="when">${e.t.split(' ')[1] || ''}</span>
      <span class="txt">${escapeHtml(e.text)}</span></div>`;
  }).join('');

  if (pinned) box.scrollTop = box.scrollHeight;
  else if (grew) el('jump').classList.remove('hidden');
}

el('log').addEventListener('scroll', () => {
  const box = el('log');
  pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  if (pinned) el('jump').classList.add('hidden');
});
el('jump').addEventListener('click', () => {
  pinned = true;
  el('log').scrollTop = el('log').scrollHeight;
  el('jump').classList.add('hidden');
});
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
  filter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('on', x === b));
  lastLogLen = -1;
  pinned = true;
  paintLog();
}));

// ---- collapsibles ----

document.querySelectorAll('h2[data-toggle]').forEach(h =>
  h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));

// ---------------------------------------------------------------- actions

el('panel').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act) act(b.dataset.act, b.dataset.target || '');
  else if (b.dataset.build) act('build', b.dataset.build);
  else if (b.dataset.take) act('take', b.dataset.take);
});

async function act(action, target = '') {
  try {
    const r = await fetch('/api/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, target }),
    });
    const data = await r.json();
    S = data.state;
    paintPanel();
    toast(data.message);
  } catch (e) { /* ignore */ }
}

let toastTimer;
function toast(msg) {
  if (!msg) return;
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------- talking

el('talkform').addEventListener('submit', async e => {
  e.preventDefault();
  const text = talkInput().value.trim();
  if (!text || talking) return;
  talking = true;
  talkInput().value = '';
  const btn = el('talkbtn');
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const r = await fetch('/api/say', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    S = data.state;
    pinned = true;
    paintPanel();
    if (!data.replies.length && !data.heard_by.length) toast('Nobody heard you.');
  } catch (err) {
    toast('Lost the connection.');
  } finally {
    talking = false;
    btn.disabled = false;
    btn.textContent = 'Say';
    talkInput().focus();
  }
});

// ---------------------------------------------------------------- help / restart

el('helpbtn').addEventListener('click', () => el('help').classList.remove('hidden'));
el('help-close').addEventListener('click', () => el('help').classList.add('hidden'));
el('help-ok').addEventListener('click', () => el('help').classList.add('hidden'));
el('restart').addEventListener('click', async () => {
  el('restart').textContent = 'washing up…';
  await fetch('/api/restart', { method: 'POST' });
  location.reload();
});

boot();
