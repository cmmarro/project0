/* DOM panels and input handling.

   Everything the player can do goes through a single "mode" (none / order /
   build / cancel) applied to a tile or a dragged rectangle of tiles. Input is
   pointer-based so mouse and touch share one path: with a tool selected a drag
   paints, with no tool a drag pans, and two fingers always pinch-zoom. */
window.HF = window.HF || {};

HF.UI = (function () {
  let game = null;
  let canvas = null;
  let stage = null;
  const view = { hover: null, selectedId: null, mode: { kind: 'none', id: null }, drag: null };

  const el = {};
  function $(id) { return document.getElementById(id); }
  function isNarrow() { return window.innerWidth < 900; }

  /* ---------- setup ---------- */

  function init(g) {
    game = g;
    canvas = $('board');
    stage = $('stage');
    HF.Render.init(canvas);
    HF.Camera.init(canvas, stage);

    el.stats = $('stats');
    el.calendar = $('calendar');
    el.colonists = $('colonist-panel');
    el.log = $('log');
    el.tooltip = $('tooltip');
    el.banner = $('banner');
    el.orders = $('orders');
    el.builds = $('builds');
    el.sidebar = $('sidebar');

    buildToolbar();
    bindPointer();
    bindButtons();
    bindKeys();

    resetCamera();
    window.addEventListener('resize', function () { HF.Camera.refresh(); });

    refresh();
    requestAnimationFrame(frame);
  }

  function resetCamera() {
    const c = game.colonyCentre();
    if (isNarrow()) HF.Camera.centerOn(c.x, c.y, HF.Camera.scaleForTilesAcross(15));
    else HF.Camera.fit();
  }

  function setGame(g) {
    game = g;
    view.selectedId = null;
    view.drag = null;
    setMode('none', null);
    game.dirtyTerrain = true;
    resetCamera();
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
    stage.classList.toggle('painting', view.mode.kind !== 'none');
    // A tool is useless behind the colony sheet, so close it when one is picked.
    if (view.mode.kind !== 'none') closeSheet();
    updateHint();
  }

  /* With a tool held, every drag paints instead of panning. The hint says which
     tool is live and doubles as the way to put it down. */
  function updateHint() {
    const hint = $('mode-hint');
    if (view.mode.kind === 'none') { hint.className = ''; hint.innerHTML = ''; return; }
    let text;
    if (view.mode.kind === 'order') text = HF.ORDERS[view.mode.id].label + ' - drag over the map';
    else if (view.mode.kind === 'build') text = 'Place ' + HF.BUILDINGS[view.mode.id].label;
    else text = 'Cancel - drag over orders to remove';
    hint.innerHTML = text + '<span class="clear">&times;</span>';
    hint.className = 'show';
  }

  /* ---------- pointer input ---------- */

  function bindPointer() {
    const pointers = new Map();
    let gesture = null;        // 'paint' | 'tap' | 'pan' | 'pinch'
    let pinch = null;
    let leadPointer = null;

    function spread(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('#map-controls') || e.target.closest('#help') ||
          e.target.closest('#mode-hint')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Capture keeps a drag alive if the finger leaves the map, but it is not
      // worth losing all input over if the browser refuses it.
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0 });

      if (pointers.size === 2) {
        // A second finger always means pinch, so abandon any paint in progress.
        view.drag = null;
        gesture = 'pinch';
        const p = Array.from(pointers.values());
        pinch = { d: spread(p[0], p[1]), mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2 };
        return;
      }
      if (pointers.size > 2) return;

      const t = HF.Camera.screenToTile(e.clientX, e.clientY);
      if (view.mode.kind !== 'none' && t) {
        gesture = 'paint';
        view.drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
      } else {
        gesture = 'tap';                    // becomes a pan once it moves far enough
        leadPointer = e.pointerId;
      }
    });

    stage.addEventListener('pointermove', function (e) {
      const p = pointers.get(e.pointerId);
      if (p) {
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.moved += Math.abs(dx) + Math.abs(dy);
        p.x = e.clientX; p.y = e.clientY;

        if (gesture === 'pinch' && pointers.size === 2) {
          const pts = Array.from(pointers.values());
          const d = spread(pts[0], pts[1]);
          const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
          if (pinch.d > 0) HF.Camera.zoomBy(d / pinch.d, mx, my);
          HF.Camera.panBy(mx - pinch.mx, my - pinch.my);
          pinch = { d: d, mx: mx, my: my };
          return;
        }
        if (gesture === 'paint' && view.drag) {
          const t = HF.Camera.screenToTile(e.clientX, e.clientY);
          if (t) { view.drag.x1 = t.x; view.drag.y1 = t.y; }
        } else if (e.pointerId === leadPointer && (gesture === 'tap' || gesture === 'pan')) {
          if (gesture === 'tap' && p.moved > 10) gesture = 'pan';
          if (gesture === 'pan') HF.Camera.panBy(dx, dy);
        }
      }

      if (e.pointerType === 'mouse') {
        const t = HF.Camera.screenToTile(e.clientX, e.clientY);
        view.hover = t;
        showTileInfo(t, e.clientX, e.clientY, false);
      }
    });

    function release(e) {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (!p) return;

      if (gesture === 'paint' && pointers.size === 0) {
        if (view.drag) { applyToRect(view.drag); view.drag = null; refresh(); }
        gesture = null;
      } else if (gesture === 'tap' && e.pointerId === leadPointer) {
        const t = HF.Camera.screenToTile(e.clientX, e.clientY);
        if (t) handleTap(t, e);
        gesture = null; leadPointer = null;
      } else if (pointers.size < 2) {
        // Coming out of a pinch, ignore the finger still down until it lifts.
        gesture = null; pinch = null; leadPointer = null;
      }

      if (pointers.size === 0) { gesture = null; pinch = null; leadPointer = null; view.drag = null; }
    }

    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      HF.Camera.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }, { passive: false });

    stage.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      view.hover = null;
      el.tooltip.style.display = 'none';
    });

    stage.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      setMode('none', null);
    });
  }

  function handleTap(t, e) {
    const c = game.colonistAt(t.x, t.y);
    if (c) {
      view.selectedId = c.id;
      renderColonists();
      return;
    }
    view.selectedId = null;
    renderColonists();
    // Touch has no hover, so a tap on empty ground is how you inspect a tile.
    if (e.pointerType !== 'mouse') showTileInfo(t, e.clientX, e.clientY, true);
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
    if (placed > 0) game.dirtyTerrain = true;
  }

  let toastTimer = null;
  function toast(message) {
    el.banner.textContent = message;
    el.banner.className = 'show warn';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.banner.className = ''; }, 2600);
  }

  let tipTimer = null;
  function showTileInfo(t, clientX, clientY, sticky) {
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

    const rect = stage.getBoundingClientRect();
    const w = el.tooltip.offsetWidth, h = el.tooltip.offsetHeight;
    let left = clientX - rect.left + 14;
    let top = clientY - rect.top + 14;
    if (left + w > rect.width - 8) left = clientX - rect.left - w - 14;
    if (top + h > rect.height - 8) top = clientY - rect.top - h - 14;
    el.tooltip.style.left = Math.max(6, left) + 'px';
    el.tooltip.style.top = Math.max(6, top) + 'px';

    clearTimeout(tipTimer);
    if (sticky) tipTimer = setTimeout(function () { el.tooltip.style.display = 'none'; }, 2800);
  }

  /* ---------- buttons and keys ---------- */

  function openSheet() { el.sidebar.classList.add('open'); }
  function closeSheet() { el.sidebar.classList.remove('open'); }

  function bindButtons() {
    $('btn-endturn').addEventListener('click', endTurn);
    $('mode-hint').addEventListener('click', function () { setMode('none', null); });
    $('btn-panel').addEventListener('click', function () { el.sidebar.classList.toggle('open'); });
    $('sheet-close').addEventListener('click', closeSheet);

    $('zoom-in').addEventListener('click', function () { HF.Camera.zoomBy(1.35); });
    $('zoom-out').addEventListener('click', function () { HF.Camera.zoomBy(1 / 1.35); });
    $('recenter').addEventListener('click', function () {
      const sel = view.selectedId != null ? game.colonistById(view.selectedId) : null;
      const target = sel && !sel.dead ? sel : game.colonyCentre();
      HF.Camera.centerOn(target.x, target.y);
    });

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
      let data = null;
      try { data = localStorage.getItem('hearthfall.save'); } catch (err) { data = null; }
      if (!data) { toast('No saved colony found.'); return; }
      try {
        setGame(HF.Game.load(data));
        toast('Colony restored.');
      } catch (err) {
        toast('Save file could not be read.');
      }
    });
    $('btn-help').addEventListener('click', function () { $('help').classList.toggle('open'); });
    $('help-close').addEventListener('click', function () { $('help').classList.remove('open'); });
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
    $('btn-panel').innerHTML = 'Colony <span class="badge">' + alive + '</span>';
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
    const beds = HF.Build.bedCount(game);
    // Beds sit next to the roster because "who has nowhere to sleep" is the
    // question the roster is being read to answer.
    let html = '<h2>Colonists <span class="count">' + alive.length + '</span>' +
               ' &middot; Beds <span class="count' + (beds < alive.length ? ' short' : '') + '">' +
               beds + '</span></h2>';

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
                wt.label + ' - skill ' + lvl + '. Tap to toggle.">' +
                wt.short + '<span class="lvl">' + lvl + '</span></button>';
      }
      html += '</div></div>';
    }

    el.colonists.innerHTML = html;

    for (const node of el.colonists.querySelectorAll('.colonist')) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('.work')) return;
        view.selectedId = parseInt(node.dataset.id, 10);
        const c = game.colonistById(view.selectedId);
        if (c) HF.Camera.centerOn(c.x, c.y);
        renderColonists();
        if (isNarrow()) closeSheet();      // get out of the way so you can see them
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
