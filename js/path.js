/* 8-way A* over the tile grid, with a set of acceptable goals rather than a
   single destination (a chopping job can be worked from any adjacent tile). */
window.HF = window.HF || {};

function Heap() { this.a = []; }
Heap.prototype.push = function (node) {
  const a = this.a;
  a.push(node);
  let i = a.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (a[p].f <= a[i].f) break;
    const t = a[p]; a[p] = a[i]; a[i] = t;
    i = p;
  }
};
Heap.prototype.pop = function () {
  const a = this.a;
  const top = a[0];
  const last = a.pop();
  if (a.length) {
    a[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let s = i;
      if (l < a.length && a[l].f < a[s].f) s = l;
      if (r < a.length && a[r].f < a[s].f) s = r;
      if (s === i) break;
      const t = a[s]; a[s] = a[i]; a[i] = t;
      i = s;
    }
  }
  return top;
};

HF.Path = {
  /* opts.wallCost > 0 lets raiders route through walls, paying a penalty that
     stands in for the turns spent smashing them. */
  find: function (g, sx, sy, goals, opts) {
    opts = opts || {};
    if (!goals || goals.length === 0) return null;

    const goalSet = new Set();
    for (const gl of goals) goalSet.add(HF.U.key(gl.x, gl.y));
    if (goalSet.has(HF.U.key(sx, sy))) return [];

    const w = g.w, h = g.h;
    const gScore = new Float32Array(w * h).fill(Infinity);
    const cameFrom = new Int32Array(w * h).fill(-1);
    const closed = new Uint8Array(w * h);

    function heuristic(x, y) {
      let best = Infinity;
      for (const gl of goals) {
        const d = HF.U.dist(x, y, gl.x, gl.y);
        if (d < best) best = d;
      }
      return best;
    }

    function enterCost(x, y) {
      const t = HF.Map.at(g, x, y);
      if (!t) return -1;
      if (!HF.TERRAIN[t.terrain].passable) return -1;
      if (t.building != null) {
        const b = g.buildings[t.building];
        if (b && b.built && HF.BUILDINGS[b.type].blocks) {
          return opts.wallCost ? opts.wallCost : -1;
        }
      }
      return HF.TERRAIN[t.terrain].cost;
    }

    const start = sy * w + sx;
    gScore[start] = 0;
    const open = new Heap();
    open.push({ i: start, x: sx, y: sy, f: heuristic(sx, sy) });

    let goalIndex = -1;
    let expanded = 0;
    // Stale heap entries mean a tile can be popped more than once, so the
    // runaway guard has to sit comfortably above the tile count.
    const limit = w * h * 12;

    while (open.a.length && expanded++ < limit) {
      const cur = open.pop();
      if (closed[cur.i]) continue;
      closed[cur.i] = 1;

      if (goalSet.has(HF.U.key(cur.x, cur.y))) { goalIndex = cur.i; break; }

      for (const d of HF.U.NEIGHBORS) {
        const nx = cur.x + d[0], ny = cur.y + d[1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni]) continue;

        const c = enterCost(nx, ny);
        if (c < 0) continue;

        // No cutting corners diagonally between two blocked tiles.
        const diagonal = d[0] !== 0 && d[1] !== 0;
        if (diagonal) {
          if (enterCost(cur.x + d[0], cur.y) < 0 && enterCost(cur.x, cur.y + d[1]) < 0) continue;
        }

        const step = diagonal ? c * 1.4 : c;
        const tentative = gScore[cur.i] + step;
        if (tentative < gScore[ni]) {
          gScore[ni] = tentative;
          cameFrom[ni] = cur.i;
          open.push({ i: ni, x: nx, y: ny, f: tentative + heuristic(nx, ny) });
        }
      }
    }

    if (goalIndex < 0) return null;

    const path = [];
    let node = goalIndex;
    while (node !== start) {
      path.push({ x: node % w, y: (node / w) | 0 });
      node = cameFrom[node];
      if (node < 0) return null;
    }
    path.reverse();
    return path;
  },
};
