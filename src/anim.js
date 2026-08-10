/* The only things in the room that move.
 *
 * There is no simulation yet — this is not it. This is the handful of objects
 * whose *drawing* has state: a fan that is turning, and turning at some
 * particular rate. It gets its own step because the renderer should not be
 * integrating physics between frames, and because when a real simulation
 * arrives it will want its own clock rather than this one.
 *
 * The interesting part is that starting and stopping are not the same curve.
 * A motor pulls a fan up to speed; nothing but friction slows it down, and
 * friction is much weaker than the motor. So spinning up takes a couple of
 * seconds and coasting to a stop takes ten or more, and the blades pass
 * through the visible-individually range on the way both times. Symmetrical
 * easing reads immediately as a texture being rotated by a computer.
 */

import { THINGS } from './defs.js';

export function step(world, dt) {
  for (const t of world.things.values()) {
    const spin = THINGS[t.key].spin;
    if (!spin) continue;

    const target = spin.speeds[t.speed || 0] || 0;
    const driven = target > t.rate;
    // Exponential approach towards the target, at whichever time constant
    // applies — the motor's when speeding up, friction's when slowing.
    const tau = driven ? spin.up : spin.down;
    t.rate += (target - t.rate) * (1 - Math.exp(-dt / tau));
    // ...plus a little dry friction, so a coasting fan actually stops instead
    // of asymptotically almost-stopping forever.
    if (!driven) t.rate = Math.max(target, t.rate - spin.drag * dt);
    if (t.rate < 0.03) t.rate = 0;

    t.spin = (t.spin + t.rate * dt) % (Math.PI * 2);
  }
}

/* How smeared the blades are, 0..1. Below `sharp` you can count them; above
 * `blurred` they are a disc. Used by the art and by the floor shadow, so the
 * two always agree about how fast the thing is going. */
export function blur(thing) {
  const spin = THINGS[thing.key].spin;
  if (!spin) return 0;
  const v = (Math.abs(thing.rate || 0) - spin.sharp) / (spin.blurred - spin.sharp);
  return Math.max(0, Math.min(1, v));
}

/* Click a fan and it changes speed: off, low, medium, high, off. */
export function cycle(thing) {
  const spin = THINGS[thing.key].spin;
  if (!spin) return false;
  thing.speed = ((thing.speed || 0) + 1) % spin.speeds.length;
  return true;
}
