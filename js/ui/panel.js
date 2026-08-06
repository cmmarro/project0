// Side panel. Builds HTML from state; main.js handles clicks by delegation on
// [data-act] attributes, so nothing here holds a listener or its own state.

import { cityById, tileAt, unitById, unitsAt } from '../core/state.js';
import { TERRAIN } from '../data/terrain.js';
import { UNITS, BUILDABLE } from '../data/units.js';
import { cityYields, foodToGrow } from '../core/economy.js';
import { canBuild, canFoundCity } from '../core/actions.js';

export function renderPanel(state, hover) {
  return [
    header(state),
    selectionSection(state),
    hoverSection(state, hover),
    logSection(state),
  ].join('');
}

function header(state) {
  return `
    <div class="panel-block turn-block">
      <div>
        <div class="turn-number">Turn ${state.turn}</div>
        <div class="muted">seed ${state.seed}</div>
      </div>
      <button class="primary" data-act="end-turn">End Turn</button>
    </div>`;
}

function selectionSection(state) {
  const city = cityById(state, state.selectedCityId);
  if (city) return citySection(state, city);

  const unit = unitById(state, state.selectedUnitId);
  if (unit) return unitSection(state, unit);

  return `
    <div class="panel-block">
      <h2>Nothing selected</h2>
      <p class="muted">
        Click a unit to select it, then click an adjacent tile to move.
        Arrow keys move too. Enter ends the turn.
      </p>
    </div>`;
}

function unitSection(state, unit) {
  const def = UNITS[unit.type];
  const stack = unitsAt(state, unit.x, unit.y);

  const actions = def.actions
    .map((id) => {
      if (id !== 'found_city') return '';
      const blocked = canFoundCity(state, unit);
      return button('found-city', 'Found City', blocked);
    })
    .join('');

  const cycle = stack.length > 1
    ? button('cycle-unit', `Next unit here (${stack.length})`, null)
    : '';

  return `
    <div class="panel-block">
      <h2>${def.glyph} ${def.name}</h2>
      <p class="muted">${def.blurb}</p>
      <dl class="stats">
        <div><dt>Movement</dt><dd>${unit.moves} / ${def.moves}</dd></div>
        <div><dt>Position</dt><dd>${unit.x}, ${unit.y}</dd></div>
      </dl>
      <div class="actions">
        ${actions}
        ${button('skip-unit', 'Hold', null)}
        ${cycle}
      </div>
    </div>`;
}

function citySection(state, city) {
  const y = cityYields(state, city);
  const needed = foodToGrow(city.pop);
  const order = city.order ? UNITS[city.order] : null;

  const growth = y.surplus > 0
    ? `${Math.ceil((needed - city.food) / y.surplus)} turns`
    : y.surplus < 0 ? 'starving' : 'stalled';

  const build = order
    ? `${order.name} — ${city.production} / ${order.cost}` +
      (y.production > 0
        ? ` (${Math.ceil((order.cost - city.production) / y.production)} turns)`
        : ' (no production)')
    : `<span class="muted">Idle — ${city.production} stored</span>`;

  const options = BUILDABLE.map((id) => {
    const def = UNITS[id];
    const blocked = canBuild(state, city, id);
    const active = city.order === id ? ' active' : '';
    return button(`build:${id}`, `${def.glyph} ${def.name} (${def.cost})`, blocked, active);
  }).join('');

  return `
    <div class="panel-block">
      <h2>${city.name}</h2>
      <dl class="stats">
        <div><dt>Population</dt><dd>${city.pop}</dd></div>
        <div><dt>Food</dt><dd>${city.food} / ${needed} <span class="muted">(${signed(y.surplus)}/turn, ${growth})</span></dd></div>
        <div><dt>Yields</dt><dd>${y.food} food, ${y.production} production</dd></div>
        <div><dt>Building</dt><dd>${build}</dd></div>
      </dl>
      <h3>Production</h3>
      <div class="actions">${options}</div>
    </div>`;
}

function hoverSection(state, hover) {
  if (!hover) return '';
  const tile = tileAt(state.map, hover.x, hover.y);
  if (!tile) return '';

  const t = TERRAIN[tile.terrain];
  const move = t.moveCost === null ? 'impassable' : `${t.moveCost} move`;

  return `
    <div class="panel-block tile-block">
      <strong>${t.name}</strong>
      <span class="muted">${t.food}f ${t.production}p · ${move} · ${hover.x}, ${hover.y}</span>
    </div>`;
}

function logSection(state) {
  const entries = state.log
    .slice(-8)
    .reverse()
    .map((e) => `<li><span class="muted">T${e.turn}</span> ${e.text}</li>`)
    .join('');

  return `
    <div class="panel-block">
      <h3>Log</h3>
      <ul class="log">${entries || '<li class="muted">Nothing yet.</li>'}</ul>
    </div>`;
}

function button(act, label, blocked, extra = '') {
  const disabled = blocked ? ' disabled' : '';
  const title = blocked ? ` title="${escapeAttr(blocked)}"` : '';
  return `<button data-act="${act}"${disabled}${title} class="${extra.trim()}">${label}</button>`;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

const escapeAttr = (s) => s.replace(/"/g, '&quot;');
