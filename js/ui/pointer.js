// Pointer handling for the map: tap, drag-to-pan, pinch-to-zoom, wheel-to-zoom.
//
// Pointer Events cover mouse, touch, and stylus with one code path, so there is
// no separate touch branch to keep in sync. This module knows nothing about the
// game -- it turns raw events into four intents and hands them up.

const DRAG_THRESHOLD = 8; // px of movement before a tap becomes a pan

export function attachPointerInput(canvas, handlers) {
  const active = new Map();
  let dragging = false;
  let pinchDistance = 0;
  let pinchMid = null;

  const local = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const points = () => [...active.values()];
  const spread = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    active.set(e.pointerId, { ...p, startX: p.x, startY: p.y });

    if (active.size === 2) {
      const [a, b] = points();
      pinchDistance = spread(a, b);
      pinchMid = midpoint(a, b);
      dragging = true; // a pinch is never a tap
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const tracked = active.get(e.pointerId);
    if (!tracked) {
      handlers.onHover?.(local(e));
      return;
    }

    const p = local(e);
    const prev = { x: tracked.x, y: tracked.y };
    tracked.x = p.x;
    tracked.y = p.y;

    if (active.size >= 2) {
      const [a, b] = points();
      const distance = spread(a, b);
      const mid = midpoint(a, b);

      if (pinchDistance > 0 && distance > 0) {
        handlers.onZoom?.(distance / pinchDistance, mid.x, mid.y);
      }
      // Two fingers also drag, so a pinch can reposition at the same time.
      if (pinchMid) handlers.onPan?.(mid.x - pinchMid.x, mid.y - pinchMid.y);

      pinchDistance = distance;
      pinchMid = mid;
      return;
    }

    if (!dragging) {
      const moved = Math.hypot(p.x - tracked.startX, p.y - tracked.startY);
      if (moved > DRAG_THRESHOLD) dragging = true;
    }

    if (dragging) handlers.onPan?.(p.x - prev.x, p.y - prev.y);
  });

  const release = (e) => {
    const tracked = active.get(e.pointerId);
    if (!tracked) return;
    active.delete(e.pointerId);

    if (active.size < 2) {
      pinchDistance = 0;
      pinchMid = null;
    }

    if (!active.size) {
      if (!dragging && e.type === 'pointerup') {
        handlers.onTap?.({ x: tracked.x, y: tracked.y }, e);
      }
      dragging = false;
    }
  };

  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('pointerleave', (e) => {
    if (!active.has(e.pointerId)) handlers.onHover?.(null);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    // Trackpads emit many small deltas; the exponential keeps them smooth
    // without letting a single mouse notch jump too far.
    handlers.onZoom?.(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });

  // Long-press and the iOS callout menu both fire this; neither is wanted on a
  // game board. Desktop right-click is handled as an explicit move instead.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
