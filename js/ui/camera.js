// Camera: the window onto the map.
//
// This is view state, not game state -- it is deliberately kept out of the
// state tree so a save file never records where someone was scrolled to.
//
// `x`/`y` are the tile coordinates at the center of the view and are floats;
// `zoom` multiplies TILE to give pixels-per-tile.

export const TILE = 32;
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.5;

export const createCamera = () => ({ x: 0, y: 0, zoom: 1 });

export const scaleOf = (cam) => TILE * cam.zoom;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function screenToTile(cam, view, px, py) {
  const s = scaleOf(cam);
  return {
    x: Math.floor((px - view.width / 2) / s + cam.x),
    y: Math.floor((py - view.height / 2) / s + cam.y),
  };
}

// Fractional tile coordinates -- used for zoom anchoring, where rounding to a
// whole tile would make the anchor drift.
export function screenToPoint(cam, view, px, py) {
  const s = scaleOf(cam);
  return {
    x: (px - view.width / 2) / s + cam.x,
    y: (py - view.height / 2) / s + cam.y,
  };
}

export function tileToScreen(cam, view, tx, ty) {
  const s = scaleOf(cam);
  return {
    x: (tx - cam.x) * s + view.width / 2,
    y: (ty - cam.y) * s + view.height / 2,
  };
}

// The zoom at which the whole map just fits. Also the floor for zooming out --
// there is no reason to let the player shrink the world into a corner.
export function fitZoom(map, view) {
  if (!view.width || !view.height) return 1;
  return Math.min(view.width / (map.width * TILE), view.height / (map.height * TILE));
}

// Keep the view over the map: centered on whichever axis the map is smaller
// than the viewport, clamped to the edges otherwise.
export function clampCamera(cam, map, view) {
  cam.zoom = clamp(cam.zoom, Math.min(MIN_ZOOM, fitZoom(map, view)), MAX_ZOOM);

  const s = scaleOf(cam);
  const halfW = view.width / 2 / s;
  const halfH = view.height / 2 / s;

  cam.x = map.width <= halfW * 2
    ? map.width / 2
    : clamp(cam.x, halfW, map.width - halfW);

  cam.y = map.height <= halfH * 2
    ? map.height / 2
    : clamp(cam.y, halfH, map.height - halfH);

  return cam;
}

export function panByPixels(cam, map, view, dxPx, dyPx) {
  const s = scaleOf(cam);
  cam.x -= dxPx / s;
  cam.y -= dyPx / s;
  clampCamera(cam, map, view);
}

// Zoom about a screen point, so the tile under the cursor or pinch midpoint
// stays put.
export function zoomAt(cam, map, view, factor, px, py) {
  const before = screenToPoint(cam, view, px, py);
  cam.zoom = clamp(cam.zoom * factor, Math.min(MIN_ZOOM, fitZoom(map, view)), MAX_ZOOM);
  const after = screenToPoint(cam, view, px, py);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  clampCamera(cam, map, view);
}

export function centerOn(cam, map, view, tx, ty) {
  cam.x = tx + 0.5;
  cam.y = ty + 0.5;
  clampCamera(cam, map, view);
}

// Nudge the view only when a tile is off screen or crowding the edge. Used
// after moves and selection changes so the camera follows without yanking.
export function ensureVisible(cam, map, view, tx, ty) {
  const s = scaleOf(cam);
  const marginX = Math.min(view.width * 0.3, s * 3);
  const marginY = Math.min(view.height * 0.3, s * 3);
  const p = tileToScreen(cam, view, tx + 0.5, ty + 0.5);

  const outside =
    p.x < marginX || p.x > view.width - marginX ||
    p.y < marginY || p.y > view.height - marginY;

  if (outside) centerOn(cam, map, view, tx, ty);
}
