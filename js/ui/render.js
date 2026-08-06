// Canvas renderer. Reads state, draws pixels, changes nothing.
//
// The whole map is redrawn every frame. At 40x24 tiles that is free, and it
// means there is no invalidation logic to get wrong.

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

export const TILE = 30;

// Distinct from the page background, so the edge of the map stays readable
// even when almost nothing has been explored.
const UNSEEN = '#151d27';

export function resizeCanvas(canvas, map) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = map.width * TILE * dpr;
  canvas.height = map.height * TILE * dpr;
  canvas.style.width = `${map.width * TILE}px`;
  canvas.style.height = `${map.height * TILE}px`;
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function tileFromEvent(canvas, event, map) {
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / (map.width * TILE);
  const x = Math.floor((event.clientX - rect.left) / (TILE * scale));
  const y = Math.floor((event.clientY - rect.top) / (TILE * scale));
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return { x, y };
}

export function render(ctx, state, view = {}) {
  const { map } = state;
  ctx.clearRect(0, 0, map.width * TILE, map.height * TILE);

  drawTerrain(ctx, state);
  drawWorkedTiles(ctx, state);
  drawMoveHints(ctx, state);
  drawCities(ctx, state);
  drawUnits(ctx, state);
  drawHover(ctx, state, view.hover);
}

function drawTerrain(ctx, state) {
  const { map } = state;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const fog = state.fog[tileIndex(map, x, y)];
      const px = x * TILE;
      const py = y * TILE;

      if (fog === FOG_UNKNOWN) {
        ctx.fillStyle = UNSEEN;
        ctx.fillRect(px, py, TILE, TILE);
        continue;
      }

      ctx.fillStyle = TERRAIN[map.tiles[tileIndex(map, x, y)].terrain].color;
      ctx.fillRect(px, py, TILE, TILE);

      if (fog !== FOG_VISIBLE) {
        ctx.fillStyle = 'rgba(6, 10, 16, 0.5)';
        ctx.fillRect(px, py, TILE, TILE);
      }

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    }
  }
}

function drawWorkedTiles(ctx, state) {
  const city = cityById(state, state.selectedCityId);
  if (!city) return;

  ctx.strokeStyle = 'rgba(255, 226, 138, 0.85)';
  ctx.lineWidth = 2;
  for (const p of workedTiles(state, city)) {
    ctx.strokeRect(p.x * TILE + 2, p.y * TILE + 2, TILE - 4, TILE - 4);
  }
}

function drawMoveHints(ctx, state) {
  const unit = unitById(state, state.selectedUnitId);
  if (!unit || unit.moves <= 0) return;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = unit.x + dx;
      const y = unit.y + dy;
      const tile = tileAt(state.map, x, y);
      if (!tile || !isPassable(tile)) continue;
      if (canMove(state, unit, x, y)) continue;
      ctx.fillRect(x * TILE + 6, y * TILE + 6, TILE - 12, TILE - 12);
    }
  }
}

function drawCities(ctx, state) {
  for (const city of state.cities) {
    if (state.fog[tileIndex(state.map, city.x, city.y)] === FOG_UNKNOWN) continue;

    const px = city.x * TILE;
    const py = city.y * TILE;

    ctx.fillStyle = city.id === state.selectedCityId ? '#fff3d0' : '#f2e9d8';
    ctx.strokeStyle = '#2a2118';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(px + 5, py + 5, TILE - 10, TILE - 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2a2118';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(city.pop), px + TILE / 2, py + TILE / 2 + 1);

    label(ctx, city.name, px + TILE / 2, py + TILE + 2);
  }
}

function drawUnits(ctx, state) {
  for (const unit of state.units) {
    if (state.fog[tileIndex(state.map, unit.x, unit.y)] === FOG_UNKNOWN) continue;

    const px = unit.x * TILE;
    const py = unit.y * TILE;
    const selected = unit.id === state.selectedUnitId;

    ctx.fillStyle = unit.moves > 0 ? 'rgba(24, 32, 44, 0.88)' : 'rgba(24, 32, 44, 0.45)';
    ctx.beginPath();
    ctx.arc(px + TILE / 2, py + TILE / 2, TILE * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f5f7fa';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(UNITS[unit.type].glyph, px + TILE / 2, py + TILE / 2 + 1);

    const stack = unitsAt(state, unit.x, unit.y);
    if (stack.length > 1 && stack[0].id === unit.id) {
      ctx.fillStyle = '#f5f7fa';
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillText(`+${stack.length - 1}`, px + TILE - 7, py + 7);
    }

    if (selected) {
      ctx.strokeStyle = '#ffd66b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + TILE / 2, py + TILE / 2, TILE * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawHover(ctx, state, hover) {
  if (!hover) return;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(hover.x * TILE + 1, hover.y * TILE + 1, TILE - 2, TILE - 2);
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
