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
  const view = { hover: null, selectedId: null, mode: { kind: 'none', id: null }, drag: null,
                 fill: false, plan: null };

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
    openHelpOnFirstVisit();
    requestAnimationFrame(frame);
  }

  /* The opening sheet is where the game explains itself and where the player
     chooses how hard the world presses - both of which were unreachable while
     it only ever opened from a Help button nobody had a reason to press. */
  function openHelpOnFirstVisit() {
    let seen = false;
    try { seen = window.localStorage.getItem('hyakusho.seenHelp') === '1'; }
    catch (err) { /* private mode - show it, no harm done */ }
    if (seen) return;
    $('help').classList.add('open');
    try { window.localStorage.setItem('hyakusho.seenHelp', '1'); } catch (err) { /* ignore */ }
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

  /* One loop for everything: step the simulation by however much real time has
     passed, paint, and rebuild the side panels a few times a second. The panels
     are rebuilt on a timer rather than every frame because they are innerHTML
     and would otherwise dominate the cost of running at all. */
  function frame(now) {
    const dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
    lastFrame = now;

    advance(dt);
    HF.Render.draw(game, view, HF.Time.SPEEDS[speed] > 0 && !game.gameOver);

    panelCarry += dt;
    if (panelCarry > 0.35) {
      panelCarry = 0;
      renderStats();
      renderColonists();
      renderLog();
      renderEnding();
    }
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
    const deconBtn = $('tool-decon'), fillBtn = $('tool-fill');
    deconBtn.classList.toggle('active', view.mode.kind === 'deconstruct');
    fillBtn.classList.toggle('active', view.fill);
    // The fill toggle only means anything while holding something that encloses.
    const wallish = view.mode.kind === 'build' && HF.BUILDINGS[view.mode.id].encloses;
    fillBtn.classList.toggle('dimmed', !wallish);
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
  /* The hint is the readout as well as the label. While a drag is live it says
     exactly how many tiles will take, what it will cost, and whether the stores
     can cover it - so nobody has to drag, release, and then find out. */
  function updateHint() {
    const hint = $('mode-hint');
    if (view.mode.kind === 'none') { hint.className = ''; hint.innerHTML = ''; view.plan = null; return; }

    const plan = view.drag ? planFor(view.drag) : null;
    view.plan = plan;
    let text, warn = false;

    if (plan && (plan.ok.length || plan.bad.length)) {
      const n = plan.ok.length;
      if (plan.kind === 'build') {
        const def = HF.BUILDINGS[plan.id];
        const parts = [];
        for (const r in plan.cost) parts.push(plan.cost[r] + ' ' + HF.RESOURCES[r].label.toLowerCase());
        warn = !affordable(plan.cost);
        text = def.label + ' &times;' + n + (parts.length ? ' &middot; ' + parts.join(' + ') : '');
        const clearing = (plan.clearing || []).length;
        if (clearing) text += ' &middot; ' + clearing + ' to clear first';
        if (warn) text += ' &middot; not in store yet';
      } else if (plan.kind === 'order') {
        text = HF.ORDERS[plan.id].label + ' &times;' + n;
      } else if (plan.kind === 'cancel') {
        text = 'Call off &times;' + n;
      } else {
        text = 'Pull down &times;' + n;
      }
    } else if (view.mode.kind === 'order') {
      text = HF.ORDERS[view.mode.id].label + ' — drag over the map';
    } else if (view.mode.kind === 'build') {
      const def = HF.BUILDINGS[view.mode.id];
      text = def.label + ' — ' + (def.encloses && !view.fill ? 'drag a room' : 'drag to place') +
             ' &middot; ' + costText(def.cost).toLowerCase() + ' each';
    } else if (view.mode.kind === 'deconstruct') {
      text = 'Deconstruct — drag over what to pull down';
    } else {
      text = 'Cancel — drag over plans and orders to call off';
    }

    hint.innerHTML = text + '<span class="clear">&times;</span>';
    hint.className = 'show' + (warn ? ' warn' : '') +
                     (view.mode.kind === 'deconstruct' || view.mode.kind === 'cancel' ? ' danger' : '');
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
      // Grouped, because there are now three different questions being asked:
      // what shape is the room, what goes in it, and what does the village work.
      for (const cat of HF.BUILD_CATEGORIES) {
        html += '<div class="pick-group"><span class="pick-group-name">' + cat.label +
                '</span><span class="pick-group-note">' + cat.note + '</span></div>';
        for (const id in HF.BUILDINGS) {
          const b = HF.BUILDINGS[id];
          if (b.cat !== cat.id) continue;
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

  /* ---------- a bench ----------
     Tapping a built bench opens its work list. One recipe at a time, on or
     off: a queue with counts and priorities would be a second game, and this
     is the smallest thing that makes hemp and herbs worth picking up. */
  function openBench(b) {
    const current = game.recipes[b.id] || null;
    let h = '<div class="ledger"><p class="who">Choose what this bench is set to. ' +
            'Villagers who will do the work come and do it whenever the materials ' +
            'are in the stores.</p></div>';
    h += '<button class="pick' + (current === null ? ' chosen' : '') +
         '" data-recipe="" data-bench="' + b.id + '">' +
         '<span class="pick-mark" style="background:#3a4453"></span>' +
         '<span class="pick-text"><span class="pick-name">Nothing</span>' +
         '<span class="pick-desc">Leave the bench idle.</span></span>' +
         '<span class="pick-cost free">&mdash;</span></button>';

    for (const id in HF.RECIPES) {
      const r = HF.RECIPES[id];
      if (r.station !== HF.BUILDINGS[b.type].station) continue;
      const ok = affordable(r.cost);
      h += '<button class="pick' + (current === id ? ' chosen' : '') +
           '" data-recipe="' + id + '" data-bench="' + b.id + '">' +
           '<span class="pick-mark" style="background:' +
           (HF.RESOURCES[Object.keys(r.yields)[0]] || {}).color + '"></span>' +
           '<span class="pick-text"><span class="pick-name">' + esc(r.label) + '</span>' +
           '<span class="pick-desc">' + esc(r.note) + '</span></span>' +
           '<span class="pick-cost' + (ok ? '' : ' short') + '">' +
           costText(r.cost) + ' &rarr; ' + costText(r.yields) + '</span></button>';
    }

    el.pickerTitle.textContent = HF.BUILDINGS[b.type].label;
    el.pickerList.innerHTML = h;
    for (const btn of el.pickerList.querySelectorAll('[data-recipe]')) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.recipe;
        const bid = +btn.dataset.bench;
        if (id) game.recipes[bid] = id;
        else delete game.recipes[bid];
        const target = game.buildings[bid];
        if (target) target.craftDone = 0;
        closePicker();
        refresh();
      });
    }
    el.picker.classList.add('open');
  }

  /* ---------- how hard the world presses ----------
     Offered on the opening sheet rather than buried in a settings menu,
     because whether anything is coming over the hill changes what the game
     even is, and the player should get to say so before the first turn. */
  const SCENARIO_KEY = 'hyakusho.scenario';

  function savedScenario() {
    try {
      const s = window.localStorage.getItem(SCENARIO_KEY);
      if (s && HF.SCENARIOS[s]) return s;
    } catch (err) { /* private mode - fall through */ }
    return HF.DEFAULT_SCENARIO;
  }

  function renderScenarioPick() {
    const host = $('scenario-pick');
    if (!host) return;
    const current = game ? game.scenarioId : savedScenario();
    let h = '';
    for (const id in HF.SCENARIOS) {
      const s = HF.SCENARIOS[id];
      h += '<button class="scen' + (id === current ? ' on' : '') + '" data-scen="' + id + '">' +
           '<span class="scen-name">' + s.label + '</span>' +
           '<span class="scen-note">' + s.note + '</span></button>';
    }
    host.innerHTML = h;
    for (const btn of host.querySelectorAll('.scen')) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.scen;
        try { window.localStorage.setItem(SCENARIO_KEY, id); } catch (err) { /* ignore */ }
        // Changing how the world presses restarts it, since the levy schedule
        // and the raid clock are both set when the valley is made.
        setGame(new HF.Game((Math.random() * 0xffffffff) >>> 0, id));
        renderScenarioPick();
      });
    }
  }

  /* ---------- the ledger ----------
     Standing is the thing the whole game now turns on, and a one-word label on
     a chip cannot carry it. This sheet says what the castle thinks, why, and
     lets the player choose to pay over the demand to build credit. */
  function openLedger() {
    const S = HF.CFG.STANDING;
    const demand = game.levyDemand(game.levyIndex);
    const have = Math.floor(game.res.food);
    const due = game.daysToLevy();
    const pct = HF.U.clamp(game.standing, 0, 100);

    let h = '<div class="ledger">';
    h += '<div class="standing-bar"><div class="fill" style="width:' + pct + '%"></div>' +
         '<span>Standing &middot; ' + esc(game.standingWord()) + '</span></div>';
    h += '<p class="who">The castle asks <b>' + demand + ' koku</b> ' +
         (due <= 0 ? '<b>now</b>' : 'in <b>' + due + (due === 1 ? ' day' : ' days') + '</b>') +
         '. The kura holds <b>' + have + '</b>.</p>';
    h += '<p class="who">Falling short costs standing in proportion to how far short you fall — ' +
         'a few koku is a note in a ledger, half the demand is a mark against the village. ' +
         'At nothing left, the village is broken up.</p>';
    if (game.standing >= S.favourAt) {
      h += '<p class="who good">The village is in favour, and this year\'s due has been eased.</p>';
    }

    h += '<button class="toggle-row' + (game.levyGenerous ? ' on' : '') + '" id="levy-generous">' +
         '<span class="tick">' + (game.levyGenerous ? '&#10003;' : '') + '</span>' +
         '<span class="toggle-text"><b>Press surplus on the collectors</b>' +
         '<em>Hand over up to ' + (S.overPer * S.overCap) + ' koku beyond the demand to buy ' +
         'standing. Rice you cannot eat later, for a castle that remembers.</em></span></button>';

    if (game.levyHistory.length) {
      h += '<h3>The record</h3><ul class="thoughts">';
      for (const l of game.levyHistory.slice(-6)) {
        h += '<li class="' + (l.paid ? 'up' : 'down') + '"><span>Year ' + l.year + ' &middot; ' +
             (l.paid ? 'paid ' + l.demand + (l.extra ? ' and ' + l.extra + ' over' : '')
                     : 'short by ' + l.short) + '</span><b>' +
             (l.paid ? '&#10003;' : '&times;') + '</b></li>';
      }
      h += '</ul>';
    }
    h += '</div>';

    el.pickerTitle.textContent = 'The Levy';
    el.pickerList.innerHTML = h;
    const t = $('levy-generous');
    if (t) t.addEventListener('click', function () {
      game.levyGenerous = !game.levyGenerous;
      openLedger();
    });
    el.picker.classList.add('open');
  }

  /* ---------- merchants ----------
     One person, one offer, accept or decline. A trade screen would be
     arithmetic; an offer with somebody's face on it is a decision. */
  function renderOfferChip() {
    const chip = $('offer-chip');
    if (!chip) return;
    if (!game.offer) { chip.className = ''; chip.innerHTML = ''; return; }
    const o = game.offer;
    chip.className = 'show';
    chip.innerHTML = '<span class="offer-mark">&#9678;</span> A trader is here &middot; ' +
      o.wantAmount + ' ' + esc(HF.RESOURCES[o.wants].label.toLowerCase()) + ' for ' +
      o.giveAmount + ' ' + esc(HF.RESOURCES[o.gives].label.toLowerCase());
  }

  function openOffer() {
    const o = game.offer;
    if (!o) return;
    const W = HF.RESOURCES[o.wants], G = HF.RESOURCES[o.gives];
    const canPay = game.res[o.wants] >= o.wantAmount;
    const leaves = game.daysToLevy();

    let h = '<div class="ledger">';
    h += '<p class="who lede">' + esc(o.who) + '.</p>';
    h += '<div class="trade">' +
         '<span class="side give"><b>' + o.wantAmount + '</b>' + esc(W.label) + '</span>' +
         '<span class="arrow">&rarr;</span>' +
         '<span class="side get"><b>' + o.giveAmount + '</b>' + esc(G.label) + '</span></div>';
    h += '<p class="who">You hold ' + Math.floor(game.res[o.wants]) + ' ' +
         esc(W.label.toLowerCase()) + '. They will wait ' +
         Math.max(0, o.until - game.day()) + ' more ' +
         (o.until - game.day() === 1 ? 'day' : 'days') + '.</p>';
    if (o.gives === 'food' && leaves > 0) {
      h += '<p class="who">The levy falls in ' + leaves + ' days.</p>';
    }
    h += '<div class="offer-actions">' +
         '<button id="offer-yes" class="primary"' + (canPay ? '' : ' disabled') + '>' +
         (canPay ? 'Strike the deal' : 'Not enough ' + esc(W.label.toLowerCase())) + '</button>' +
         '<button id="offer-no" class="plain">Send them on</button></div>';
    h += '</div>';

    el.pickerTitle.textContent = 'An Offer';
    el.pickerList.innerHTML = h;
    const yes = $('offer-yes'), no = $('offer-no');
    if (yes) yes.addEventListener('click', function () {
      const err = HF.Events.acceptOffer(game);
      if (err) { toast(err); return; }
      closePicker();
      refresh();
    });
    if (no) no.addEventListener('click', function () {
      HF.Events.declineOffer(game);
      closePicker();
      refresh();
    });
    el.picker.classList.add('open');
  }

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
          e.target.closest('#ending') || e.target.closest('#mode-hint') ||
          e.target.closest('#offer-chip')) return;
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
            updateHint();
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
        if (view.drag) { applyToRect(view.drag); view.drag = null; updateHint(); refresh(); }
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
    // A finished bench is the one thing on the map you operate by tapping it.
    const b = game.buildingAt(t.x, t.y);
    if (b && b.built && HF.BUILDINGS[b.type].station) { openBench(b); return; }

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

  /* ---------- planning a drag ----------

     Every drag is turned into a plan before anything happens: which tiles it
     would touch, which of those would actually work, and what it costs. The
     plan drives the ghost the player sees and then gets executed on release,
     so what you are shown and what you get cannot drift apart.

     Walls fill only the edge of the dragged rectangle. Dragging out a room and
     getting a solid block of timber is never what anyone wanted, and doing it
     by hand one side at a time is the tedium this is here to remove. Hold the
     Fill toggle to get the block. */
  function tilesFor(drag, kind, id) {
    const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1);
    const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
    const out = [];
    const def = kind === 'build' ? HF.BUILDINGS[id] : null;
    const outline = def && def.encloses && !view.fill;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (outline && x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
        out.push({ x: x, y: y });
      }
    }
    return out;
  }

  function planFor(drag) {
    const kind = view.mode.kind, id = view.mode.id;
    if (kind === 'none') return null;
    const tiles = tilesFor(drag, kind, id);
    const plan = { kind: kind, id: id, ok: [], bad: [], clearing: [], cost: {}, reason: null };

    for (const t of tiles) {
      if (kind === 'order') {
        const tile = HF.Map.at(game, t.x, t.y);
        const here = game.designations[HF.U.key(t.x, t.y)];
        const free = tile && !here && tile.building == null;
        (free && HF.ORDERS[id].valid(tile) ? plan.ok : plan.bad).push(t);
      } else if (kind === 'build') {
        const res = HF.Build.canPlace(game, id, t.x, t.y);
        if (res.ok) {
          plan.ok.push(t);
          if (res.needsClearing) plan.clearing.push(t);
        } else { plan.bad.push(t); plan.reason = plan.reason || res.reason; }
      } else if (kind === 'cancel') {
        const b = game.buildingAt(t.x, t.y);
        const hasOrder = !!game.designations[HF.U.key(t.x, t.y)];
        ((b && !b.built) || hasOrder ? plan.ok : plan.bad).push(t);
      } else if (kind === 'deconstruct') {
        const b = game.buildingAt(t.x, t.y);
        (b && b.built && !b.deconstruct ? plan.ok : plan.bad).push(t);
      }
    }

    if (kind === 'build') {
      const def = HF.BUILDINGS[id];
      for (const r in def.cost) plan.cost[r] = def.cost[r] * plan.ok.length;
    }
    return plan;
  }

  /* Everything placed in one drag is one batch, so undo takes back the whole
     wall rather than the last brick of it. */
  const undoStack = [];

  function applyToRect(drag) {
    const plan = planFor(drag);
    if (!plan) return;
    let placed = 0;
    const batch = [];

    for (const t of plan.ok) {
      if (plan.kind === 'order') {
        if (game.designate(plan.id, t.x, t.y)) { placed++; batch.push({ what: 'order', x: t.x, y: t.y }); }
      } else if (plan.kind === 'build') {
        const res = HF.Build.place(game, plan.id, t.x, t.y);
        if (res.ok) { placed++; batch.push({ what: 'build', x: t.x, y: t.y }); }
      } else if (plan.kind === 'cancel') {
        if (game.undesignate(t.x, t.y)) placed++;
        if (HF.Build.remove(game, t.x, t.y)) placed++;
      } else if (plan.kind === 'deconstruct') {
        if (HF.Build.markDeconstruct(game, t.x, t.y)) { placed++; batch.push({ what: 'decon', x: t.x, y: t.y }); }
      }
    }

    if (batch.length) {
      undoStack.push(batch);
      if (undoStack.length > 30) undoStack.shift();
    }

    if (placed === 0) {
      if (plan.kind === 'build' && plan.reason) toast(plan.reason);
      else if (plan.kind === 'order') {
        toast('Nothing there to ' + HF.ORDERS[plan.id].label.toLowerCase() + '.');
      } else if (plan.kind === 'cancel') toast('No plans or orders there to call off.');
      else if (plan.kind === 'deconstruct') toast('Nothing standing there to pull down.');
    }
    HF.Render.invalidate();
  }

  /* Takes back the last drag: blueprints vanish, deconstruction marks are
     lifted, work orders are unmarked. Nothing that has actually been built or
     already pulled down comes back - undo is for the plan, not the village. */
  function undoLast() {
    const batch = undoStack.pop();
    if (!batch) { toast('Nothing to undo.'); return; }
    let n = 0;
    for (const item of batch) {
      if (item.what === 'order') { if (game.undesignate(item.x, item.y)) n++; }
      else if (item.what === 'build') {
        const b = game.buildingAt(item.x, item.y);
        if (b && !b.built && HF.Build.remove(game, item.x, item.y)) n++;
      } else if (item.what === 'decon') {
        if (HF.Build.unmarkDeconstruct(game, item.x, item.y)) n++;
      }
    }
    toast(n ? 'Took back ' + n + (n === 1 ? ' plan.' : ' plans.') : 'That is already done.');
    refresh();
  }

  let toastTimer = null;
  function toast(message, ms) {
    el.banner.textContent = message;
    el.banner.className = 'show warn';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.banner.className = ''; }, ms || 2800);
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
    for (const btn of document.querySelectorAll('#speed button')) {
      btn.addEventListener('click', function () { setSpeed(+btn.dataset.speed); });
    }
    $('mode-hint').addEventListener('click', function () { setMode('none', null); });
    el.levy.addEventListener('click', openLedger);
    $('offer-chip').addEventListener('click', openOffer);
    $('btn-panel').addEventListener('click', function () { el.sidebar.classList.toggle('open'); });
    $('sheet-close').addEventListener('click', closeSheet);

    $('pick-order').addEventListener('click', function () { openPicker('order'); });
    $('pick-build').addEventListener('click', function () { openPicker('build'); });
    $('picker-close').addEventListener('click', closePicker);
    el.picker.addEventListener('click', function (e) { if (e.target === el.picker) closePicker(); });
    $('tool-cancel').addEventListener('click', function () { setMode('cancel', null); });
    $('tool-decon').addEventListener('click', function () { setMode('deconstruct', null); });
    $('tool-undo').addEventListener('click', undoLast);
    $('tool-fill').addEventListener('click', function () {
      view.fill = !view.fill;
      updateToolButtons();
      HF.Render.invalidate();
    });

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
    renderScenarioPick();
  }

  function newGame() {
    setGame(new HF.Game((Math.random() * 0xffffffff) >>> 0, savedScenario()));
  }

  function bindKeys() {
    const buildKeys = Object.keys(HF.BUILDINGS);
    window.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      // Space is pause, the way it is in every game like this.
      if (k === ' ') { e.preventDefault(); togglePause(); return; }
      if (k === '1' || k === '2' || k === '3') { setSpeed(+k); return; }
      if (k === 'escape') {
        setMode('none', null);
        $('help').classList.remove('open');
        closePicker();
        return;
      }
      if (k === 'x') { setMode('cancel', null); return; }
      if (k === 'v') { setMode('deconstruct', null); return; }
      if (k === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undoLast(); return; }
      if (k === 'r') { view.fill = !view.fill; updateToolButtons(); HF.Render.invalidate(); return; }
      if (k === 'h') { $('help').classList.toggle('open'); return; }
      if (k === 'b') { openPicker('build'); return; }
      for (const id in HF.ORDERS) {
        if (HF.ORDERS[id].key && HF.ORDERS[id].key.toLowerCase() === k) { setMode('order', id); return; }
      }
      const n = parseInt(k, 10);
      if (n >= 1 && n <= buildKeys.length) setMode('build', buildKeys[n - 1]);
    });
  }

  /* ---------- the clock ----------
     The game advances on its own; the player sets the speed. Pause is a real
     speed rather than a special case, so "stop and think" is always one tap
     away - which is what makes a live simulation playable rather than frantic. */
  let speed = 1;
  let lastFrame = 0;
  let tickCarry = 0;
  let panelCarry = 0;

  function setSpeed(n) {
    speed = HF.U.clamp(n, 0, HF.Time.SPEEDS.length - 1);
    tickCarry = 0;
    updateSpeedButtons();
    HF.Render.invalidate();
  }

  function togglePause() { setSpeed(speed === 0 ? 1 : 0); }

  function updateSpeedButtons() {
    for (const btn of document.querySelectorAll('#speed button')) {
      btn.classList.toggle('on', +btn.dataset.speed === speed);
    }
  }

  function advance(dtSeconds) {
    if (game.gameOver) return;
    const mult = HF.Time.SPEEDS[speed];
    if (!mult) return;
    const hadOffer = !!game.offer;

    tickCarry += dtSeconds * HF.Time.BASE_TPS * mult;
    // Cap the catch-up so a backgrounded tab does not come back and run a
    // week of village history in one frame.
    let budget = Math.min(Math.floor(tickCarry), 40);
    tickCarry -= Math.floor(tickCarry);
    while (budget-- > 0 && !game.gameOver) game.step();
    HF.Render.setSubTick(tickCarry);

    HF.Render.invalidate();
    // The first trader gets a nudge rather than a sheet. A village nobody is
    // pressing should never be interrupted by a box demanding an answer.
    if (!hadOffer && game.offer && !game.taughtTrade) {
      game.taughtTrade = true;
      toast('A trader has come up the valley — tap the chip to hear the offer.', 4200);
    }
  }

  /* ---------- panels ---------- */

  function refresh() {
    renderStats();
    renderColonists();
    renderLog();
    renderEnding();
    updateToolButtons();
    updateSpeedButtons();
    HF.Render.invalidate();
  }

  function renderStats() {
    /* Seven stores will not fit across a phone, so the three you build with are
       always shown with their cap and the crafted ones only once the village
       actually has any. An empty slot for a thing nobody has made yet is just
       a question the player cannot answer. */
    const cap = HF.Build.storageCap(game);
    let statsHtml =
      stat(HF.RESOURCES.food.label, Math.floor(game.res.food) + ' / ' + cap, 'food') +
      stat(HF.RESOURCES.wood.label, Math.floor(game.res.wood) + ' / ' + cap, 'wood') +
      stat(HF.RESOURCES.stone.label, Math.floor(game.res.stone) + ' / ' + cap, 'stone');
    for (const r of ['hemp', 'herb', 'cloth', 'med']) {
      const n = Math.floor(game.res[r] || 0);
      if (n > 0) statsHtml += stat(HF.RESOURCES[r].short, String(n), r + ' minor');
    }
    el.stats.innerHTML = statsHtml;

    $('clock').innerHTML =
      '<div class="clock-time">' + game.clock() + '</div>' +
      '<div class="clock-phase ' + HF.Time.phase(game.tick) + '">' +
      HF.Time.phase(game.tick) + '</div>';

    el.calendar.innerHTML =
      '<div class="season ' + game.season().toLowerCase() + '">' + game.season() + '</div>' +
      '<div class="date">Year ' + game.year() + ' &middot; Day ' + game.dayOfSeason() + '</div>';

    // The levy is the clock the whole village runs on, so it gets its own slot.
    // Tapping it opens the ledger, which is where standing is explained. In an
    // open valley there is no clock, so the slot goes away entirely rather than
    // sitting there reading zero.
    if (!game.scenario().levy) {
      el.levy.className = 'hidden';
      el.levy.innerHTML = '';
      renderOfferChip();
      $('btn-panel').innerHTML = 'Village <span class="badge">' +
        game.aliveColonists().length + '</span>';
      return;
    }
    const due = game.daysToLevy();
    const demand = game.levyDemand(game.levyIndex);
    const short = game.res.food < demand;
    el.levy.className = due <= 4 ? (short ? 'urgent' : 'due') : (short ? 'warn' : '');
    el.levy.innerHTML =
      '<div class="levy-label">Next levy &middot; ' + game.standingWord() + '</div>' +
      '<div class="levy-value">' + demand + ' koku &middot; ' +
      (due <= 0 ? 'now' : 'in ' + due + (due === 1 ? ' day' : ' days')) + '</div>';

    renderOfferChip();

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
      return '<li class="' + e.kind + '"><span class="turn">' + e.day + '</span>' + e.message + '</li>';
    }).join('');
  }

  /* ---------- the ending ---------- */

  const ENDINGS = {
    won: {
      title: 'The village endures',
      sub: 'Four harvests brought in, four levies met, and the valley is still yours.',
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

  return {
    init: init, setGame: setGame, savedScenario: savedScenario,
    debugView: function () { return view; },      // for tests only
    debugPlan: function () { view.plan = planFor(view.drag); },
    debugRefreshHint: updateHint,
  };
})();
