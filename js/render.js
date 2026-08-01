/* Canvas drawing. Terrain is painted once into an offscreen buffer and only
   repainted when the map actually changes; everything that moves is drawn on
   top of that each frame. */
window.HF = window.HF || {};

HF.Render = (function () {
  const T = HF.CFG.TILE;

  const COLORS = {
    water: ['#2b556e', '#33627d'],
    sand: ['#c9b184', '#d4bd92'],
    grass: ['#63864a', '#719654'],
    forest: ['#4d7040', '#567a46'],
    hill: ['#847d6d', '#918a79'],
    mountain: ['#6b665e', '#7a746b'],
  };

  const ORDER_COLOR = {
    chop: '#e0a83f',
    mine: '#7fa8d9',
    forage: '#dd7f8d',
    harvest: '#9ad46a',
  };

  let canvas, ctx, buffer, bctx;

  function mix(hexA, hexB, t) {
    const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
    const ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255;
    const br = b >> 16, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function init(cv) {
    canvas = cv;
    canvas.width = HF.CFG.MAP_W * T;
    canvas.height = HF.CFG.MAP_H * T;
    ctx = canvas.getContext('2d');
    buffer = document.createElement('canvas');
    buffer.width = canvas.width;
    buffer.height = canvas.height;
    bctx = buffer.getContext('2d');
  }

  /* ---------- terrain buffer ---------- */

  function paintTerrain(game) {
    bctx.clearRect(0, 0, buffer.width, buffer.height);

    for (let y = 0; y < game.h; y++) {
      for (let x = 0; x < game.w; x++) {
        const tile = game.tiles[y * game.w + x];
        const px = x * T, py = y * T;
        const pal = COLORS[tile.terrain] || COLORS.grass;
        bctx.fillStyle = mix(pal[0], pal[1], tile.variant);
        bctx.fillRect(px, py, T, T);

        if (tile.terrain === 'forest') drawTree(bctx, px, py, tile.variant);
        else if (tile.terrain === 'mountain') drawMountain(bctx, px, py, tile.variant);
        else if (tile.terrain === 'hill') drawRocks(bctx, px, py, tile.variant);
        else if (tile.terrain === 'water') drawRipple(bctx, px, py, tile.variant);

        if (tile.feature === 'berries') drawBerries(bctx, px, py, tile.variant);
      }
    }

    // Faint grid so the tile structure reads without dominating the art.
    bctx.strokeStyle = 'rgba(0,0,0,0.10)';
    bctx.lineWidth = 1;
    bctx.beginPath();
    for (let x = 0; x <= game.w; x++) { bctx.moveTo(x * T + 0.5, 0); bctx.lineTo(x * T + 0.5, buffer.height); }
    for (let y = 0; y <= game.h; y++) { bctx.moveTo(0, y * T + 0.5); bctx.lineTo(buffer.width, y * T + 0.5); }
    bctx.stroke();
  }

  function drawTree(c, px, py, v) {
    const cx = px + T / 2 + (v - 0.5) * 4;
    const cy = py + T / 2 + (v - 0.5) * 3;
    const r = T * 0.30 + v * 2;
    c.fillStyle = '#3a5c33';
    c.fillRect(cx - 1.5, cy, 3, T * 0.28);
    c.fillStyle = v > 0.5 ? '#2f5730' : '#356334';
    c.beginPath();
    c.moveTo(cx, cy - r * 1.5);
    c.lineTo(cx + r, cy + r * 0.55);
    c.lineTo(cx - r, cy + r * 0.55);
    c.closePath();
    c.fill();
  }

  function drawMountain(c, px, py, v) {
    c.fillStyle = '#585349';
    c.beginPath();
    c.moveTo(px + T * 0.5, py + T * 0.12);
    c.lineTo(px + T * 0.95, py + T * 0.9);
    c.lineTo(px + T * 0.05, py + T * 0.9);
    c.closePath();
    c.fill();
    c.fillStyle = v > 0.6 ? '#cfd3d6' : '#8d8880';
    c.beginPath();
    c.moveTo(px + T * 0.5, py + T * 0.12);
    c.lineTo(px + T * 0.68, py + T * 0.45);
    c.lineTo(px + T * 0.32, py + T * 0.45);
    c.closePath();
    c.fill();
  }

  function drawRocks(c, px, py, v) {
    c.fillStyle = 'rgba(60,56,50,0.55)';
    c.beginPath();
    c.ellipse(px + T * (0.3 + v * 0.2), py + T * 0.62, T * 0.16, T * 0.11, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(px + T * (0.65 - v * 0.15), py + T * 0.38, T * 0.11, T * 0.08, 0, 0, Math.PI * 2);
    c.fill();
  }

  function drawRipple(c, px, py, v) {
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(px + T * 0.2, py + T * (0.35 + v * 0.3));
    c.lineTo(px + T * 0.8, py + T * (0.35 + v * 0.3));
    c.stroke();
  }

  function drawBerries(c, px, py, v) {
    c.fillStyle = '#4a6b3a';
    c.beginPath();
    c.ellipse(px + T / 2, py + T * 0.6, T * 0.26, T * 0.2, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#c8434f';
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.arc(px + T * (0.35 + i * 0.15), py + T * (0.52 + (i === 1 ? 0.14 : 0.05) + v * 0.05), 1.9, 0, Math.PI * 2);
      c.fill();
    }
  }

  /* ---------- buildings ---------- */

  function drawBuilding(c, game, b) {
    const px = b.x * T, py = b.y * T;
    const def = HF.BUILDINGS[b.type];

    if (!b.built) {
      c.save();
      c.fillStyle = 'rgba(220,230,255,0.12)';
      c.fillRect(px + 2, py + 2, T - 4, T - 4);
      c.setLineDash([4, 3]);
      c.strokeStyle = 'rgba(200,220,255,0.85)';
      c.lineWidth = 1.5;
      c.strokeRect(px + 2.5, py + 2.5, T - 5, T - 5);
      c.restore();
      c.fillStyle = 'rgba(230,240,255,0.9)';
      c.font = 'bold 11px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(def.label.charAt(0), px + T / 2, py + T / 2 + 4);
      progressBar(c, px, py, b.workDone / def.work, '#8fc7ff');
      return;
    }

    if (b.type === 'house') {
      c.fillStyle = '#8a6a45';
      c.fillRect(px + 3, py + T * 0.42, T - 6, T * 0.5);
      c.fillStyle = '#a8493c';
      c.beginPath();
      c.moveTo(px + T * 0.5, py + T * 0.12);
      c.lineTo(px + T - 2, py + T * 0.45);
      c.lineTo(px + 2, py + T * 0.45);
      c.closePath();
      c.fill();
      c.fillStyle = '#3c2d1e';
      c.fillRect(px + T * 0.42, py + T * 0.6, T * 0.16, T * 0.3);
    } else if (b.type === 'storehouse') {
      c.fillStyle = '#6f5837';
      c.fillRect(px + 2, py + T * 0.3, T - 4, T * 0.62);
      c.fillStyle = '#8a7048';
      c.fillRect(px + 2, py + T * 0.3, T - 4, T * 0.14);
      c.strokeStyle = '#3f3223';
      c.lineWidth = 1;
      c.strokeRect(px + 2.5, py + T * 0.3, T - 5, T * 0.62);
    } else if (b.type === 'farm') {
      const ripeness = HF.U.clamp(b.growth / HF.FARM.RIPE_AT, 0, 1);
      c.fillStyle = '#5b452c';
      c.fillRect(px + 1, py + 1, T - 2, T - 2);
      c.strokeStyle = mix('#6d8c48', '#e0c14a', ripeness);
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < 3; i++) {
        const yy = py + T * (0.28 + i * 0.22);
        c.moveTo(px + 3, yy);
        c.lineTo(px + T - 3, yy);
      }
      c.stroke();
      if (ripeness >= 1) {
        c.fillStyle = '#f0d24a';
        c.beginPath();
        c.arc(px + T - 5, py + 5, 2.5, 0, Math.PI * 2);
        c.fill();
      }
    } else if (b.type === 'campfire') {
      c.fillStyle = '#4a4038';
      c.beginPath();
      c.arc(px + T / 2, py + T / 2, T * 0.34, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#e8892e';
      c.beginPath();
      c.moveTo(px + T * 0.5, py + T * 0.24);
      c.lineTo(px + T * 0.68, py + T * 0.66);
      c.lineTo(px + T * 0.32, py + T * 0.66);
      c.closePath();
      c.fill();
      c.fillStyle = '#f5cf5a';
      c.beginPath();
      c.arc(px + T * 0.5, py + T * 0.56, T * 0.1, 0, Math.PI * 2);
      c.fill();
    } else if (b.type === 'wall') {
      c.fillStyle = '#9a958c';
      c.fillRect(px + 1, py + 1, T - 2, T - 2);
      c.strokeStyle = '#6f6b64';
      c.lineWidth = 1;
      c.strokeRect(px + 1.5, py + 1.5, T - 3, T - 3);
      c.beginPath();
      c.moveTo(px + 1, py + T * 0.5); c.lineTo(px + T - 1, py + T * 0.5);
      c.moveTo(px + T * 0.5, py + 1); c.lineTo(px + T * 0.5, py + T * 0.5);
      c.moveTo(px + T * 0.3, py + T * 0.5); c.lineTo(px + T * 0.3, py + T - 1);
      c.stroke();
      if (def.hp && b.hp < def.hp) progressBar(c, px, py, b.hp / def.hp, '#d9584f');
    }
  }

  function progressBar(c, px, py, frac, color) {
    const w = T - 6;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(px + 3, py + T - 6, w, 4);
    c.fillStyle = color;
    c.fillRect(px + 3, py + T - 6, w * HF.U.clamp(frac, 0, 1), 4);
  }

  /* ---------- overlays ---------- */

  function drawDesignation(c, d) {
    const px = d.x * T, py = d.y * T;
    const color = ORDER_COLOR[d.type] || '#ffffff';
    c.strokeStyle = color;
    c.lineWidth = 2;
    const s = 6;
    // corner brackets
    c.beginPath();
    c.moveTo(px + 2, py + 2 + s); c.lineTo(px + 2, py + 2); c.lineTo(px + 2 + s, py + 2);
    c.moveTo(px + T - 2 - s, py + 2); c.lineTo(px + T - 2, py + 2); c.lineTo(px + T - 2, py + 2 + s);
    c.moveTo(px + 2, py + T - 2 - s); c.lineTo(px + 2, py + T - 2); c.lineTo(px + 2 + s, py + T - 2);
    c.moveTo(px + T - 2 - s, py + T - 2); c.lineTo(px + T - 2, py + T - 2); c.lineTo(px + T - 2, py + T - 2 - s);
    c.stroke();
    const work = HF.ORDERS[d.type].work;
    if (d.workDone > 0.01) progressBar(c, px, py, d.workDone / work, color);
  }

  function moodColor(mood) {
    if (mood >= 60) return '#7ec46a';
    if (mood >= 35) return '#e0c14a';
    return '#d9584f';
  }

  function drawColonist(c, game, col, selected) {
    const cx = col.x * T + T / 2;
    const cy = col.y * T + T / 2;

    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.ellipse(cx, cy + T * 0.32, T * 0.28, T * 0.12, 0, 0, Math.PI * 2);
    c.fill();

    if (selected) {
      c.strokeStyle = '#f0c25a';
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(cx, cy, T * 0.46, 0, Math.PI * 2);
      c.stroke();
    }

    c.fillStyle = '#efe3c8';
    c.strokeStyle = '#22252c';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, T * 0.32, 0, Math.PI * 2);
    c.fill();
    c.stroke();

    c.fillStyle = '#22252c';
    c.font = 'bold 10px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(col.name.charAt(0), cx, cy + 0.5);
    c.textBaseline = 'alphabetic';

    // mood pip
    c.fillStyle = moodColor(col.mood);
    c.beginPath();
    c.arc(cx + T * 0.28, cy - T * 0.28, 3, 0, Math.PI * 2);
    c.fill();

    if (col.asleep) {
      c.fillStyle = '#cfe3ff';
      c.font = 'bold 10px system-ui, sans-serif';
      c.fillText('z', cx - T * 0.3, cy - T * 0.24);
    }
    if (col.hp < col.maxHp) progressBar(c, col.x * T, col.y * T, col.hp / col.maxHp, '#d9584f');
  }

  function drawRaider(c, r) {
    const cx = r.x * T + T / 2, cy = r.y * T + T / 2;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.ellipse(cx, cy + T * 0.32, T * 0.26, T * 0.11, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#a5342f';
    c.strokeStyle = '#2a1414';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, cy - T * 0.36);
    c.lineTo(cx + T * 0.32, cy);
    c.lineTo(cx, cy + T * 0.36);
    c.lineTo(cx - T * 0.32, cy);
    c.closePath();
    c.fill();
    c.stroke();
    if (r.hp < r.maxHp) progressBar(c, r.x * T, r.y * T, r.hp / r.maxHp, '#ff6b5e');
  }

  /* ---------- frame ---------- */

  function draw(game, view) {
    if (game.dirtyTerrain) { paintTerrain(game); game.dirtyTerrain = false; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buffer, 0, 0);

    if (game.season() === 'Winter') {
      ctx.fillStyle = 'rgba(198,220,240,0.18)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (game.season() === 'Autumn') {
      ctx.fillStyle = 'rgba(224,160,60,0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // warmth radius of campfires, so winter planning is visible
    if (game.season() === 'Winter') {
      for (const b of game.buildings) {
        if (!b || !b.built) continue;
        const def = HF.BUILDINGS[b.type];
        if (!def.warmth) continue;
        const grd = ctx.createRadialGradient(
          b.x * T + T / 2, b.y * T + T / 2, T,
          b.x * T + T / 2, b.y * T + T / 2, def.warmth * T
        );
        grd.addColorStop(0, 'rgba(255,180,80,0.18)');
        grd.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.fillStyle = grd;
        ctx.fillRect((b.x - def.warmth) * T, (b.y - def.warmth) * T,
                     def.warmth * 2 * T, def.warmth * 2 * T);
      }
    }

    for (const b of game.buildings) if (b) drawBuilding(ctx, game, b);
    for (const k in game.designations) drawDesignation(ctx, game.designations[k]);

    // path of the selected colonist
    const sel = view.selectedId != null ? game.colonistById(view.selectedId) : null;
    if (sel && sel.task && sel.task.path && sel.task.path.length) {
      ctx.strokeStyle = 'rgba(240,194,90,0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sel.x * T + T / 2, sel.y * T + T / 2);
      for (const p of sel.task.path) ctx.lineTo(p.x * T + T / 2, p.y * T + T / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const c of game.colonists) if (!c.dead) drawColonist(ctx, game, c, sel && sel.id === c.id);
    for (const r of game.raiders) if (!r.dead) drawRaider(ctx, r);

    // hover / drag preview
    if (view.drag) {
      const x0 = Math.min(view.drag.x0, view.drag.x1), x1 = Math.max(view.drag.x0, view.drag.x1);
      const y0 = Math.min(view.drag.y0, view.drag.y1), y1 = Math.max(view.drag.y0, view.drag.y1);
      ctx.fillStyle = 'rgba(240,194,90,0.18)';
      ctx.fillRect(x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T);
      ctx.strokeStyle = '#f0c25a';
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 * T + 1, y0 * T + 1, (x1 - x0 + 1) * T - 2, (y1 - y0 + 1) * T - 2);
    } else if (view.hover) {
      const hx = view.hover.x * T, hy = view.hover.y * T;
      let ok = true;
      if (view.mode && view.mode.kind === 'build') {
        ok = HF.Build.canPlace(game, view.mode.id, view.hover.x, view.hover.y).ok;
      } else if (view.mode && view.mode.kind === 'order') {
        const tile = HF.Map.at(game, view.hover.x, view.hover.y);
        ok = tile && HF.ORDERS[view.mode.id].valid(tile) && tile.building == null;
      }
      ctx.strokeStyle = ok ? 'rgba(255,255,255,0.85)' : 'rgba(217,88,79,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx + 1, hy + 1, T - 2, T - 2);
    }
  }

  return { init: init, draw: draw, TILE: T };
})();
