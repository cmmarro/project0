/* DOM panels and input handling.

   Everything the player can do goes through a single "mode" (none / order /
   build / cancel) applied to a tile or a dragged rectangle of tiles. Tools are
   chosen from a picker sheet that lists every option with its cost and what it
   is for, rather than a strip of buttons that can scroll out of reach. */
window.HF = window.HF || {};

HF.UI = (function () {
  let game = null;
  let canvas = null;
  let stage = null;
  const view = { hover: null, selectedId: null, mode: { kind: 'none', id: null }, drag: null };

  let endingDismissedFor = null;   // which gameOver state the player has closed
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
    el.levy = $('levy');
    el.colonists = $('colonist-panel');
    el.log = $('log');
    el.tooltip = $('tooltip');
    el.banner = $('banner');
    el.sidebar = $('sidebar');
    el.picker = $('picker');
    el.pickerList = $('picker-list');
    el.pickerTitle = $('picker-title');

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
    if (isNarrow()) HF.Camera.centerOn(c.x, c.y, HF.Camera.scaleForTilesAcross(11));
    else HF.Camera.centerOn(c.x, c.y, 0.85);
  }

  function setGame(g) {
    game = g;
    view.selectedId = null;
    view.drag = null;
    endingDismissedFor = null;
    setMode('none', null);
    resetCamera();
    refresh();
  }

  /* The game is turn-based, so a frame is only painted when something moved. */
  function frame() {
    HF.Render.draw(game, view);
    requestAnimationFrame(frame);
  }

  /* ---------- tool selection ---------- */

  function setMode(kind, id) {
    if (view.mode.kind === kind && view.mode.id === id) {
      view.mode = { kind: 'none', id: null };
    } else {
      view.mode = { kind: kind, id: id };
    }
    stage.classList.toggle('painting', view.mode.kind !== 'none');
    if (view.mode.kind !== 'none') closeSheet();
    updateToolButtons();
    HF.Render.invalidate();
  }

  function updateToolButtons() {
    const orderBtn = $('pick-order'), buildBtn = $('pick-build'), cancelBtn = $('tool-cancel');
    orderBtn.querySelector('.sel').textContent =
      view.mode.kind === 'order' ? HF.ORDERS[view.mode.id].label : 'Choose…';
    buildBtn.querySelector('.sel').textContent =
      view.mode.kind === 'build' ? HF.BUILDINGS[view.mode.id].label : 'Choose…';
    orderBtn.classList.toggle('active', view.mode.kind === 'order');
    buildBtn.classList.toggle('active', view.mode.kind === 'build');
    cancelBtn.classList.toggle('active', view.mode.kind === 'cancel');
    updateHint();
  }

  /* With a tool held, every drag paints instead of panning. The hint says which
     tool is live and doubles as the way to put it down. */
  function updateHint() {
    const hint = $('mode-hint');
    if (view.mode.kind === 'none') { hint.className = ''; hint.innerHTML = ''; return; }
    let text;
    if (view.mode.kind === 'order') text = HF.ORDERS[view.mode.id].label + ' — drag over the map';
    else if (view.mode.kind === 'build') text = 'Place ' + HF.BUILDINGS[view.mode.id].label +
                                                ' — tap a tile';
    else text = 'Cancel — drag over what to remove';
    hint.innerHTML = text + '<span class="clear">&times;</span>';
    hint.className = 'show';
  }

  function costText(cost) {
    const parts = [];
    for (const r in cost) parts.push(cost[r] + ' ' + HF.RESOURCES[r].label);
    return parts.join(' + ');
  }

  function affordable(cost) {
    for (const r in cost) if (game.res[r] < cost[r]) return false;
    return true;
  }

  function shortfall(cost) {
    const parts = [];
    for (const r in cost) {
      const missing = Math.ceil(cost[r] - game.res[r]);
      if (missing > 0) parts.push(missing + ' more ' + HF.RESOURCES[r].label.toLowerCase());
    }
    return parts.join(', ');
  }

  /* The picker lists every tool with its cost and purpose. This exists because
     a scrolling strip of buttons hid the whole build menu off the side of a
     phone screen, which made building undiscoverable. */
  function openPicker(kind) {
    el.pickerTitle.textContent = kind === 'order' ? 'Work Orders' : 'Build';
    let html = '';

    if (kind === 'order') {
      for (const id in HF.ORDERS) {
        const o = HF.ORDERS[id];
        if (!o.key) continue;
        html += '<button class="pick" data-kind="order" data-id="' + id + '">' +
                '<span class="pick-mark" style="background:' + o.color + '"></span>' +
                '<span class="pick-text"><span class="pick-name">' + o.label + '</span>' +
                '<span class="pick-desc">' + o.hint + '</span></span>' +
                '<span class="pick-cost free">free</span></button>';
      }
    } else {
      for (const id in HF.BUILDINGS) {
        const b = HF.BUILDINGS[id];
        const ok = affordable(b.cost);
        html += '<button class="pick' + (ok ? '' : ' unaffordable') + '" data-kind="build" data-id="' +
                id + '"' + (ok ? '' : ' disabled') + '>' +
                '<span class="pick-mark build ' + id + '"></span>' +
                '<span class="pick-text"><span class="pick-name">' + b.label +
                (b.sub ? ' <em>' + b.sub + '</em>' : '') + '</span>' +
                '<span class="pick-desc">' + b.desc + '</span></span>' +
                '<span class="pick-cost' + (ok ? '' : ' short') + '">' +
                (ok ? costText(b.cost) : shortfall(b.cost)) + '</span></button>';
      }
    }

    el.pickerList.innerHTML = html;
    for (const btn of el.pickerList.querySelectorAll('.pick')) {
      btn.addEventListener('click', function () {
        setMode(btn.dataset.kind, btn.dataset.id);
        closePicker();
      });
    }
    el.picker.classList.add('open');
  }

  function closePicker() { el.picker.classList.remove('open'); }

  /* ---------- pointer input ---------- */

  function tileAt(clientX, clientY) {
    const p = HF.Camera.toCanvas(clientX, clientY);
    return HF.Iso.toTile(game, p.x, p.y);
  }

  function bindPointer() {
    const pointers = new Map();
    let gesture = null;        // 'paint' | 'tap' | 'pan' | 'pinch'
    let pinch = null;
    let leadPointer = null;

    function spread(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('#map-controls') || e.target.closest('#help') ||
          e.target.closest('#ending') || e.target.closest('#mode-hint')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0 });

      if (pointers.size === 2) {
        // A second finger always means pinch, so abandon any paint in progress.
        view.drag = null;
        gesture = 'pinch';
        const p = Array.from(pointers.values());
        pinch = { d: spread(p[0], p[1]), mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2 };
        HF.Render.invalidate();
        return;
      }
      if (pointers.size > 2) return;

      const t = tileAt(e.clientX, e.clientY);
      if (view.mode.kind !== 'none' && t) {
        gesture = 'paint';
        view.drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
        HF.Render.invalidate();
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
          const t = tileAt(e.clientX, e.clientY);
          if (t && (t.x !== view.drag.x1 || t.y !== view.drag.y1)) {
            view.drag.x1 = t.x; view.drag.y1 = t.y;
            HF.Render.invalidate();
          }
        } else if (e.pointerId === leadPointer && (gesture === 'tap' || gesture === 'pan')) {
          if (gesture === 'tap' && p.moved > 10) gesture = 'pan';
          if (gesture === 'pan') HF.Camera.panBy(dx, dy);
        }
      }

      if (e.pointerType === 'mouse') {
        const t = tileAt(e.clientX, e.clientY);
        const changed = (!!t !== !!view.hover) ||
                        (t && view.hover && (t.x !== view.hover.x || t.y !== view.hover.y));
        view.hover = t;
        if (changed) HF.Render.invalidate();
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
        const t = tileAt(e.clientX, e.clientY);
        if (t) handleTap(t, e);
        gesture = null; leadPointer = null;
      } else if (pointers.size < 2) {
        // Coming out of a pinch, ignore the finger still down until it lifts.
        gesture = null; pinch = null; leadPointer = null;
      }

      if (pointers.size === 0) {
        gesture = null; pinch = null; leadPointer = null; view.drag = null;
        HF.Render.invalidate();
      }
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
      HF.Render.invalidate();
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
      HF.Render.invalidate();
      return;
    }
    view.selectedId = null;
    renderColonists();
    HF.Render.invalidate();
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
    else if (placed === 0 && view.mode.kind === 'order') {
      toast('Nothing there to ' + HF.ORDERS[view.mode.id].label.toLowerCase() + '.');
    }
    HF.Render.invalidate();
  }

  let toastTimer = null;
  function toast(message) {
    el.banner.textContent = message;
    el.banner.className = 'show warn';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.banner.className = ''; }, 2800);
  }

  let tipTimer = null;
  function showTileInfo(t, clientX, clientY, sticky) {
    if (!t) { el.tooltip.style.display = 'none'; return; }
    const tile = HF.Map.at(game, t.x, t.y);
    const lines = ['<b>' + HF.TERRAIN[tile.terrain].name + '</b>'];
    if (tile.feature === 'chestnut') lines.push('Chestnut trees');

    const b = game.buildingAt(t.x, t.y);
    if (b) {
      const def = HF.BUILDINGS[b.type];
      if (b.built) {
        lines.push('<b>' + def.label + '</b>');
        if (def.farm) {
          const pct = Math.round(HF.U.clamp(b.growth / HF.FARM.RIPE_AT, 0, 1) * 100);
          lines.push(pct >= 100 ? 'Ripe — awaiting harvest' : 'Ripening ' + pct + '%');
        }
        if (def.hp) lines.push('Intact ' + Math.round(b.hp) + '/' + def.hp);
      } else {
        lines.push('<b>' + def.label + '</b> (planned)');
        lines.push('Built ' + Math.round(b.workDone / def.work * 100) + '%');
      }
    }

    const d = game.designations[HF.U.key(t.x, t.y)];
    if (d) {
      lines.push('Order: ' + HF.ORDERS[d.type].label +
                 ' (' + Math.round(d.workDone / HF.ORDERS[d.type].work * 100) + '%)');
    }

    const c = game.colonistAt(t.x, t.y);
    if (c) lines.push('<b>' + c.name + '</b><br>' + c.activity);

    const r = game.raiders.find(function (rr) { return !rr.dead && rr.x === t.x && rr.y === t.y; });
    if (r) lines.push('<b>Bandit</b> (' + r.hp + ' hp)');

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
    if (sticky) tipTimer = setTimeout(function () { el.tooltip.style.display = 'none'; }, 3000);
  }

  /* ---------- buttons and keys ---------- */

  function closeSheet() { el.sidebar.classList.remove('open'); }

  function bindButtons() {
    $('btn-endturn').addEventListener('click', endTurn);
    $('mode-hint').addEventListener('click', function () { setMode('none', null); });
    $('btn-panel').addEventListener('click', function () { el.sidebar.classList.toggle('open'); });
    $('sheet-close').addEventListener('click', closeSheet);

    $('pick-order').addEventListener('click', function () { openPicker('order'); });
    $('pick-build').addEventListener('click', function () { openPicker('build'); });
    $('picker-close').addEventListener('click', closePicker);
    el.picker.addEventListener('click', function (e) { if (e.target === el.picker) closePicker(); });
    $('tool-cancel').addEventListener('click', function () { setMode('cancel', null); });

    $('zoom-in').addEventListener('click', function () { HF.Camera.zoomBy(1.35); });
    $('zoom-out').addEventListener('click', function () { HF.Camera.zoomBy(1 / 1.35); });
    $('recenter').addEventListener('click', function () {
      const sel = view.selectedId != null ? game.colonistById(view.selectedId) : null;
      const target = sel && !sel.dead ? sel : game.colonyCentre();
      HF.Camera.centerOn(target.x, target.y);
    });

    $('btn-new').addEventListener('click', newGame);
    $('ending-new').addEventListener('click', function () { $('ending').classList.remove('open'); newGame(); });
    $('ending-continue').addEventListener('click', function () {
      $('ending').classList.remove('open');
      if (game.gameOver === 'won') game.continuePlaying();
      endingDismissedFor = game.gameOver;
      refresh();
    });

    $('btn-save').addEventListener('click', function () {
      try {
        localStorage.setItem('hyakusho.save', game.serialize());
        toast('Village recorded.');
      } catch (err) {
        toast('Could not save: ' + err.message);
      }
    });
    $('btn-load').addEventListener('click', function () {
      let data = null;
      try { data = localStorage.getItem('hyakusho.save'); } catch (err) { data = null; }
      if (!data) { toast('No recorded village found.'); return; }
      try {
        setGame(HF.Game.load(data));
        toast('Village restored.');
      } catch (err) {
        toast('That record could not be read.');
      }
    });
    $('btn-help').addEventListener('click', function () { $('help').classList.toggle('open'); });
    $('help-close').addEventListener('click', function () { $('help').classList.remove('open'); });
  }

  function newGame() {
    setGame(new HF.Game((Math.random() * 0xffffffff) >>> 0));
  }

  function bindKeys() {
    const buildKeys = Object.keys(HF.BUILDINGS);
    window.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'enter') { e.preventDefault(); endTurn(); return; }
      if (k === 'escape') {
        setMode('none', null);
        $('help').classList.remove('open');
        closePicker();
        return;
      }
      if (k === 'x') { setMode('cancel', null); return; }
      if (k === 'h') { $('help').classList.toggle('open'); return; }
      if (k === 'b') { openPicker('build'); return; }
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
    renderEnding();
    updateToolButtons();
    HF.Render.invalidate();
  }

  function renderStats() {
    const cap = HF.Build.storageCap(game);
    el.stats.innerHTML =
      stat(HF.RESOURCES.food.label, Math.floor(game.res.food) + ' / ' + cap, 'food') +
      stat(HF.RESOURCES.wood.label, Math.floor(game.res.wood) + ' / ' + cap, 'wood') +
      stat(HF.RESOURCES.stone.label, Math.floor(game.res.stone) + ' / ' + cap, 'stone');

    el.calendar.innerHTML =
      '<div class="season ' + game.season().toLowerCase() + '">' + game.season() + '</div>' +
      '<div class="date">Year ' + game.year() + ' &middot; Day ' + game.dayOfSeason() + '</div>';

    // The levy is the clock the whole village runs on, so it gets its own slot.
    const due = game.turnsToLevy();
    const demand = game.levyDemand(game.levyIndex);
    const short = game.res.food < demand;
    el.levy.className = due <= 4 ? (short ? 'urgent' : 'due') : (short ? 'warn' : '');
    el.levy.innerHTML =
      '<div class="levy-label">Next levy</div>' +
      '<div class="levy-value">' + demand + ' koku &middot; ' +
      (due <= 0 ? 'now' : 'in ' + due + (due === 1 ? ' turn' : ' turns')) + '</div>';

    $('btn-panel').innerHTML = 'Village <span class="badge">' +
      game.aliveColonists().length + '</span>';
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

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  /* Who this person is, and every reason they feel the way they do.

     The thought list is the whole point of the panel. The mood arithmetic has
     always been there; showing it by name is what lets the player see that the
     village is miserable because nobody has a bed and the collectors came, and
     not just that a bar is low. */
  function detail(c) {
    const trait = HF.TRAITS[c.trait];
    const bond = c.bondTo != null ? game.colonistById(c.bondTo) : null;

    let h = '<div class="detail">';
    h += '<p class="who">' + esc(HF.U.capitalize(c.name.split(' ')[0])) + ' ' + esc(c.origin) +
         ', with ' + esc(c.mark) + '.</p>';
    if (trait) h += '<p class="who"><b>' + trait.label + '.</b> ' + trait.note + '</p>';
    if (bond && !bond.dead) {
      h += '<p class="who">' + esc(HF.U.capitalize(c.name.split(' ')[0])) + ' is ' +
           esc(c.bondKind || 'close to') + ' ' + esc(bond.name) + '.</p>';
    }

    const thoughts = HF.Colonists.thoughts(game, c).slice().sort(function (a, b) {
      return a.delta - b.delta;
    });
    h += '<h3>Thoughts</h3>';
    if (!thoughts.length) {
      h += '<p class="who">Nothing much on their mind.</p>';
    } else {
      h += '<ul class="thoughts">';
      for (const t of thoughts) {
        const n = Math.round(t.delta);
        if (!n) continue;
        h += '<li class="' + (n > 0 ? 'up' : 'down') + '"><span>' + esc(t.label) +
             (t.fades ? '<em> &middot; fading</em>' : '') + '</span><b>' +
             (n > 0 ? '+' : '') + n + '</b></li>';
      }
      h += '</ul>';
    }
    return h + '</div>';
  }

  function renderColonists() {
    const alive = game.aliveColonists();
    const beds = HF.Build.bedCount(game);
    let html = '<h2>Villagers <span class="count">' + alive.length + '</span>' +
               ' &middot; Beds <span class="count' + (beds < alive.length ? ' short' : '') + '">' +
               beds + '</span></h2>';

    if (alive.length === 0) html += '<p class="empty">No one is left.</p>';

    for (const c of alive) {
      const selected = view.selectedId === c.id;
      const trait = HF.TRAITS[c.trait];
      html += '<div class="colonist' + (selected ? ' selected' : '') + '" data-id="' + c.id + '">';
      html += '<div class="row-head">' +
              '<button class="name" data-rename="' + c.id + '" title="Tap to rename">' +
              esc(c.name) + '</button>' +
              '<span class="activity">' + c.activity + '</span></div>';
      if (trait) {
        html += '<div class="trait-line"><span class="trait">' + trait.label + '</span> &middot; ' +
                (HF.SKILL_LABELS[c.specialty] || c.specialty) + '</div>';
      }
      html += '<div class="bars">' +
              bar('Food', c.needs.food, 100, 'food') +
              bar('Rest', c.needs.rest, 100, 'rest') +
              bar('Spirit', c.mood, 100, 'mood') +
              bar('Health', c.hp, c.maxHp, 'hp') +
              '</div>';

      // Everything below only appears for the villager the player has actually
      // asked about, so the roster stays scannable and tapping earns something.
      if (selected) html += detail(c);

      html += '<div class="works">';
      for (const wt of HF.WORK_TYPES) {
        const lvl = HF.Colonists.skillLevel(c, wt.skill);
        html += '<button class="work' + (c.work[wt.id] ? ' on' : '') +
                '" data-colonist="' + c.id + '" data-work="' + wt.id + '" title="' +
                wt.label + ' — skill ' + lvl + '. Tap to turn this work on or off.">' +
                wt.short + '<span class="lvl">' + lvl + '</span></button>';
      }
      html += '</div></div>';
    }

    el.colonists.innerHTML = html;

    /* Letting the player put their own names in is the cheapest way to make
       them care what happens to these people. */
    for (const btn of el.colonists.querySelectorAll('[data-rename]')) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const c = game.colonistById(parseInt(btn.dataset.rename, 10));
        if (!c) return;
        const next = window.prompt('Call this villager:', c.name);
        if (next == null) return;
        const clean = next.trim().slice(0, 28);
        if (!clean) return;
        c.name = clean;
        c.renamed = true;
        renderColonists();
        HF.Render.invalidate();
      });
    }

    for (const node of el.colonists.querySelectorAll('.colonist')) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('.work') || e.target.closest('[data-rename]')) return;
        const id = parseInt(node.dataset.id, 10);
        // Tapping the selected villager again folds them back up. The sheet
        // deliberately stays open on a phone now: selecting is what reveals the
        // thought list, so closing it would hide the thing just asked for.
        view.selectedId = view.selectedId === id ? null : id;
        const c = game.colonistById(view.selectedId);
        if (c) HF.Camera.centerOn(c.x, c.y);
        renderColonists();
        HF.Render.invalidate();
      });
    }
    for (const btn of el.colonists.querySelectorAll('.work')) {
      btn.addEventListener('click', function () {
        const c = game.colonistById(parseInt(btn.dataset.colonist, 10));
        if (!c) return;
        c.work[btn.dataset.work] = !c.work[btn.dataset.work];
        // Drop a job the villager is no longer willing to do.
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

  /* ---------- the ending ---------- */

  const ENDINGS = {
    won: {
      title: 'The village endures',
      sub: 'Three harvests brought in, three levies paid, and the valley is still yours.',
      mark: '村',
    },
    dissolved: {
      title: 'The village is broken up',
      sub: 'Twice the collectors went away short. The castle has no further use for this valley.',
      mark: '散',
    },
    lost: {
      title: 'Nothing remains',
      sub: 'The last of the villagers is gone, and the paddies go back to grass.',
      mark: '無',
    },
  };

  function renderEnding() {
    const node = $('ending');
    if (!game.gameOver || endingDismissedFor === game.gameOver) {
      node.classList.remove('open');
      return;
    }
    const e = ENDINGS[game.gameOver];
    const s = game.summary();
    $('ending-mark').textContent = e.mark;
    $('ending-title').textContent = e.title;
    $('ending-sub').textContent = e.sub;

    const rows = [
      ['Years held', s.years],
      ['Villagers living', s.alive],
      ['Levies paid', s.leviesPaid + (s.leviesMissed ? ' (' + s.leviesMissed + ' missed)' : '')],
      ['Rice in the kura', s.rice + ' koku'],
      ['Buildings raised', s.built],
      ['Bandits cut down', s.bandits],
    ];
    if (s.lost) rows.push(['Died', s.lost]);
    if (s.departed) rows.push(['Walked out', s.departed]);

    $('ending-stats').innerHTML = rows.map(function (r) {
      return '<li><span>' + r[0] + '</span><b>' + r[1] + '</b></li>';
    }).join('');

    $('ending-continue').textContent = game.gameOver === 'won' ? 'Carry on' : 'Look around';
    node.classList.add('open');
  }

  return { init: init, setGame: setGame };
})();
