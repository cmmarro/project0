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
    marsh:    '#59745a',      // standing water under reeds - greyer, colder
    moor:     '#9a9159',      // dry susuki grass, closer to straw than green
    forest:   '#5e7c46',
    bamboo:   '#6f8e4a',      // a shade yellower than pine
    hill:     '#8a8171',
    mountain: '#7c7768',
  };

  // Which grounds take the seasonal tint, and which stay their own colour.
  const GREEN = { grass: 1, forest: 1, bamboo: 1, marsh: 1, moor: 1 };

  let canvas, ctx;
  let dirty = true;

  /* ---------- light ----------
     Recomputed once a frame and read by everything, rather than each drawing
     routine working out the time of day for itself. */
  let L = {
    sun: { sx: -0.7, sy: 0.7, height: 1, length: 0.7, t: 0.5 },
    light: [255, 248, 226],
    ambient: [190, 200, 214],
    day: 1,            // 0 at night, 1 in full daylight
    shadow: 0.34,      // how dark a cast shadow is right now
  };

  /* Tinting is a pure function of (colour, how much light this face catches,
     what the light is doing right now). The first two are a handful of fixed
     values; the third only needs to change a few dozen times a day for the eye
     to read it as continuous. So bucket the time of day and throw the cache
     away when the bucket turns over - otherwise every visible face re-parses a
     colour string on every frame, which is the same trap the ground palette
     fell into once the clock started running. */
  let shadeCache = new Map();
  let lightBucket = -1;

  function updateLight(game) {
    const sun = HF.Time.sun(game.tick);
    const sky = HF.Time.skyAt(game.tick);
    const day = game.light();

    const bucket = Math.round(HF.Time.hour(game.tick) * 4);   // every 15 minutes
    if (bucket !== lightBucket) { lightBucket = bucket; shadeCache.clear(); }
    L = {
      sun: sun,
      light: sky.light,
      ambient: sky.ambient,
      day: day,
      // Shadows are sharpest with the sun high and fade out as it sets; there
      // is nothing to cast them at night.
      shadow: 0.10 + 0.30 * day * Math.max(0.35, sun.height),
    };
  }

  /* A surface's brightness given which way it faces. `face` is 0 for the
     ground plane, and -1 / +1 for the two visible sides of a raised tile. The
     sun's screen direction decides which of those sides is towards it. */
  function lit(face) {
    const d = L.day;
    if (face === 0) return 0.86 + 0.30 * d * L.sun.height;
    const towards = face === 1 ? -L.sun.sx : L.sun.sx;   // right face vs left
    return 0.46 + 0.13 * d + 0.26 * d * Math.max(0, towards) * (0.4 + 0.6 * L.sun.height);
  }

  /* Tints a colour by the light: multiplied towards the sun's colour and
     lifted by the ambient, then scaled by how much of it this face catches.
     This is what makes the whole valley swing from peach at dawn through
     white at noon to blue after dark. */
  function shadeBy(base, amount) {
    const key = base + '|' + (amount * 64 | 0);
    const hit = shadeCache.get(key);
    if (hit !== undefined) return hit;
    const c = parse(base);
    const l = L.light, a = L.ambient;
    const k = amount;
    const r = (c[0] * (l[0] / 255) * k + c[0] * (a[0] / 255) * 0.34) * 0.78;
    const g = (c[1] * (l[1] / 255) * k + c[1] * (a[1] / 255) * 0.34) * 0.78;
    const b = (c[2] * (l[2] / 255) * k + c[2] * (a[2] / 255) * 0.34) * 0.78;
    const out = rgb([Math.min(255, r), Math.min(255, g), Math.min(255, b)]);
    shadeCache.set(key, out);
    return out;
  }

  /* The shadow an object throws on the ground.

     Deliberately a contact shadow - pooled at the foot of the thing, stretched
     and offset along the sun - rather than a long projected one. Two reasons,
     both structural. The scene is painted one diagonal at a time, so a shadow
     thrown towards the camera lands on ground that has not been drawn yet and
     is immediately painted over; and a shadow thrown away from the camera goes
     exactly where the object's own art already is, so it hides behind its own
     caster. Keeping it close to the base sidesteps both, still swings with the
     sun, and does the job that actually matters - sitting things on the ground
     rather than floating them above it. */
  function castShadow(sx, sy, h, w) {
    if (L.day < 0.06) return;
    const sun = L.sun;
    const reach = HF.U.clamp(h * 0.16 * sun.length, 2, 15);
    const cx = sx + sun.sx * reach;
    const cy = sy + sun.sy * reach * 0.5;

    // Longer along the light, and longer still when the sun is low.
    const rx = w * (0.62 + 0.5 * sun.length);
    const ry = rx * 0.42;
    const angle = Math.atan2(sun.sy * 0.5, sun.sx);

    ctx.save();
    ctx.globalAlpha = L.shadow;
    ctx.fillStyle = '#12141f';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

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
     rather than washed over the top of it.

     Memoised, because this is a pure function of terrain, season and a jitter
     that only needs sixteen steps to look random - and it used to run string
     parsing and two blends for every visible tile on every frame. That was
     affordable when a frame was painted after a keypress. Now that the clock
     runs, it was the single most expensive thing on screen. */
  const groundCache = new Map();

  function groundColor(tile, season, variant) {
    const step = (variant * 16) | 0;
    const key = tile.terrain + season + step;
    const hit = groundCache.get(key);
    if (hit !== undefined) return hit;

    let base = GROUND[tile.terrain];
    const green = !!GREEN[tile.terrain];
    if (season === 'Summer' && green) base = blend(base, '#4f7a3a', 0.35);
    else if (season === 'Autumn' && green) base = blend(base, '#a87c3a', 0.45);
    else if (season === 'Winter' && tile.terrain !== 'water') base = blend(base, '#dde6ec', 0.55);
    else if (season === 'Spring' && green) base = blend(base, '#8aa85c', 0.3);
    const c = parse(base);
    const j = (step / 16 - 0.5) * 12;
    const out = rgb([c[0] + j, c[1] + j, c[2] + j]);
    groundCache.set(key, out);
    return out;
  }

  // The two derived shades used for the sides of raised ground, likewise.
  const sideCache = new Map();
  function sideColor(terrain, f) {
    const key = terrain + f;
    let hit = sideCache.get(key);
    if (hit === undefined) { hit = shade(GROUND[terrain], f); sideCache.set(key, hit); }
    return hit;
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
  /* A box lit by the current sun rather than by three fixed colours. */
  function litBox(sx, sy, hw, hh, h, base) {
    isoBox(sx, sy, hw, hh, h,
      shadeBy(base, lit(0)),
      shadeBy(base, lit(-1) * 0.92),
      shadeBy(base, lit(1) * 0.92));
  }

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

  /* ---------- ground ---------- */

  function drawGround(game, x, y, season) {
    const tile = game.tiles[y * game.w + x];
    const elev = I.elevOf(tile);
    const p = I.toScreen(x, y, elev);
    const top = groundColor(tile, season, tile.variant);

    if (elev > 0) {
      const h = elev * I.ELEV;
      ctx.fillStyle = shadeBy(sideColor(tile.terrain, 0.78), lit(-1));
      ctx.beginPath();
      ctx.moveTo(p.sx - I.HW, p.sy);
      ctx.lineTo(p.sx, p.sy + I.HH);
      ctx.lineTo(p.sx, p.sy + I.HH + h);
      ctx.lineTo(p.sx - I.HW, p.sy + h);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = shadeBy(sideColor(tile.terrain, 0.60), lit(1));
      ctx.beginPath();
      ctx.moveTo(p.sx, p.sy + I.HH);
      ctx.lineTo(p.sx + I.HW, p.sy);
      ctx.lineTo(p.sx + I.HW, p.sy + h);
      ctx.lineTo(p.sx, p.sy + I.HH + h);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = shadeBy(top, lit(0));
    diamond(p.sx, p.sy, I.HW, I.HH);
    ctx.fill();
    // A hairline seam rather than a hard grid: enough to read the tiling,
    // not enough to look like graph paper.
    ctx.strokeStyle = 'rgba(0,0,0,0.09)';
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
    castShadow(sx, sy, 30, 8);
    ctx.fillStyle = shadeBy('#4a3b2a', lit(0) * 0.8);
    ctx.fillRect(sx - 1.5, sy - 10, 3, 12);
    const dark = season === 'Winter' ? '#3f5a49' : '#2f5535';
    const bright = season === 'Winter' ? '#6a8a76' : '#4a7d4a';
    for (let i = 0; i < 3; i++) {
      const w = 13 - i * 3, top = sy - 14 - i * 9, base = sy - 4 - i * 9;
      // Tiers catch progressively more light towards the crown.
      const k = lit(0) * (0.72 + i * 0.13);
      ctx.fillStyle = shadeBy(i === 2 ? bright : dark, k);
      ctx.beginPath();
      ctx.moveTo(sx, top);
      ctx.lineTo(sx + w, base);
      ctx.lineTo(sx - w, base);
      ctx.closePath();
      ctx.fill();

      // The half facing the sun is lifted, which reads as roundness.
      if (L.day > 0.1) {
        ctx.fillStyle = shadeBy(i === 2 ? bright : dark, k * 1.4);
        ctx.beginPath();
        ctx.moveTo(sx, top);
        ctx.lineTo(sx - Math.sign(L.sun.sx) * w, base);
        ctx.lineTo(sx, base);
        ctx.closePath();
        ctx.fill();
      }
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
    castShadow(sx, sy, 26, 7);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const ox = (i - (n - 1) / 2) * 5 + (v - 0.5) * 3;
      const hgt = 26 + ((i * 7 + v * 13) % 9);
      ctx.strokeStyle = shadeBy(season === 'Autumn' ? '#a8a05a' : '#7f9c4a', lit(0));
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx + ox, sy);
      ctx.lineTo(sx + ox + 1.5, sy - hgt);
      ctx.stroke();
      ctx.fillStyle = shadeBy(season === 'Winter' ? '#8fae86' : '#93b356', lit(0));
      ctx.beginPath();
      ctx.ellipse(sx + ox + 2, sy - hgt - 2, 5, 2.4, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawChestnut(sx, sy, v, season) {
    castShadow(sx, sy, 20, 7);
    ctx.fillStyle = shadeBy('#5a4530', lit(0) * 0.8);
    ctx.fillRect(sx - 1.5, sy - 12, 3, 13);
    const crown = season === 'Autumn' ? '#b8863a' : season === 'Winter' ? '#7d7a6a' : '#557f3f';
    ctx.fillStyle = shadeBy(crown, lit(0) * 0.85);
    ctx.beginPath();
    ctx.ellipse(sx, sy - 17, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (L.day > 0.1) {                       // a highlight on the sunward side
      ctx.fillStyle = shadeBy(crown, lit(0) * 1.25);
      ctx.beginPath();
      ctx.ellipse(sx - L.sun.sx * 3.5, sy - 19, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
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
    castShadow(sx, sy, h * 0.9, 14);
    ctx.fillStyle = shadeBy('#6d6a5f', lit(-1));
    ctx.beginPath();
    ctx.moveTo(sx, sy - I.HH - h);
    ctx.lineTo(sx + I.HW * 0.8, sy + 2);
    ctx.lineTo(sx - I.HW * 0.8, sy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shadeBy('#84806f', lit(1));
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

  /* Reeds: thin verticals with a seed head, thickest in autumn. */
  function drawReeds(sx, sy, v, season) {
    const n = 5 + ((v * 100) | 0) % 3;
    ctx.strokeStyle = shadeBy(season === 'Winter' ? '#8d9a8e'
                    : season === 'Autumn' ? '#b0a05e' : '#7f9a60', lit(0));
    ctx.lineWidth = 1.6;
    for (let i = 0; i < n; i++) {
      const ox = ((i * 37 + v * 190) % 30) - 15;
      const hgt = 11 + ((i * 11 + v * 27) % 8);
      ctx.beginPath();
      ctx.moveTo(sx + ox, sy + 2);
      ctx.quadraticCurveTo(sx + ox + 1, sy - hgt * 0.6, sx + ox + 3, sy - hgt);
      ctx.stroke();
    }
  }

  /* Susuki: pale plumes over dry grass. */
  function drawSusuki(sx, sy, v, season) {
    if (season === 'Winter') return;
    const n = 3 + ((v * 100) | 0) % 3;
    for (let i = 0; i < n; i++) {
      const ox = ((i * 53 + v * 210) % 28) - 14;
      const hgt = 9 + ((i * 13 + v * 31) % 6);
      ctx.strokeStyle = shadeBy('#a89c5e', lit(0));
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(sx + ox, sy + 1);
      ctx.lineTo(sx + ox + 2, sy - hgt);
      ctx.stroke();
      ctx.fillStyle = shadeBy(season === 'Autumn' ? '#e3d7a8' : '#c3bb84', lit(0));
      ctx.beginPath();
      ctx.ellipse(sx + ox + 3, sy - hgt - 2, 3.4, 1.6, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* A fish trap: stakes in the shallows with a ripple around them. */
  function drawFish(sx, sy, v) {
    ctx.strokeStyle = 'rgba(190,215,230,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 11, 5.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#7d6a4c';
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 3; i++) {
      const ox = -6 + i * 6 + (v - 0.5) * 3;
      ctx.beginPath();
      ctx.moveTo(sx + ox, sy + 2);
      ctx.lineTo(sx + ox + 1, sy - 7 - (i === 1 ? 2 : 0));
      ctx.stroke();
    }
  }

  /* A roadside shrine: two posts, a lintel, and a small vermilion gate. */
  function drawShrine(sx, sy) {
    castShadow(sx, sy, 17, 9);
    ctx.strokeStyle = '#b8442c';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(sx - 7, sy + 1); ctx.lineTo(sx - 6, sy - 15);
    ctx.moveTo(sx + 7, sy + 1); ctx.lineTo(sx + 6, sy - 15);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(sx - 10, sy - 16); ctx.lineTo(sx + 10, sy - 16);
    ctx.moveTo(sx - 8, sy - 11); ctx.lineTo(sx + 8, sy - 11);
    ctx.stroke();
  }

  function drawScenery(game, x, y, season) {
    const tile = game.tiles[y * game.w + x];
    if (tile.building != null) return;
    const p = I.toScreen(x, y, I.elevOf(tile));
    if (tile.terrain === 'forest') {
      drawPine(p.sx, p.sy, tile.variant, season);
    } else if (tile.terrain === 'bamboo') {
      drawBamboo(p.sx, p.sy, tile.variant, season);
    } else if (tile.terrain === 'marsh') {
      drawReeds(p.sx, p.sy, tile.variant, season);
    } else if (tile.terrain === 'moor') {
      drawSusuki(p.sx, p.sy, tile.variant, season);
    } else if (tile.terrain === 'mountain') {
      drawPeak(p.sx, p.sy, tile.variant, season);
    } else if (tile.terrain === 'hill') {
      drawRocks(p.sx, p.sy, tile.variant);
    }
    if (tile.feature === 'chestnut') drawChestnut(p.sx, p.sy, tile.variant, season);
    else if (tile.feature === 'fish') drawFish(p.sx, p.sy, tile.variant);
    else if (tile.feature === 'shrine') drawShrine(p.sx, p.sy);
  }

  /* ---------- buildings ---------- */

  function drawBuilding(game, b, season) {
    const tile = game.tiles[b.y * game.w + b.x];
    const p = I.toScreen(b.x, b.y, I.elevOf(tile));
    const def = HF.BUILDINGS[b.type];

    // Marked to come down: a red cross over it and a bar for the work done.
    if (b.deconstruct) {
      drawBuildingBody(game, b, season, p, def);
      ctx.strokeStyle = 'rgba(224,90,70,0.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.sx - 11, p.sy - 14); ctx.lineTo(p.sx + 11, p.sy + 2);
      ctx.moveTo(p.sx + 11, p.sy - 14); ctx.lineTo(p.sx - 11, p.sy + 2);
      ctx.stroke();
      progressPip(p.sx, p.sy - 26, b.workDone / HF.Build.deconstructWork(b.type), '#e0705a');
      return;
    }
    drawBuildingBody(game, b, season, p, def);
  }

  function drawBuildingBody(game, b, season, p, def) {

    if (!b.built) {
      ctx.save();
      if (b.awaitingClear) ctx.globalAlpha = 0.5;   // the ground is not ready yet
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

    if (b.type === 'futon') {
      // A rolled-out futon: a low pale rectangle, and a sleeper when occupied.
      const sleeper = game.colonists.find(function (c) {
        return !c.dead && c.asleep && c.x === b.x && c.y === b.y;
      });
      ctx.fillStyle = '#cfc0a8';
      diamond(p.sx, p.sy, 13, 6.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,50,40,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (sleeper) {
        ctx.fillStyle = '#8d7c62';
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy - 3, 9, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (b.type === 'door') {
      litBox(p.sx, p.sy, I.HW - 3, I.HH - 2, 5, '#6a5540');
      ctx.fillStyle = '#8d6a45';
      ctx.fillRect(p.sx - 5, p.sy - 16, 10, 14);
      ctx.strokeStyle = 'rgba(30,25,20,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.sx - 5, p.sy - 16, 10, 14);
    } else if (b.type === 'table') {
      castShadow(p.sx, p.sy, 7, 11);
      litBox(p.sx, p.sy, 12, 6, 5, '#a37f52');
    } else if (b.type === 'chest') {
      castShadow(p.sx, p.sy, 11, 9);
      litBox(p.sx, p.sy, 10, 5, 9, '#8a6a45');
      ctx.strokeStyle = '#c9a25e';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.sx - 10, p.sy - 5); ctx.lineTo(p.sx, p.sy - 10);
      ctx.lineTo(p.sx + 10, p.sy - 5);
      ctx.stroke();
    } else if (b.type === 'bench') {
      castShadow(p.sx, p.sy, 9, 12);
      litBox(p.sx, p.sy, 13, 6.5, 7, '#9a7a4e');
      // Tools standing in a rack, so a bench reads as a place work happens.
      ctx.strokeStyle = '#4a4038';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(p.sx - 6 + i * 6, p.sy - 7);
        ctx.lineTo(p.sx - 5 + i * 6, p.sy - 17 - (i % 2) * 3);
        ctx.stroke();
      }
      if (game.recipes[b.id]) progressPip(p.sx, p.sy - 24,
        (b.craftDone || 0) / HF.RECIPES[game.recipes[b.id]].work, '#d0a24a');
    } else if (b.type === 'ishigaki') {
      castShadow(p.sx, p.sy, 22, 13);
      litBox(p.sx, p.sy, I.HW - 5, I.HH - 2.5, 22, '#9b958a');
      if (def.hp && b.hp < def.hp) progressPip(p.sx, p.sy - 26, b.hp / def.hp, '#d9584f');
    } else if (b.type === 'house') {
      castShadow(p.sx, p.sy, 20, 14);
      litBox(p.sx, p.sy, 15, 7.5, 9, '#6a5540');   // walls
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
      castShadow(p.sx, p.sy, 22, 14);
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
    } else if (b.type === 'hearth' || b.type === 'campfire') {
      castShadow(p.sx, p.sy, 8, 11);
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
      castShadow(p.sx, p.sy, 22, 14);
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
      castShadow(p.sx, p.sy, 24, 12);
      litBox(p.sx, p.sy, I.HW - 7, I.HH - 3.5, 24, '#8a6f4a');
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
  /* Where to actually paint somebody: between the tile they left and the tile
     they are on, by how far through the step they are. The simulation stays
     firmly on the grid; only the picture is allowed to be between tiles. */
  let subTick = 0;
  function setSubTick(f) { subTick = f; }

  function bodyPos(e) {
    // The fraction of a tick already elapsed is added in, so somebody walking
    // glides at the frame rate instead of stepping at the tick rate.
    const t = e.stepLen ? Math.min(1, ((e.stepT || 0) + subTick) / e.stepLen) : 1;
    if (t >= 1 || e.fromX == null) return I.toScreen(e.x, e.y, 0);
    const a = I.toScreen(e.fromX, e.fromY, 0);
    const b = I.toScreen(e.x, e.y, 0);
    return { sx: a.sx + (b.sx - a.sx) * t, sy: a.sy + (b.sy - a.sy) * t };
  }

  function drawVillager(game, c, selected) {
    const tile = game.tiles[c.y * game.w + c.x];
    const p = bodyPos(c);
    p.sy -= I.elevOf(tile) * I.ELEV;

    if (selected) {
      ctx.strokeStyle = '#e0b64a';
      ctx.lineWidth = 2.5;
      diamond(p.sx, p.sy, I.HW - 5, I.HH - 3);
      ctx.stroke();
    }
    castShadow(p.sx, p.sy, 17, 5);

    const bodyTop = p.sy - 19, bodyBot = p.sy - 2;
    // Villagers are lit like everything else, but never let fully into the
    // dark - you still have to be able to find your people at night.
    ctx.fillStyle = shadeBy(c.asleep ? '#4a5a72' : '#3d5a7d', Math.max(0.72, lit(0)));
    ctx.beginPath();
    ctx.moveTo(p.sx - 3.5, bodyTop);
    ctx.lineTo(p.sx + 3.5, bodyTop);
    ctx.lineTo(p.sx + 5.5, bodyBot);
    ctx.lineTo(p.sx - 5.5, bodyBot);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = shadeBy('#e6c9a4', Math.max(0.72, lit(0)));
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
    const p = bodyPos(r);
    p.sy -= I.elevOf(tile) * I.ELEV;
    castShadow(p.sx, p.sy, 17, 5);
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

  /* Night is one translucent wash over the finished scene rather than a
     recolour of every tile. Recolouring was affordable when a frame was only
     painted after a keypress; at sixty frames a second it is not, and the wash
     also lets hearths punch warm holes in the dark for almost nothing. */
  /* Once the ground and everything on it is lit per surface, the old flat wash
     over the whole scene is doing the same job twice - so all that is left for
     it is a little extra depth at night and the pools of light the hearths
     throw, which no amount of per-surface shading can produce. */
  function drawLight(game) {
    const d = L.day;

    if (d < 0.999) {
      const a = (1 - d) * 0.3;
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(120,132,190,' + a.toFixed(3) + ')';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    if (d > 0.94) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of game.buildings) {
      if (!b || !b.built) continue;
      const def = HF.BUILDINGS[b.type];
      if (!def.warmth) continue;
      const tile = game.tiles[b.y * game.w + b.x];
      const p = I.toScreen(b.x, b.y, I.elevOf(tile));
      const r = 62;
      const g = ctx.createRadialGradient(p.sx, p.sy - 6, 3, p.sx, p.sy - 6, r);
      const a = (1 - d) * 0.4;
      g.addColorStop(0, 'rgba(236,158,70,' + a.toFixed(3) + ')');
      g.addColorStop(0.45, 'rgba(212,120,52,' + (a * 0.4).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(212,120,52,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy - 6, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(game, view, force) {
    if (!dirty && !force) return;
    dirty = false;

    updateLight(game);
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

    /* The ghost. Rather than washing the whole dragged rectangle in one colour,
       every tile the plan actually touches is marked green if it will take and
       red if it will not - so a wall drawn across a river shows you the gap
       before you let go, and a room outline shows as an outline. */
    const waiting = {};
    for (const b of game.buildings) {
      if (b && b.awaitingClear && !b.cancelled) waiting[HF.U.key(b.x, b.y)] = b;
    }

    const ghost = {};
    if (view.plan) {
      for (const t of view.plan.ok) ghost[HF.U.key(t.x, t.y)] = 'ok';
      for (const t of (view.plan.clearing || [])) ghost[HF.U.key(t.x, t.y)] = 'clear';
      for (const t of view.plan.bad) ghost[HF.U.key(t.x, t.y)] = 'bad';
    }
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

        const mark = ghost[key];
        if (mark) {
          const tp = I.toScreen(x, y, I.elevOf(game.tiles[y * game.w + x]));
          ctx.fillStyle = mark === 'ok' ? 'rgba(126,196,106,0.34)'
                        : mark === 'clear' ? 'rgba(208,162,74,0.34)'
                        : 'rgba(196,70,47,0.34)';
          diamond(tp.sx, tp.sy, I.HW - 2, I.HH - 1);
          ctx.fill();
          ctx.strokeStyle = mark === 'ok' ? 'rgba(160,225,140,0.9)'
                          : mark === 'clear' ? 'rgba(232,196,110,0.95)'
                          : 'rgba(230,110,90,0.9)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (dragRect && x >= dragRect.x0 && x <= dragRect.x1 &&
                   y >= dragRect.y0 && y <= dragRect.y1) {
          // Inside the dragged box but not part of the plan: a room's interior.
          const tp = I.toScreen(x, y, I.elevOf(game.tiles[y * game.w + x]));
          ctx.fillStyle = 'rgba(224,182,74,0.1)';
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
        // Blueprints waiting for their ground to be cleared do not hold a tile
        // yet, so they have to be looked up by position or they would be
        // invisible until the trees came down.
        const pending = waiting[key];
        if (pending) drawBuilding(game, pending, season);

        const here = byTile[key];
        if (here) {
          for (const item of here) {
            if (item.kind === 'v') drawVillager(game, item.c, !!sel && sel.id === item.c.id);
            else drawBandit(game, item.r);
          }
        }
      }
    }

    drawLight(game);
  }

  return { init: init, draw: draw, invalidate: invalidate, setSubTick: setSubTick };
})();
