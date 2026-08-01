/* Isometric canvas drawing.

   The scene is painted back to front, one diagonal at a time: every tile on a
   given (x + y) is at the same depth, so ground goes down for the whole
   diagonal and then everything standing on it. Nothing is cached - the game is
   turn-based, so a frame is only drawn when something actually changed, and
   tiles outside the viewport are skipped entirely. */
window.HF = window.HF || {};

HF.Render = (function () {
  const I = HF.Iso;

  /* Ground palettes, keyed by terrain. Sides are derived, not authored. */
  const GROUND = {
    water:    '#31536b',
    sand:     '#c9b98d',
    grass:    '#6f8b4e',
    forest:   '#5e7c46',
    hill:     '#8a8171',
    mountain: '#7c7768',
  };

  let canvas, ctx;
  let dirty = true;

  function init(cv) {
    canvas = cv;
    canvas.width = I.width;
    canvas.height = I.height;
    ctx = canvas.getContext('2d');
    dirty = true;
  }

  function invalidate() { dirty = true; }

  /* ---------- colour helpers ---------- */

  /* Accepts both '#rrggbb' and the 'rgb(r,g,b)' that blend() and shade() hand
     back, so colours can be piped through more than one of them. Parsing only
     hex here meant every seasonally tinted tile came out as NaN, i.e. black. */
  function parse(color) {
    if (color.charCodeAt(0) === 35) {
      const n = parseInt(color.slice(1), 16);
      return [n >> 16, (n >> 8) & 255, n & 255];
    }
    const m = color.match(/-?\d+(\.\d+)?/g);
    return [+m[0], +m[1], +m[2]];
  }
  function rgb(c) {
    return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  }
  function shade(hex, f) {
    const c = parse(hex);
    return rgb([c[0] * f, c[1] * f, c[2] * f]);
  }
  function blend(hex, hex2, t) {
    const a = parse(hex), b = parse(hex2);
    return rgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }

  /* Season is the loudest thing on the map, so it is painted into the ground
     rather than washed over the top of it. */
  function groundColor(tile, season, variant) {
    let base = GROUND[tile.terrain];
    const green = tile.terrain === 'grass' || tile.terrain === 'forest';
    if (season === 'Summer' && green) base = blend(base, '#4f7a3a', 0.35);
    else if (season === 'Autumn' && green) base = blend(base, '#a87c3a', 0.45);
    else if (season === 'Winter' && tile.terrain !== 'water') base = blend(base, '#dde6ec', 0.55);
    else if (season === 'Spring' && green) base = blend(base, '#8aa85c', 0.3);
    const c = parse(base);
    const j = (variant - 0.5) * 12;
    return rgb([c[0] + j, c[1] + j, c[2] + j]);
  }

  /* ---------- primitives ---------- */

  function diamond(sx, sy, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx - hw, sy);
    ctx.closePath();
  }

  /* A box standing on the diamond centred at (sx, sy). */
  function isoBox(sx, sy, hw, hh, h, top, left, right) {
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh - h);
    ctx.lineTo(sx - hw, sy - h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(sx, sy + hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx + hw, sy - h);
    ctx.lineTo(sx, sy + hh - h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = top;
    diamond(sx, sy - h, hw, hh);
    ctx.fill();
  }

  function shadow(sx, sy, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------- ground ---------- */

  function drawGround(game, x, y, season) {
    const tile = game.tiles[y * game.w + x];
    const elev = I.elevOf(tile);
    const p = I.toScreen(x, y, elev);
    const top = groundColor(tile, season, tile.variant);

    if (elev > 0) {
      const h = elev * I.ELEV;
      ctx.fillStyle = shade(GROUND[tile.terrain], 0.62);
      ctx.beginPath();
      ctx.moveTo(p.sx - I.HW, p.sy);
      ctx.lineTo(p.sx, p.sy + I.HH);
      ctx.lineTo(p.sx, p.sy + I.HH + h);
      ctx.lineTo(p.sx - I.HW, p.sy + h);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = shade(GROUND[tile.terrain], 0.44);
      ctx.beginPath();
      ctx.moveTo(p.sx, p.sy + I.HH);
      ctx.lineTo(p.sx + I.HW, p.sy);
      ctx.lineTo(p.sx + I.HW, p.sy + h);
      ctx.lineTo(p.sx, p.sy + I.HH + h);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = top;
    diamond(p.sx, p.sy, I.HW, I.HH);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.13)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (tile.terrain === 'water') {
      ctx.strokeStyle = 'rgba(210,232,245,0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const o = (tile.variant - 0.5) * 8;
      ctx.moveTo(p.sx - 11 + o, p.sy + 2);
      ctx.lineTo(p.sx + 1 + o, p.sy + 8);
      ctx.stroke();
    }
    return p;
  }

  /* ---------- scenery ---------- */

  function drawPine(sx, sy, v, season) {
    shadow(sx + 3, sy + 3, 9);
    ctx.fillStyle = '#4a3b2a';
    ctx.fillRect(sx - 1.5, sy - 10, 3, 12);
    const dark = season === 'Winter' ? '#3f5a49' : '#2f5535';
    const lit = season === 'Winter' ? '#5b7a68' : '#3d6b3f';
    for (let i = 0; i < 3; i++) {
      const w = 13 - i * 3, top = sy - 14 - i * 9, base = sy - 4 - i * 9;
      ctx.fillStyle = i === 2 ? lit : dark;
      ctx.beginPath();
      ctx.moveTo(sx, top);
      ctx.lineTo(sx + w, base);
      ctx.lineTo(sx - w, base);
      ctx.closePath();
      ctx.fill();
    }
    if (season === 'Winter') {
      ctx.fillStyle = 'rgba(238,246,250,0.75)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 32);
      ctx.lineTo(sx + 5, sy - 25);
      ctx.lineTo(sx - 5, sy - 25);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawBamboo(sx, sy, v, season) {
    shadow(sx + 2, sy + 3, 8);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const ox = (i - (n - 1) / 2) * 5 + (v - 0.5) * 3;
      const hgt = 26 + ((i * 7 + v * 13) % 9);
      ctx.strokeStyle = season === 'Autumn' ? '#a8a05a' : '#7f9c4a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx + ox, sy);
      ctx.lineTo(sx + ox + 1.5, sy - hgt);
      ctx.stroke();
      ctx.fillStyle = season === 'Winter' ? '#8fae86' : '#93b356';
      ctx.beginPath();
      ctx.ellipse(sx + ox + 2, sy - hgt - 2, 5, 2.4, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawChestnut(sx, sy, v, season) {
    shadow(sx + 2, sy + 3, 9);
    ctx.fillStyle = '#5a4530';
    ctx.fillRect(sx - 1.5, sy - 12, 3, 13);
    ctx.fillStyle = season === 'Autumn' ? '#b8863a' : season === 'Winter' ? '#7d7a6a' : '#557f3f';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 17, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (season !== 'Winter') {
      ctx.fillStyle = '#8a5a2a';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(sx - 5 + i * 5, sy - 13 + (i === 1 ? -3 : 0), 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawRocks(sx, sy, v) {
    ctx.fillStyle = 'rgba(58,54,48,0.5)';
    ctx.beginPath();
    ctx.ellipse(sx - 5 + v * 6, sy - 1, 6, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sx + 7 - v * 5, sy - 5, 4.2, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPeak(sx, sy, v, season) {
    const h = 20 + v * 10;
    ctx.fillStyle = '#6d6a5f';
    ctx.beginPath();
    ctx.moveTo(sx, sy - I.HH - h);
    ctx.lineTo(sx + I.HW * 0.8, sy + 2);
    ctx.lineTo(sx - I.HW * 0.8, sy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#84806f';
    ctx.beginPath();
    ctx.moveTo(sx, sy - I.HH - h);
    ctx.lineTo(sx + I.HW * 0.8, sy + 2);
    ctx.lineTo(sx, sy + 2);
    ctx.closePath();
    ctx.fill();
    if (v > 0.45 || season === 'Winter') {
      ctx.fillStyle = '#e8f0f5';
      ctx.beginPath();
      ctx.moveTo(sx, sy - I.HH - h);
      ctx.lineTo(sx + 8, sy - I.HH - h + 13);
      ctx.lineTo(sx - 8, sy - I.HH - h + 13);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawScenery(game, x, y, season) {
    const tile = game.tiles[y * game.w + x];
    if (tile.building != null) return;
    const p = I.toScreen(x, y, I.elevOf(tile));
    if (tile.terrain === 'forest') {
      if (tile.variant > 0.68) drawBamboo(p.sx, p.sy, tile.variant, season);
      else drawPine(p.sx, p.sy, tile.variant, season);
    } else if (tile.terrain === 'mountain') {
      drawPeak(p.sx, p.sy, tile.variant, season);
    } else if (tile.terrain === 'hill') {
      drawRocks(p.sx, p.sy, tile.variant);
    }
    if (tile.feature === 'chestnut') drawChestnut(p.sx, p.sy, tile.variant, season);
  }

  /* ---------- buildings ---------- */

  function drawBuilding(game, b, season) {
    const tile = game.tiles[b.y * game.w + b.x];
    const p = I.toScreen(b.x, b.y, I.elevOf(tile));
    const def = HF.BUILDINGS[b.type];

    if (!b.built) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(198,220,240,0.9)';
      ctx.lineWidth = 1.6;
      diamond(p.sx, p.sy, I.HW - 3, I.HH - 2);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(190,215,240,0.16)';
      diamond(p.sx, p.sy, I.HW - 3, I.HH - 2);
      ctx.fill();
      progressPip(p.sx, p.sy - 16, b.workDone / def.work, '#9fd0ff');
      return;
    }

    if (b.type === 'house') {
      shadow(p.sx, p.sy + 4, 17);
      isoBox(p.sx, p.sy, 15, 7.5, 9, '#6a5540', '#54432f', '#3f3325');   // walls
      // thatched hipped roof
      const ry = p.sy - 9;
      ctx.fillStyle = '#b59660';
      ctx.beginPath();
      ctx.moveTo(p.sx - 19, ry);
      ctx.lineTo(p.sx, ry + 9);
      ctx.lineTo(p.sx, ry - 4);
      ctx.lineTo(p.sx - 6, ry - 15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8f7448';
      ctx.beginPath();
      ctx.moveTo(p.sx + 19, ry);
      ctx.lineTo(p.sx, ry + 9);
      ctx.lineTo(p.sx, ry - 4);
      ctx.lineTo(p.sx + 6, ry - 15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#a3854f';
      ctx.beginPath();
      ctx.moveTo(p.sx - 6, ry - 15);
      ctx.lineTo(p.sx + 6, ry - 15);
      ctx.lineTo(p.sx + 19, ry);
      ctx.lineTo(p.sx - 19, ry);
      ctx.closePath();
      ctx.fill();
      if (season === 'Winter') {
        ctx.fillStyle = 'rgba(238,246,250,0.6)';
        ctx.beginPath();
        ctx.moveTo(p.sx - 6, ry - 15);
        ctx.lineTo(p.sx + 6, ry - 15);
        ctx.lineTo(p.sx + 12, ry - 8);
        ctx.lineTo(p.sx - 12, ry - 8);
        ctx.closePath();
        ctx.fill();
      }
    } else if (b.type === 'storehouse') {
      shadow(p.sx, p.sy + 4, 15);
      isoBox(p.sx, p.sy, 13, 6.5, 17, '#ded7c4', '#c3bba6', '#a49c88');  // plaster
      const ry = p.sy - 17;
      ctx.fillStyle = '#414852';
      ctx.beginPath();
      ctx.moveTo(p.sx - 16, ry + 1);
      ctx.lineTo(p.sx, ry + 9);
      ctx.lineTo(p.sx + 16, ry + 1);
      ctx.lineTo(p.sx, ry - 8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#2c3138';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (b.type === 'farm') {
      const ripe = HF.U.clamp(b.growth / HF.FARM.RIPE_AT, 0, 1);
      const water = season === 'Winter' ? '#8d9aa2' : '#4d7a72';
      ctx.fillStyle = blend(water, '#cfae4a', ripe);
      diamond(p.sx, p.sy, I.HW - 1, I.HH - 0.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,40,30,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // rows of shoots running along the paddy
      ctx.strokeStyle = ripe >= 1 ? '#e6c65c' : blend('#6f9a52', '#d8bf58', ripe);
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        const off = i * 7;
        ctx.beginPath();
        ctx.moveTo(p.sx - 16 + off, p.sy + 8 - Math.abs(off) * 0.5);
        ctx.lineTo(p.sx + off, p.sy - 8 + Math.abs(off) * 0.5 + 8);
        ctx.stroke();
      }
      if (ripe >= 1) {
        ctx.fillStyle = '#f0d874';
        ctx.beginPath();
        ctx.arc(p.sx + 15, p.sy - 8, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (b.type === 'campfire') {
      shadow(p.sx, p.sy + 2, 12);
      ctx.fillStyle = '#5a5347';
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(p.sx + Math.cos(a) * 11, p.sy + Math.sin(a) * 5.5, 3.4, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#d9702a';
      ctx.beginPath();
      ctx.moveTo(p.sx, p.sy - 18);
      ctx.lineTo(p.sx + 7, p.sy + 1);
      ctx.lineTo(p.sx - 7, p.sy + 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f2cc55';
      ctx.beginPath();
      ctx.moveTo(p.sx, p.sy - 10);
      ctx.lineTo(p.sx + 3.5, p.sy);
      ctx.lineTo(p.sx - 3.5, p.sy);
      ctx.closePath();
      ctx.fill();
    } else if (b.type === 'tower') {
      shadow(p.sx, p.sy + 4, 15);
      isoBox(p.sx, p.sy, 8, 4, 30, '#7a6045', '#5f4a34', '#463628');     // legs
      isoBox(p.sx, p.sy - 30, 13, 6.5, 11, '#8a6c4c', '#6d543a', '#52402c');
      const ry = p.sy - 41;
      ctx.fillStyle = '#4a5058';
      ctx.beginPath();
      ctx.moveTo(p.sx - 16, ry + 1);
      ctx.lineTo(p.sx, ry + 9);
      ctx.lineTo(p.sx + 16, ry + 1);
      ctx.lineTo(p.sx, ry - 7);
      ctx.closePath();
      ctx.fill();
    } else if (b.type === 'wall') {
      shadow(p.sx, p.sy + 3, 14);
      isoBox(p.sx, p.sy, I.HW - 2, I.HH - 1, 15, '#9b958a', '#7d776d', '#5f5a52');
      ctx.strokeStyle = 'rgba(40,38,34,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.sx - I.HW + 2, p.sy - 8); ctx.lineTo(p.sx, p.sy - 2);
      ctx.moveTo(p.sx + I.HW - 2, p.sy - 8); ctx.lineTo(p.sx, p.sy - 2);
      ctx.stroke();
      if (def.hp && b.hp < def.hp) progressPip(p.sx, p.sy - 26, b.hp / def.hp, '#d9584f');
    }
  }

  function progressPip(sx, sy, frac, color) {
    const w = 26;
    ctx.fillStyle = 'rgba(12,14,18,0.75)';
    ctx.fillRect(sx - w / 2 - 1, sy - 4, w + 2, 6);
    ctx.fillStyle = color;
    ctx.fillRect(sx - w / 2, sy - 3, w * HF.U.clamp(frac, 0, 1), 4);
  }

  /* ---------- overlays and figures ---------- */

  function drawDesignation(game, d) {
    const tile = game.tiles[d.y * game.w + d.x];
    const p = I.toScreen(d.x, d.y, I.elevOf(tile));
    const order = HF.ORDERS[d.type];
    ctx.strokeStyle = order.color;
    ctx.lineWidth = 2;
    diamond(p.sx, p.sy, I.HW - 4, I.HH - 2);
    ctx.stroke();
    ctx.fillStyle = order.color;
    ctx.globalAlpha = 0.16;
    diamond(p.sx, p.sy, I.HW - 4, I.HH - 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (d.workDone > 0.01) progressPip(p.sx, p.sy - 4, d.workDone / order.work, order.color);
  }

  function moodColor(mood) {
    if (mood >= 60) return '#8ac46a';
    if (mood >= 35) return '#e0b64a';
    return '#c8452f';
  }

  /* A peasant: indigo work clothes and a straw kasa, which reads at any zoom. */
  function drawVillager(game, c, selected) {
    const tile = game.tiles[c.y * game.w + c.x];
    const p = I.toScreen(c.x, c.y, I.elevOf(tile));

    if (selected) {
      ctx.strokeStyle = '#e0b64a';
      ctx.lineWidth = 2.5;
      diamond(p.sx, p.sy, I.HW - 5, I.HH - 3);
      ctx.stroke();
    }
    shadow(p.sx, p.sy + 1, 8);

    const bodyTop = p.sy - 19, bodyBot = p.sy - 2;
    ctx.fillStyle = c.asleep ? '#4a5a72' : '#3d5a7d';
    ctx.beginPath();
    ctx.moveTo(p.sx - 3.5, bodyTop);
    ctx.lineTo(p.sx + 3.5, bodyTop);
    ctx.lineTo(p.sx + 5.5, bodyBot);
    ctx.lineTo(p.sx - 5.5, bodyBot);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#e6c9a4';
    ctx.beginPath();
    ctx.arc(p.sx, bodyTop - 3, 3.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#d3b476';                       // kasa
    ctx.beginPath();
    ctx.moveTo(p.sx, bodyTop - 11);
    ctx.lineTo(p.sx + 8.5, bodyTop - 4);
    ctx.lineTo(p.sx - 8.5, bodyTop - 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,55,30,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = moodColor(c.mood);
    ctx.beginPath();
    ctx.arc(p.sx + 8, bodyTop - 10, 2.6, 0, Math.PI * 2);
    ctx.fill();

    if (c.asleep) {
      ctx.fillStyle = '#cfe3ff';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('z', p.sx - 9, bodyTop - 8);
    }
    if (c.hp < c.maxHp) progressPip(p.sx, p.sy - 30, c.hp / c.maxHp, '#c8452f');
  }

  function drawBandit(game, r) {
    const tile = game.tiles[r.y * game.w + r.x];
    const p = I.toScreen(r.x, r.y, I.elevOf(tile));
    shadow(p.sx, p.sy + 1, 8);
    const bodyTop = p.sy - 20, bodyBot = p.sy - 2;
    ctx.fillStyle = '#4a3f3a';
    ctx.beginPath();
    ctx.moveTo(p.sx - 4, bodyTop);
    ctx.lineTo(p.sx + 4, bodyTop);
    ctx.lineTo(p.sx + 6, bodyBot);
    ctx.lineTo(p.sx - 6, bodyBot);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d8b48c';
    ctx.beginPath();
    ctx.arc(p.sx, bodyTop - 3.5, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b7332a';                       // hachimaki
    ctx.fillRect(p.sx - 4, bodyTop - 6.5, 8, 2.4);
    ctx.strokeStyle = '#cfd4da';                     // blade
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(p.sx + 6, bodyTop + 2);
    ctx.lineTo(p.sx + 13, bodyTop - 7);
    ctx.stroke();
    if (r.hp < r.maxHp) progressPip(p.sx, p.sy - 31, r.hp / r.maxHp, '#e0705f');
  }

  /* ---------- frame ---------- */

  function draw(game, view, force) {
    if (!dirty && !force) return;
    dirty = false;

    const season = game.season();
    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const vis = HF.Camera.visibleRect();
    const pad = 90;

    // Index movable things by tile so they can be drawn at the right depth.
    const byTile = {};
    function put(key, item) { (byTile[key] || (byTile[key] = [])).push(item); }
    for (const c of game.colonists) if (!c.dead) put(HF.U.key(c.x, c.y), { kind: 'v', c: c });
    for (const r of game.raiders) if (!r.dead) put(HF.U.key(r.x, r.y), { kind: 'b', r: r });

    const sel = view.selectedId != null ? game.colonistById(view.selectedId) : null;
    const dragRect = view.drag ? {
      x0: Math.min(view.drag.x0, view.drag.x1), x1: Math.max(view.drag.x0, view.drag.x1),
      y0: Math.min(view.drag.y0, view.drag.y1), y1: Math.max(view.drag.y0, view.drag.y1),
    } : null;

    /* Screen position is a pure function of the tile, so the visible tiles can
       be solved for rather than tested one by one: a diagonal's y depends only
       on d = x + y, and within a diagonal x is linear in screen x. On a phone
       this is the difference between touching sixty tiles and all twelve
       hundred of them. */
    const dFrom = Math.max(0, Math.floor((vis.y0 - pad - I.originY) / I.HH));
    const dTo = Math.min(I.maxDepth, Math.ceil((vis.y1 + pad - I.originY) / I.HH));

    for (let d = dFrom; d <= dTo; d++) {
      const lo = (vis.x0 - pad - I.originX) / I.HW;
      const hi = (vis.x1 + pad - I.originX) / I.HW;
      const from = Math.max(I.rowStart(d), Math.floor((lo + d) / 2));
      const to = Math.min(I.rowEnd(d), Math.ceil((hi + d) / 2));

      for (let x = from; x <= to; x++) {
        drawGround(game, x, d - x, season);
      }

      for (let x = from; x <= to; x++) {
        const y = d - x;
        const key = HF.U.key(x, y);
        const des = game.designations[key];
        if (des) drawDesignation(game, des);

        if (dragRect && x >= dragRect.x0 && x <= dragRect.x1 &&
            y >= dragRect.y0 && y <= dragRect.y1) {
          const tp = I.toScreen(x, y, I.elevOf(game.tiles[y * game.w + x]));
          ctx.fillStyle = 'rgba(224,182,74,0.3)';
          diamond(tp.sx, tp.sy, I.HW - 2, I.HH - 1);
          ctx.fill();
        }

        if (view.hover && view.hover.x === x && view.hover.y === y && !dragRect) {
          const tp = I.toScreen(x, y, I.elevOf(game.tiles[y * game.w + x]));
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 2;
          diamond(tp.sx, tp.sy, I.HW - 2, I.HH - 1);
          ctx.stroke();
        }

        drawScenery(game, x, y, season);

        const tile = game.tiles[y * game.w + x];
        if (tile.building != null) {
          const b = game.buildings[tile.building];
          if (b) drawBuilding(game, b, season);
        }

        const here = byTile[key];
        if (here) {
          for (const item of here) {
            if (item.kind === 'v') drawVillager(game, item.c, !!sel && sel.id === item.c.id);
            else drawBandit(game, item.r);
          }
        }
      }
    }
  }

  return { init: init, draw: draw, invalidate: invalidate };
})();
