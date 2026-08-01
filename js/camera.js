/* Map viewport: pan and zoom.

   The canvas stays a fixed-size bitmap and the camera moves it with a CSS
   transform, so nothing in the renderer has to know about scrolling. Screen
   coordinates are converted back to tiles here rather than measured off the
   element, which keeps the maths exact under any transform. */
window.HF = window.HF || {};

HF.Camera = (function () {
  const T = HF.CFG.TILE;
  const MIN_SCALE = 0.3;
  const MAX_SCALE = 3.2;

  let canvas = null;
  let stage = null;
  const cam = { x: 0, y: 0, scale: 1 };

  function init(canvasEl, stageEl) {
    canvas = canvasEl;
    stage = stageEl;
  }

  function box() { return stage.getBoundingClientRect(); }

  function apply() {
    canvas.style.transform =
      'translate(' + cam.x.toFixed(2) + 'px,' + cam.y.toFixed(2) + 'px) scale(' + cam.scale + ')';
  }

  /* Keeps the map inside the viewport, centring whichever axis is smaller than
     the screen so a zoomed-out map never drifts into a corner. */
  function clampView() {
    const r = box();
    const w = canvas.width * cam.scale;
    const h = canvas.height * cam.scale;
    cam.x = w <= r.width ? (r.width - w) / 2 : HF.U.clamp(cam.x, r.width - w, 0);
    cam.y = h <= r.height ? (r.height - h) / 2 : HF.U.clamp(cam.y, r.height - h, 0);
  }

  /* Zooms about a screen point, so pinching and wheeling both keep whatever is
     under the fingers or cursor pinned in place. */
  function setScale(next, clientX, clientY) {
    const r = box();
    const ax = clientX == null ? r.width / 2 : clientX - r.left;
    const ay = clientY == null ? r.height / 2 : clientY - r.top;
    const wx = (ax - cam.x) / cam.scale;
    const wy = (ay - cam.y) / cam.scale;
    cam.scale = HF.U.clamp(next, MIN_SCALE, MAX_SCALE);
    cam.x = ax - wx * cam.scale;
    cam.y = ay - wy * cam.scale;
    clampView();
    apply();
  }

  return {
    init: init,
    apply: apply,
    cam: cam,

    zoomBy: function (factor, clientX, clientY) {
      setScale(cam.scale * factor, clientX, clientY);
    },

    panBy: function (dx, dy) {
      cam.x += dx;
      cam.y += dy;
      clampView();
      apply();
    },

    /* Whole map on screen - the desktop default. */
    fit: function () {
      const r = box();
      cam.scale = HF.U.clamp(
        Math.min(r.width / canvas.width, r.height / canvas.height), MIN_SCALE, MAX_SCALE);
      clampView();
      apply();
    },

    centerOn: function (tx, ty, scale) {
      const r = box();
      if (scale) cam.scale = HF.U.clamp(scale, MIN_SCALE, MAX_SCALE);
      cam.x = r.width / 2 - (tx + 0.5) * T * cam.scale;
      cam.y = r.height / 2 - (ty + 0.5) * T * cam.scale;
      clampView();
      apply();
    },

    /* Scale that fits roughly `tiles` tiles across the viewport - used to open
       a phone at a tappable zoom instead of a 9-pixel-per-tile postage stamp. */
    scaleForTilesAcross: function (tiles) {
      return HF.U.clamp(box().width / (tiles * T), MIN_SCALE, MAX_SCALE);
    },

    screenToTile: function (clientX, clientY) {
      const r = box();
      const x = Math.floor((clientX - r.left - cam.x) / cam.scale / T);
      const y = Math.floor((clientY - r.top - cam.y) / cam.scale / T);
      if (x < 0 || y < 0 || x >= HF.CFG.MAP_W || y >= HF.CFG.MAP_H) return null;
      return { x: x, y: y };
    },

    /* Re-clamp after a resize or orientation change. */
    refresh: function () { clampView(); apply(); },
  };
})();
