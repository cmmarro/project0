/* Isometric projection.

   The simulation stays a plain square grid; this is the only place that knows
   the map is drawn as diamonds. Tiles are 2:1, and terrain elevation lifts a
   tile's top face while exposing the two side faces below it. */
window.HF = window.HF || {};

HF.Iso = (function () {
  const TW = 48, TH = 24;                 // tile footprint on screen
  const HW = TW / 2, HH = TH / 2;
  const ELEV = 13;                        // pixels per step of elevation
  const HEADROOM = 76;                    // space above the map for tall things
  const FOOTER = 26;

  const W = HF.CFG.MAP_W, H = HF.CFG.MAP_H;

  // Left edge belongs to the tile with the most negative (x - y): tile (0, H-1).
  const originX = (H - 1) * HW + HW;
  const originY = HEADROOM;

  const width = (W + H) * HW;
  const height = (W + H - 1) * HH + HH + HEADROOM + FOOTER;

  function elevOf(tile) {
    return HF.TERRAIN[tile.terrain].elev || 0;
  }

  /* Centre of a tile's top face, in canvas pixels. */
  function toScreen(x, y, elev) {
    return {
      sx: (x - y) * HW + originX,
      sy: (x + y) * HH + originY - (elev || 0) * ELEV,
    };
  }

  function inDiamond(px, py, sx, sy) {
    return Math.abs(px - sx) / HW + Math.abs(py - sy) / HH <= 1;
  }

  return {
    TW: TW, TH: TH, HW: HW, HH: HH, ELEV: ELEV,
    width: width, height: height,
    originX: originX, originY: originY,
    elevOf: elevOf,
    toScreen: toScreen,
    inDiamond: inDiamond,

    /* Depth order: everything on a lower (x + y) is further away. */
    maxDepth: (W - 1) + (H - 1),
    rowStart: function (d) { return Math.max(0, d - (H - 1)); },
    rowEnd: function (d) { return Math.min(W - 1, d); },

    /* Canvas pixel -> tile.

       Raised tiles are drawn higher up the screen, so a point can fall inside
       more than one tile's diamond. Walk front to back and take the first hit,
       which is what the eye picks too. Falls back to the flat ground plane so a
       click never lands on nothing. */
    toTile: function (game, px, py) {
      for (let d = HF.Iso.maxDepth; d >= 0; d--) {
        const x0 = HF.Iso.rowStart(d), x1 = HF.Iso.rowEnd(d);
        for (let x = x0; x <= x1; x++) {
          const y = d - x;
          const tile = game.tiles[y * W + x];
          const p = toScreen(x, y, elevOf(tile));
          if (inDiamond(px, py, p.sx, p.sy)) return { x: x, y: y };
        }
      }
      const fx = (px - originX) / HW;
      const fy = (py - originY) / HH;
      const x = Math.floor((fy + fx) / 2);
      const y = Math.floor((fy - fx) / 2);
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      return { x: x, y: y };
    },
  };
})();
