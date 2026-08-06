// Canvas renderer. Reads state, draws pixels, changes nothing.
//
// Only the tiles inside the camera's view are drawn, so map size is no longer
// tied to what fits on screen.

import {
  FOG_UNKNOWN,
  FOG_VISIBLE,
  cityById,
  tileAt,
  tileIndex,
  unitById,
  unitsAt,
} from '../core/state.js';
import { TERRAIN, isPassable } from '../data/terrain.js';
import { UNITS } from '../data/units.js';
import { workedTiles } from '../core/economy.js';
import { canMove } from '../core/actions.js';
import { scaleOf, tileToScreen } from './camera.js';

// Distinct from the page background, so the edge of the map stays readable
// even when almost nothing has been explored.
const UNSEEN = '#151d27';

// Below these sizes the text is unreadable anyway and only adds clutter.
const MIN_SCALE_FOR_LABELS = 20;
const MIN_SCALE_FOR_GLYPHS = 12;

// Sizes the canvas to its container in real device pixels. Returns the CSS
// size, which is the coordinate space everything else works in.
export function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);

  return { width, height };
}

// The inclusive tile range covering the viewport, clipped to the map.
function visibleRange(cam, view, map) {
  const s = scaleOf(cam);
  const halfW = view.width / 2 / s;
  const halfH = view.height / 2 / s;
  return {
    x0: Math.max(0, Math.floor(cam.x - halfW)),
    x1: Math.min(map.width - 1, Math.ceil(cam.x + halfW)),
    y0: Math.max(0, Math.floor(cam.y - halfH)),
    y1: Math.min(map.height - 1, Math.ceil(cam.y + halfH)),
  };
}

export function render(ctx, state, cam, view, options = {}) {
  ctx.clearRect(0, 0, view.width, view.height);

  const s = scaleOf(cam);
  const range = visibleRange(cam, view, state.map);
  const at = (tx, ty) => tileToScreen(cam, view, tx, ty);

  drawTerrain(ctx, state, cam, view, range, s, at);
  drawWorkedTiles(ctx, state, s, at);
  drawMoveHints(ctx, state, s, at);
  drawCities(ctx, state, range, s, at);
  drawUnits(ctx, state, range, s, at);
  if (options.hover) drawHover(ctx, options.hover, s, at);
}

function drawTerrain(ctx, state, cam, view, range, s, at) {
  const { map } = state;
  // Overdraw by a fraction of a pixel so rounding never leaves seams between
  // tiles at fractional zoom levels.
  const size = s + 1;

  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const i = tileIndex(map, x, y);
      const p = at(x, y);
      const fog = state.fog[i];

      ctx.fillStyle = fog === FOG_UNKNOWN ? UNSEEN : TERRAIN[map.tiles[i].terrain].color;
      ctx.fillRect(p.x, p.y, size, size);

      if (fog === FOG_UNKNOWN) continue;

      if (fog !== FOG_VISIBLE) {
        ctx.fillStyle = 'rgba(6, 10, 16, 0.5)';
        ctx.fillRect(p.x, p.y, size, size);
      }

      if (s >= MIN_SCALE_FOR_GLYPHS) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, s - 1, s - 1);
      }
    }
  }
}

function drawWorkedTiles(ctx, state, s, at) {
  const city = cityById(state, state.selectedCityId);
  if (!city) return;

  ctx.strokeStyle = 'rgba(255, 226, 138, 0.85)';
  ctx.lineWidth = Math.max(1, s * 0.06);
  const inset = s * 0.07;
  for (const t of workedTiles(state, city)) {
    const p = at(t.x, t.y);
    ctx.strokeRect(p.x + inset, p.y + inset, s - inset * 2, s - inset * 2);
  }
}

function drawMoveHints(ctx, state, s, at) {
  const unit = unitById(state, state.selectedUnitId);
  if (!unit || unit.moves <= 0) return;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  const inset = s * 0.2;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = unit.x + dx;
      const y = unit.y + dy;
      const tile = tileAt(state.map, x, y);
      if (!tile || !isPassable(tile)) continue;
      if (canMove(state, unit, x, y)) continue;
      const p = at(x, y);
      ctx.fillRect(p.x + inset, p.y + inset, s - inset * 2, s - inset * 2);
    }
  }
}

const onScreen = (range, x, y) =>
  x >= range.x0 - 1 && x <= range.x1 + 1 && y >= range.y0 - 1 && y <= range.y1 + 1;

function drawCities(ctx, state, range, s, at) {
  for (const city of state.cities) {
    if (!onScreen(range, city.x, city.y)) continue;
    if (state.fog[tileIndex(state.map, city.x, city.y)] === FOG_UNKNOWN) continue;

    const p = at(city.x, city.y);
    const inset = s * 0.17;

    ctx.fillStyle = city.id === state.selectedCityId ? '#fff3d0' : '#f2e9d8';
    ctx.strokeStyle = '#2a2118';
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.rect(p.x + inset, p.y + inset, s - inset * 2, s - inset * 2);
    ctx.fill();
    ctx.stroke();

    if (s >= MIN_SCALE_FOR_GLYPHS) {
      ctx.fillStyle = '#2a2118';
      ctx.font = `bold ${Math.round(s * 0.4)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(city.pop), p.x + s / 2, p.y + s / 2 + 1);
    }

    if (s >= MIN_SCALE_FOR_LABELS) label(ctx, city.name, p.x + s / 2, p.y + s + 2);
  }
}

function drawUnits(ctx, state, range, s, at) {
  for (const unit of state.units) {
    if (!onScreen(range, unit.x, unit.y)) continue;
    if (state.fog[tileIndex(state.map, unit.x, unit.y)] === FOG_UNKNOWN) continue;

    const p = at(unit.x, unit.y);
    const cx = p.x + s / 2;
    const cy = p.y + s / 2;

    ctx.fillStyle = unit.moves > 0 ? 'rgba(24, 32, 44, 0.88)' : 'rgba(24, 32, 44, 0.45)';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2);
    ctx.fill();

    if (s >= MIN_SCALE_FOR_GLYPHS) {
      ctx.fillStyle = '#f5f7fa';
      ctx.font = `${Math.round(s * 0.45)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(UNITS[unit.type].glyph, cx, cy + 1);

      const stack = unitsAt(state, unit.x, unit.y);
      if (stack.length > 1 && stack[0].id === unit.id) {
        ctx.font = `${Math.round(s * 0.3)}px system-ui, sans-serif`;
        ctx.fillText(`+${stack.length - 1}`, p.x + s - s * 0.22, p.y + s * 0.22);
      }
    }

    if (unit.id === state.selectedUnitId) {
      ctx.strokeStyle = '#ffd66b';
      ctx.lineWidth = Math.max(1.5, s * 0.07);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawHover(ctx, hover, s, at) {
  const p = at(hover.x, hover.y);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(p.x + 1, p.y + 1, s - 2, s - 2);
}

function label(ctx, text, cx, top) {
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const w = ctx.measureText(text).width + 6;
  ctx.fillStyle = 'rgba(10, 14, 20, 0.72)';
  ctx.fillRect(cx - w / 2, top, w, 13);
  ctx.fillStyle = '#e8edf4';
  ctx.fillText(text, cx, top + 1.5);
}
