/* The build menu, and what the mouse does while something is selected.
 *
 * Modelled on how a colony sim actually handles this, because the conventions
 * are load-bearing rather than decorative: a tool stays selected after use so
 * you can place several, dragging paints a run, R rotates, right-click and Esc
 * cancel, and the ghost is tinted red where it won't fit rather than simply
 * refusing the click with no explanation.
 */

import { CATEGORIES, TERRAIN, THINGS, TILE, menuItems } from './defs.js';

export class Build {
  constructor(world, camera, canvas, onChange) {
    this.world = world;
    this.camera = camera;
    this.canvas = canvas;
    this.onChange = onChange || (() => {});
    this.tool = null;                 // { kind:'thing'|'terrain'|'delete', key }
    this.rot = 0;
    this.hover = null;                // [x, y]
    this.drag = null;                 // the tile the drag started on
    this.painted = new Set();         // tiles touched this drag, so one each
  }

  select(tool) {
    const same = this.tool && this.tool.kind === (tool && tool.kind)
      && this.tool.key === (tool && tool.key);
    this.tool = same ? null : tool;
    this.rot = 0;
    this.onChange();
  }

  rotate() {
    if (!this.tool || this.tool.kind !== 'thing') return;
    if (!THINGS[this.tool.key].rotates) return;
    this.rot = (this.rot + 1) % 4;
    this.onChange();
  }

  cancel() {
    this.tool = null;
    this.drag = null;
    this.onChange();
  }

  /* Where the origin tile should be so the thing appears centred on the
   * cursor. Without this a 3-wide dispenser hangs off to one side of the
   * pointer and placing it accurately becomes guesswork. */
  origin(x, y) {
    if (!this.tool || this.tool.kind !== 'thing') return [x, y];
    const def = THINGS[this.tool.key];
    let [w, h] = def.size;
    if (this.rot % 2 === 1) [w, h] = [h, w];
    return [x - Math.floor((w - 1) / 2), y - Math.floor((h - 1) / 2)];
  }

  valid(x, y) {
    if (!this.tool) return false;
    if (this.tool.kind === 'delete') {
      return !!(this.world.thingAt(x, y) || this.world.overheadAt(x, y));
    }
    if (this.tool.kind === 'terrain') return this.world.inside(x, y);
    const [ox, oy] = this.origin(x, y);
    return this.world.canPlace(this.tool.key, ox, oy, this.rot);
  }

  down(x, y) {
    if (!this.tool) return;
    this.drag = [x, y];
    this.painted.clear();
    this.apply(x, y);
  }

  move(x, y) {
    this.hover = [x, y];
    if (this.drag) this.apply(x, y);
  }

  up() {
    this.drag = null;
    this.painted.clear();
  }

  apply(x, y) {
    const tag = `${x},${y}`;
    if (this.painted.has(tag)) return;
    this.painted.add(tag);
    if (!this.tool) return;
    if (this.tool.kind === 'delete') {
      this.world.remove(x, y);
    } else if (this.tool.kind === 'terrain') {
      this.world.paint(this.tool.key, x, y);
    } else {
      const [ox, oy] = this.origin(x, y);
      this.world.place(this.tool.key, ox, oy, this.rot);
    }
    this.onChange();
  }

  /* The ghost, drawn over the lit world so it is visible in a dark corner. */
  overlay(c, renderer) {
    if (!this.hover) return;
    const [hx, hy] = this.hover;

    if (!this.tool) {
      c.strokeStyle = 'rgba(255,255,255,.16)';
      c.lineWidth = 1;
      c.strokeRect(hx * TILE + 0.5, hy * TILE + 0.5, TILE - 1, TILE - 1);
      return;
    }

    const ok = this.valid(hx, hy);
    const tint = ok ? 'rgba(120,220,160,' : 'rgba(230,90,70,';

    if (this.tool.kind === 'delete') {
      const t = this.world.thingAt(hx, hy) || this.world.overheadAt(hx, hy);
      const tiles = t ? t.tiles : [[hx, hy]];
      c.fillStyle = 'rgba(230,90,70,.28)';
      for (const [tx, ty] of tiles) c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      return;
    }

    if (this.tool.kind === 'terrain') {
      const def = TERRAIN[this.tool.key];
      c.globalAlpha = 0.75;
      c.fillStyle = def.base;
      c.fillRect(hx * TILE, hy * TILE, TILE, TILE);
      c.globalAlpha = 1;
      c.strokeStyle = tint + '.9)';
      c.lineWidth = 1.5;
      c.strokeRect(hx * TILE + 0.5, hy * TILE + 0.5, TILE - 1, TILE - 1);
      return;
    }

    const def = THINGS[this.tool.key];
    const [ox, oy] = this.origin(hx, hy);
    let [w, h] = def.size;
    if (this.rot % 2 === 1) [w, h] = [h, w];

    if (ok) {
      renderer.drawThing({
        key: this.tool.key, rot: this.rot,
        cx: ox + w / 2, cy: oy + h / 2,
      }, true);
    }
    c.fillStyle = tint + (ok ? '.12)' : '.26)');
    c.fillRect(ox * TILE, oy * TILE, w * TILE, h * TILE);
    c.strokeStyle = tint + '.9)';
    c.lineWidth = 1.5;
    c.strokeRect(ox * TILE + 0.75, oy * TILE + 0.75, w * TILE - 1.5, h * TILE - 1.5);

    // Which way it is facing, for anything where that matters.
    if (def.rotates) {
      const cx = (ox + w / 2) * TILE, cy = (oy + h / 2) * TILE;
      const a = this.rot * Math.PI / 2 + Math.PI / 2;
      c.strokeStyle = tint + '.9)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a) * TILE * 0.42, cy + Math.sin(a) * TILE * 0.42);
      c.stroke();
    }
  }
}

/* The menu markup. Built from `defs` so a new object appears here for free. */
export function buildMenu(root, build) {
  const items = menuItems();
  const cats = CATEGORIES.filter(cat => items.some(i => i.cat === cat));
  root.innerHTML = `
    <div class="tabs">
      ${cats.map((cat, i) =>
        `<button class="tab${i ? '' : ' on'}" data-cat="${cat}">${cat}</button>`).join('')}
      <button class="tab del" data-tool="delete">Deconstruct</button>
    </div>
    <div class="items"></div>
    <div class="hint"></div>`;

  const itemsBox = root.querySelector('.items');
  const hint = root.querySelector('.hint');
  let cat = cats[0];

  function paintItems() {
    itemsBox.innerHTML = items.filter(i => i.cat === cat).map(i => `
      <button class="item" data-kind="${i.kind}" data-key="${i.key}">
        <span class="sw" data-sw="${i.key}"></span>
        <span class="lb">${i.label}</span>
      </button>`).join('');
    for (const el of itemsBox.querySelectorAll('.sw')) swatch(el);
    sync();
  }

  function sync() {
    const t = build.tool;
    for (const el of root.querySelectorAll('.item')) {
      el.classList.toggle('on', !!t && t.kind === el.dataset.kind
        && t.key === el.dataset.key);
    }
    for (const el of root.querySelectorAll('.tab')) {
      if (el.dataset.tool === 'delete') el.classList.toggle('on', !!t && t.kind === 'delete');
      else el.classList.toggle('on', el.dataset.cat === cat && (!t || t.kind !== 'delete'));
    }
    const def = t && t.kind === 'thing' ? THINGS[t.key] : null;
    hint.textContent = !t ? 'Pick something to build. Right-drag or space-drag to pan, wheel to zoom.'
      : t.kind === 'delete' ? 'Click or drag over anything you want gone.'
      : (def && def.hint) ? def.hint + (def.rotates ? '  ·  R to rotate.' : '')
      : 'Click to place, drag to place several. Esc to stop.';
  }

  root.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) {
      if (tab.dataset.tool === 'delete') build.select({ kind: 'delete' });
      else { cat = tab.dataset.cat; if (build.tool) build.cancel(); paintItems(); }
      sync();
      return;
    }
    const item = e.target.closest('.item');
    if (item) build.select({ kind: item.dataset.kind, key: item.dataset.key });
  });

  paintItems();
  return sync;
}

/* A tiny canvas thumbnail per item, drawn with the same routines as the world
 * so the menu can never disagree with what you get. */
function swatch(el) {
  const key = el.dataset.sw;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 26;
  const c = cv.getContext('2d');
  const def = THINGS[key];
  if (def) {
    const [w, h] = def.size;
    const s = 22 / Math.max(w, h) / TILE;
    c.translate(13, 13);
    c.scale(s, s);
    c.translate((-w * TILE) / 2, (-h * TILE) / 2);
    if (key === 'wall') {
      c.fillStyle = '#6a6a63'; c.fillRect(0, 0, TILE, TILE);
      c.fillStyle = '#7c7c74'; c.fillRect(0, 0, TILE, 6);
      c.strokeStyle = 'rgba(12,14,16,.72)'; c.lineWidth = 1.5;
      c.strokeRect(0.75, 0.75, TILE - 1.5, TILE - 1.5);
    } else {
      import('./art.js').then(({ ART }) => {
        const art = ART[key];
        if (art) art(c, w * TILE, h * TILE, {});
      });
    }
  } else if (TERRAIN[key]) {
    const t = TERRAIN[key];
    c.fillStyle = t.base;
    c.fillRect(2, 2, 22, 22);
    c.strokeStyle = t.grout || '#000';
    c.strokeRect(2.5, 2.5, 21, 21);
  }
  el.appendChild(cv);
}
