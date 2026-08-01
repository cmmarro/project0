/* DOM panels and input handling. Everything the player can do goes through a
   single "mode" (none / order / build / cancel) applied to a tile or a dragged
   rectangle of tiles. */
window.HF = window.HF || {};

HF.UI = (function () {
  const T = HF.CFG.TILE;

  let game = null;
  let canvas = null;
  const view = { hover: null, selectedId: null, mode: { kind: 'none', id: null }, drag: null };

  const el = {};

  function $(id) { return document.getElementById(id); }

  /* ---------- setup ---------- */

  function init(g) {
    game = g;
    canvas = $('board');
    HF.Render.init(canvas);

    el.stats = $('stats');
    el.calendar = $('calendar');
    el.colonists = $('colonist-panel');
    el.log = $('log');
    el.tooltip = $('tooltip');
    el.banner = $('banner');
    el.orders = $('orders');
    el.builds = $('builds');

    buildToolbar();
    bindCanvas();
    bindButtons();
    bindKeys();

    refresh();
    requestAnimationFrame(frame);
  }

  function setGame(g) {
    game = g;
    view.selectedId = null;
    view.mode = { kind: 'none', id: null };
    game.dirtyTerrain = true;
    refresh();
  }

  function frame() {
    HF.Render.draw(game, view);
    requestAnimationFrame(frame);
  }

  /* ---------- toolbar ---------- */

  function buildToolbar() {
    el.orders.innerHTML = '<span class="group-label">Orders</span>';
    for (const id in HF.ORDERS) {
      const o = HF.ORDERS[id];
      if (!o.key) continue;                       // harvest is issued by the farm itself
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.mode = 'order';
      b.dataset.id = id;
      b.innerHTML = '<span class="swatch ' + id + '"></span>' + o.label + '<kbd>' + o.key + '</kbd>';
      b.title = o.hint;
      b.addEventListener('click', function () { setMode('order', id); });
      el.orders.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.className = 'tool danger';
    cancel.dataset.mode = 'cancel';
    cancel.innerHTML = 'Cancel<kbd>X</kbd>';
    cancel.title = 'Remove work orders and buildings. Finished buildings refund half.';
    cancel.addEventListener('click', function () { setMode('cancel', null); });
    el.orders.appendChild(cancel);

    el.builds.innerHTML = '<span class="group-label">Build</span>';
    let n = 1;
    for (const id in HF.BUILDINGS) {
      const def = HF.BUILDINGS[id];
      const key = String(n++);
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.mode = 'build';
      b.dataset.id = id;
      b.innerHTML = def.label + '<span class="cost">' + costText(def) + '</span><kbd>' + key + '</kbd>';
      b.title = def.desc;
      b.addEventListener('click', function () { setMode('build', id); });
      el.builds.appendChild(b);
    }
  }

  const RES_ABBR = { wood: 'w', stone: 's', food: 'f' };

  function costText(def) {
    const parts = [];
    for (const r in def.cost) parts.push(def.cost[r] + (RES_ABBR[r] || r.charAt(0)));
    return parts.join(' ');
  }

  function setMode(kind, id) {
    if (view.mode.kind === kind && view.mode.id === id) {
      view.mode = { kind: 'none', id: null };
    } else {
      view.mode = { kind: kind, id: id };
    }
    for (const b of document.querySelectorAll('.tool')) {
      b.classList.toggle('active',
        b.dataset.mode === view.mode.kind && (b.dataset.id || null) === view.mode.id);
    }
    canvas.classList.toggle('painting', view.mode.kind !== 'none');
  }

  /* ---------- canvas input ---------- */

  function tileFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width) / T);
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height) / T);
    if (x < 0 || y < 0 || x >= game.w || y >= game.h) return null;
    return { x: x, y: y };
  }

  function bindCanvas() {
    canvas.addEventListener('mousedown', function (e) {
      const t = tileFromEvent(e);
      if (!t) return;
      if (e.button !== 0) return;
      if (view.mode.kind === 'none') { selectAt(t); return; }
      view.drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
    });

    canvas.addEventListener('mousemove', function (e) {
      const t = tileFromEvent(e);
      view.hover = t;
      if (view.drag && t) { view.drag.x1 = t.x; view.drag.y1 = t.y; }
      updateTooltip(e, t);
    });

    window.addEventListener('mouseup', function () {
      if (!view.drag) return;
      applyToRect(view.drag);
      view.drag = null;
      refresh();
    });

    canvas.addEventListener('mouseleave', function () {
      view.hover = null;
      el.tooltip.style.display = 'none';
    });

    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      setMode('none', null);
    });
  }

  function selectAt(t) {
    const c = game.colonistAt(t.x, t.y);
    view.selectedId = c ? c.id : null;
    renderColonists();
  }

  function applyToRect(drag) {
    const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1);
    const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
    let placed = 0, failReason = null;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (view.mode.kind === 'order') {
          if (game.designate(view.mode.id, x, y)) placed++;
        } else if (view.mode.kind === 'cancel') {
          if (game.undesignate(x, y)) placed++;
          if (HF.Build.remove(game, x, y)) placed++;
        } else if (view.mode.kind === 'build') {
          const res = HF.Build.place(game, view.mode.id, x, y);
          if (res.ok) placed++;
          else failReason = res.reason;
        }
      }
    }

    if (placed === 0 && failReason) toast(failReason);
    if (view.mode.kind === 'build' && placed > 0) {
      // Stay in build mode so a row of walls is one selection, many clicks.
      game.dirtyTerrain = true;
    }
  }

  let toastTimer = null;
  function toast(message) {
    el.banner.textContent = message;
    el.banner.className = 'show warn';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.banner.className = ''; }, 2600);
  }

  function updateTooltip(e, t) {
    if (!t) { el.tooltip.style.display = 'none'; return; }
    const tile = HF.Map.at(game, t.x, t.y);
    const lines = [HF.TERRAIN[tile.terrain].name];
    if (tile.feature === 'berries') lines.push('Berry bushes');

    const b = game.buildingAt(t.x, t.y);
    if (b) {
      const def = HF.BUILDINGS[b.type];
      if (b.built) {
        lines.push(def.label);
        if (def.farm) {
          const pct = Math.round(HF.U.clamp(b.growth / HF.FARM.RIPE_AT, 0, 1) * 100);
          lines.push(pct >= 100 ? 'Ripe - awaiting harvest' : 'Growth ' + pct + '%');
        }
        if (def.hp) lines.push('Integrity ' + Math.round(b.hp) + '/' + def.hp);
      } else {
        lines.push(def.label + ' (blueprint)');
        lines.push('Built ' + Math.round(b.workDone / def.work * 100) + '%');
      }
    }

    const d = game.designations[HF.U.key(t.x, t.y)];
    if (d) {
      lines.push('Order: ' + HF.ORDERS[d.type].label +
                 ' (' + Math.round(d.workDone / HF.ORDERS[d.type].work * 100) + '%)');
    }

    const c = game.colonistAt(t.x, t.y);
    if (c) lines.push(c.name + ' - ' + c.activity);

    const r = game.raiders.find(function (rr) { return !rr.dead && rr.x === t.x && rr.y === t.y; });
    if (r) lines.push('Raider (' + r.hp + ' hp)');

    el.tooltip.innerHTML = lines.join('<br>');
    el.tooltip.style.display = 'block';
    const rect = canvas.getBoundingClientRect();
    el.tooltip.style.left = (e.clientX - rect.left + 16) + 'px';
    el.tooltip.style.top = (e.clientY - rect.top + 16) + 'px';
  }

  /* ---------- buttons and keys ---------- */

  function bindButtons() {
    $('btn-endturn').addEventListener('click', endTurn);
    $('btn-new').addEventListener('click', function () {
      if (!confirm('Abandon this colony and generate a new map?')) return;
      setGame(new HF.Game((Math.random() * 0xffffffff) >>> 0));
    });
    $('btn-save').addEventListener('click', function () {
      try {
        localStorage.setItem('hearthfall.save', game.serialize());
        toast('Colony saved.');
      } catch (err) {
        toast('Could not save: ' + err.message);
      }
    });
    $('btn-load').addEventListener('click', function () {
      const data = localStorage.getItem('hearthfall.save');
      if (!data) { toast('No saved colony found.'); return; }
      try {
        setGame(HF.Game.load(data));
        toast('Colony restored.');
      } catch (err) {
        toast('Save file could not be read.');
      }
    });
    $('btn-help').addEventListener('click', function () {
      $('help').classList.toggle('open');
    });
    $('help-close').addEventListener('click', function () {
      $('help').classList.remove('open');
    });
  }

  function bindKeys() {
    const buildKeys = Object.keys(HF.BUILDINGS);
    window.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'enter') { e.preventDefault(); endTurn(); return; }
      if (k === 'escape') { setMode('none', null); $('help').classList.remove('open'); return; }
      if (k === 'x') { setMode('cancel', null); return; }
      if (k === 'h') { $('help').classList.toggle('open'); return; }
      for (const id in HF.ORDERS) {
        if (HF.ORDERS[id].key && HF.ORDERS[id].key.toLowerCase() === k) { setMode('order', id); return; }
      }
      const n = parseInt(k, 10);
      if (n >= 1 && n <= buildKeys.length) setMode('build', buildKeys[n - 1]);
    });
  }

  function endTurn() {
    if (game.gameOver) return;
    game.endTurn();
    refresh();
  }

  /* ---------- panels ---------- */

  function refresh() {
    renderStats();
    renderColonists();
    renderLog();
    renderBanner();
  }

  function renderStats() {
    const cap = HF.Build.storageCap(game);
    const alive = game.aliveColonists().length;
    const beds = HF.Build.bedCount(game);
    el.stats.innerHTML =
      stat('Food', Math.floor(game.res.food) + ' / ' + cap, 'food') +
      stat('Wood', Math.floor(game.res.wood) + ' / ' + cap, 'wood') +
      stat('Stone', Math.floor(game.res.stone) + ' / ' + cap, 'stone') +
      stat('Colonists', alive + '', 'pop') +
      stat('Beds', beds + '', 'bed');
    el.calendar.innerHTML =
      '<div class="season ' + game.season().toLowerCase() + '">' + game.season() + '</div>' +
      '<div class="date">Year ' + game.year() + ' &middot; Day ' + game.dayOfSeason() +
      ' &middot; Turn ' + game.turn + '</div>';
  }

  function stat(label, value, cls) {
    return '<div class="stat ' + cls + '"><span class="label">' + label +
           '</span><span class="value">' + value + '</span></div>';
  }

  function bar(label, value, max, cls) {
    const pct = HF.U.clamp(value / max * 100, 0, 100);
    return '<div class="bar ' + cls + '" title="' + label + ' ' + Math.round(value) + '">' +
           '<div class="fill" style="width:' + pct + '%"></div>' +
           '<span>' + label + '</span></div>';
  }

  function renderColonists() {
    const alive = game.aliveColonists();
    let html = '<h2>Colonists <span class="count">' + alive.length + '</span></h2>';

    if (alive.length === 0) html += '<p class="empty">No one is left.</p>';

    for (const c of alive) {
      const selected = view.selectedId === c.id;
      html += '<div class="colonist' + (selected ? ' selected' : '') + '" data-id="' + c.id + '">';
      html += '<div class="row-head"><span class="name">' + c.name + '</span>' +
              '<span class="activity">' + c.activity + '</span></div>';
      html += '<div class="bars">' +
              bar('Food', c.needs.food, 100, 'food') +
              bar('Rest', c.needs.rest, 100, 'rest') +
              bar('Mood', c.mood, 100, 'mood') +
              bar('HP', c.hp, c.maxHp, 'hp') +
              '</div>';

      html += '<div class="works">';
      for (const wt of HF.WORK_TYPES) {
        const lvl = HF.Colonists.skillLevel(c, wt.skill);
        html += '<button class="work' + (c.work[wt.id] ? ' on' : '') +
                '" data-colonist="' + c.id + '" data-work="' + wt.id + '" title="' +
                wt.label + ' - skill ' + lvl + '. Click to toggle.">' +
                wt.label.slice(0, 5) + '<span class="lvl">' + lvl + '</span></button>';
      }
      html += '</div></div>';
    }

    el.colonists.innerHTML = html;

    for (const node of el.colonists.querySelectorAll('.colonist')) {
      node.addEventListener('click', function (e) {
        if (e.target.classList.contains('work')) return;
        view.selectedId = parseInt(node.dataset.id, 10);
        renderColonists();
      });
    }
    for (const btn of el.colonists.querySelectorAll('.work')) {
      btn.addEventListener('click', function () {
        const c = game.colonistById(parseInt(btn.dataset.colonist, 10));
        if (!c) return;
        c.work[btn.dataset.work] = !c.work[btn.dataset.work];
        // Drop a job the colonist is no longer willing to do.
        if (c.task && c.task.kind === 'work') {
          const wt = HF.Jobs.workTypeOf(game, c.task);
          if (wt && !c.work[wt]) { game.releaseClaims(c.id); c.task = null; }
        }
        renderColonists();
      });
    }
  }

  function renderLog() {
    const recent = game.entries.slice(-40).reverse();
    el.log.innerHTML = recent.map(function (e) {
      return '<li class="' + e.kind + '"><span class="turn">' + e.turn + '</span>' + e.message + '</li>';
    }).join('');
  }

  function renderBanner() {
    if (game.gameOver === 'lost') {
      el.banner.textContent = 'The colony has failed. Turn ' + game.turn + '. Press New to try again.';
      el.banner.className = 'show bad';
    } else if (game.milestoneShown && game.turn === HF.CFG.MILESTONE_TURN) {
      el.banner.textContent = 'Three years endured.';
      el.banner.className = 'show good';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.banner.className = ''; }, 5000);
    }
  }

  return { init: init, setGame: setGame };
})();
