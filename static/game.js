/* Castaway — client. Renders the island, moves you around it, and shows what
   the model-driven survivors are saying and doing. */

const TILE = 26;
const SPEED = 4.2;              // tiles per second
const BLOCKED = new Set(['~', 'j', 'p', 'r', 'f', 'x']);

const canvas = document.getElementById('island');
const ctx = canvas.getContext('2d');

let island = null;              // static map data
let S = null;                   // latest server snapshot
let me = { x: 16, y: 17 };      // client-side player position (authoritative-ish)
const keys = new Set();
const smooth = {};              // key -> {x, y} interpolated positions
let talking = false;

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
}

async function poll() {
  try {
    const r = await fetch(`/api/state?x=${me.x.toFixed(2)}&y=${me.y.toFixed(2)}`);
    S = await r.json();
    paintPanel();
  } catch (e) { /* server restarting; keep drawing */ }
}

// ---------------------------------------------------------------- input

addEventListener('keydown', e => {
  if (document.activeElement === talkInput) {
    if (e.key === 'Escape') talkInput.blur();
    return;
  }
  if (e.key === 'Enter') { talkInput.focus(); e.preventDefault(); return; }
  keys.add(e.key.toLowerCase());
  const verb = { e: 'gather', q: 'drink', f: 'eat', r: 'rest' }[e.key.toLowerCase()];
  if (verb) act(verb);
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
  '~': ['#123449', '#0f2c3f'],
  'w': ['#2a6785', '#296078'],
  's': ['#d9c9a0', '#d2c096'],
  'g': ['#3f6b41', '#3a6a3c'],
  'j': ['#254b2c', '#22462a'],
  'p': ['#356b3f', '#31633a'],
  'r': ['#6a6a68', '#61615f'],
  'h': ['#8a8a6d', '#838367'],
  'f': ['#3f8fb5', '#3a86ab'],
  'x': ['#5a4632', '#53412e'],
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
    ctx.fillStyle = 'rgba(10,14,17,.55)';
    const w = ctx.measureText(name).width + 10;
    ctx.fillRect(px - w / 2, py - 22, w, 14);
    ctx.fillStyle = '#cbd8e0';
    ctx.fillText(name, px, py - 12);
    if (name === 'camp') {
      ctx.strokeStyle = 'rgba(242,193,78,.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, TILE * 2.6, 0, 7);
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
    ctx.fillStyle = 'rgba(10,14,17,.7)';
    ctx.fillRect(x - w / 2, y - 30, w, 13);
    ctx.fillStyle = opts.unknown ? '#9aa8b2' : colour;
    ctx.fillText(label, x, y - 20);
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
    if (S && S.weather_key === 'storm') {
      ctx.fillStyle = 'rgba(120,140,160,.13)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- panel

const el = id => document.getElementById(id);

function bar(label, v, colour) {
  return `<div class="bar"><span>${label}</span>
    <div class="track"><div class="fill" style="width:${v}%;background:${colour}"></div></div>
    <span class="num">${v}</span></div>`;
}
function tone(v) { return v > 60 ? '#6bbf8a' : v > 30 ? '#d8a44e' : '#e0603f'; }

function chips(obj, opts = {}) {
  const ks = Object.keys(obj || {}).filter(k => obj[k] > 0);
  if (!ks.length) return '<span class="chip empty">empty</span>';
  return ks.map(k => {
    const take = opts.takeable ? `<button data-take="${k}">take</button>` : '';
    return `<span class="chip">${k} ×${obj[k]}${take}</span>`;
  }).join('');
}

function paintPanel() {
  if (!S) return;
  el('clock').textContent = `Day ${S.day} · ${S.clock}`;
  el('weather').textContent = S.weather;
  el('here').textContent = S.here ? `at ${S.here}` : '';
  el('seed').textContent = `island ${S.seed}`;
  const tag = el('llm');
  const kinds = { anthropic: 'claude', openai: 'local model', offline: 'offline' };
  tag.textContent = kinds[S.provider] || (S.online ? 'live' : 'offline');
  tag.className = 'tag ' + (S.online ? 'live' : 'off');
  tag.title = (S.llm_error ? S.llm_error + ' — ' : '') +
    `${S.model} · ${S.llm_calls} calls · click to change`;

  const p = S.player;
  el('you-bars').innerHTML =
    bar('thirst', p.thirst, tone(p.thirst)) +
    bar('hunger', p.hunger, tone(p.hunger)) +
    bar('energy', p.energy, tone(p.energy)) +
    bar('condition', p.health, tone(p.health));
  el('you-inv').innerHTML = chips(p.inventory);

  const blocs = (S.factions || []).filter(f => f.length > 1);
  el('factions').innerHTML = blocs.length
    ? blocs.map(f => `<span class="chip">${f.join(' + ')}</span>`).join('')
    : '<span class="chip empty">no alliances yet</span>';

  el('others').innerHTML = S.castaways.map(c => {
    if (!c.met) {
      return `<div class="person unknown"><div class="top"><span class="name">
        ${c.seen ? 'someone, over there' : 'someone else may be out here'}</span></div>
        <div class="act">You haven't met them.</div></div>`;
    }
    const trust = c.trust_player;
    const feel = trust <= -8 ? 'has written you off' : trust <= -3 ? "doesn't trust you"
      : trust < 3 ? 'undecided about you' : trust < 8 ? 'thinks you\'re alright'
      : 'would trust you with their life';
    return `<div class="person ${c.down ? 'down' : ''}">
      <div class="top"><span class="name" style="color:${c.colour}">${c.name}</span>
        <span class="emo">${c.pronouns} · ${c.role}</span></div>
      <div class="act" style="opacity:.6">${c.emotion}</div>
      <div class="act">${c.down ? 'Collapsed. Needs water.' : c.activity}</div>
      <div class="act" style="opacity:.75">“${c.thought}”</div>
      <div class="allegiance">working ${c.allegiance}</div>
      <div class="trust">${feel}</div>
      <div class="mini">
        <div class="track"><div class="fill" style="height:100%;width:${c.thirst}%;background:${tone(c.thirst)}"></div></div>
        <div class="track"><div class="fill" style="height:100%;width:${c.hunger}%;background:${tone(c.hunger)}"></div></div>
        <div class="track"><div class="fill" style="height:100%;width:${c.energy}%;background:${tone(c.energy)}"></div></div>
      </div>
      <div class="row">${chips(c.inventory)}</div>
    </div>`;
  }).join('');

  el('stores').innerHTML = chips(S.stores, { takeable: true });

  el('builds').innerHTML = Object.entries(S.structures).map(([n, s]) => {
    const pct = Math.round((s.progress / s.needed) * 100);
    const cost = Object.entries(S.recipes[n]).map(([k, v]) => `${v} ${k}`).join(', ');
    return `<div class="build">
      <span class="nm">${n}</span>
      <div class="track"><div class="fill" style="width:${s.done ? 100 : pct}%"></div></div>
      ${s.done ? '<span class="cost">done</span>'
        : `<button data-build="${n}" title="${cost}">work</button>`}
    </div>` + (s.started || s.done ? '' : `<div class="cost" style="margin:-2px 0 4px 68px">${cost}</div>`);
  }).join('');

  el('log').innerHTML = S.log.slice().reverse().map(e => {
    const who = e.who && e.kind === 'speech'
      ? `<span class="who" style="color:${e.colour || '#dbe3e8'}">${e.who}:</span> ` : '';
    return `<div class="entry ${e.kind}"><span class="t">${e.t}</span>
      <span class="txt">${who}${escapeHtml(e.text)}</span></div>`;
  }).join('');

  const near = S.castaways.filter(c => c.met && !c.down &&
    Math.hypot(c.x - me.x, c.y - me.y) <= 4.5).map(c => c.short);
  el('earshot').textContent = near.length
    ? `In earshot: ${near.join(', ')}.`
    : 'Nobody is close enough to hear you.';

  const atCamp = Math.hypot(island.landmarks.camp.x - me.x, island.landmarks.camp.y - me.y) <= 3;
  const downNear = S.castaways.find(c => c.down && Math.hypot(c.x - me.x, c.y - me.y) <= 2.5);
  const buttons = [['gather', 'Gather (E)'], ['drink', 'Drink (Q)'], ['eat', 'Eat (F)'], ['rest', 'Rest (R)']];
  if (atCamp) buttons.push(['deposit', 'Deposit all']);
  if (downNear) buttons.push(['revive', `Revive ${downNear.short}`]);
  if (S.structures.raft.done && atCamp) buttons.push(['board', 'Board the raft']);
  const give = Object.keys(p.inventory).filter(k => p.inventory[k] > 0);
  el('actions').innerHTML = buttons.map(([a, l]) => `<button data-act="${a}">${l}</button>`).join('')
    + (give.length ? give.map(k => `<button data-act="give" data-target="${k}">Give ${k}</button>`).join('') : '');

  if (S.over) {
    el('ending').classList.remove('hidden');
    el('ending-text').textContent = S.ending || '';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------- actions

document.getElementById('panel').addEventListener('click', e => {
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
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- talking

const talkInput = el('talk');
const talkBtn = el('talkbtn');

el('talkform').addEventListener('submit', async e => {
  e.preventDefault();
  const text = talkInput.value.trim();
  if (!text || talking) return;
  talking = true;
  talkInput.value = '';
  talkBtn.disabled = true;
  talkBtn.textContent = '…';
  try {
    const r = await fetch('/api/say', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    S = data.state;
    paintPanel();
    if (!data.replies.length && !data.heard_by.length) toast('Nobody heard you.');
  } catch (err) {
    toast('Lost the connection.');
  } finally {
    talking = false;
    talkBtn.disabled = false;
    talkBtn.textContent = 'Say';
    talkInput.focus();
  }
});

boot();
