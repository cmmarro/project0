/* Map viewport: pan and zoom.

   The canvas stays a fixed-size bitmap of the whole isometric map and the
   camera moves it with a CSS transform, so the renderer never has to think
   about scrolling. Screen coordinates are converted back to canvas space here;
   turning canvas space into a tile is the projection's job, not the camera's. */
window.HF = window.HF || {};

HF.Camera = (function () {
  const MIN_SCALE = 0.22;
  const MAX_SCALE = 2.4;

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
    if (HF.Render) HF.Render.invalidate();
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
      const p = HF.Iso.toScreen(tx, ty, 0);
      cam.x = r.width / 2 - p.sx * cam.scale;
      cam.y = r.height / 2 - p.sy * cam.scale;
      clampView();
      apply();
    },

    /* Scale that fits roughly `tiles` tiles across, used to open a phone at a
       tappable zoom instead of showing the whole valley at once. */
    scaleForTilesAcross: function (tiles) {
      return HF.U.clamp(box().width / (tiles * HF.Iso.TW), MIN_SCALE, MAX_SCALE);
    },

    /* Screen point -> canvas pixel. */
    toCanvas: function (clientX, clientY) {
      const r = box();
      return {
        x: (clientX - r.left - cam.x) / cam.scale,
        y: (clientY - r.top - cam.y) / cam.scale,
      };
    },

    /* The slice of the canvas currently on screen, so the renderer can skip
       everything else. */
    visibleRect: function () {
      const r = box();
      return {
        x0: -cam.x / cam.scale,
        y0: -cam.y / cam.scale,
        x1: (r.width - cam.x) / cam.scale,
        y1: (r.height - cam.y) / cam.scale,
      };
    },

    refresh: function () { clampView(); apply(); },
  };
})();
