/* The clock.

   The game used to advance only when the player pressed a button, which meant
   a day was a keystroke and nothing ever happened while you watched. Now it
   runs on its own and the player sets the speed - so the unit of play is a
   village going about its day rather than a turn being spent.

   Everything downstream is expressed in ticks. A tick is the smallest thing
   the simulation does; a day is TICKS_PER_DAY of them, and the seasons and the
   levy are counted in days. Nothing here touches the DOM, so the whole clock
   runs headlessly in a test. */
window.HF = window.HF || {};

HF.Time = {
  TICKS_PER_HOUR: 10,
  HOURS_PER_DAY: 24,
  get TICKS_PER_DAY() { return this.TICKS_PER_HOUR * this.HOURS_PER_DAY; },   // 240

  DAYS_PER_SEASON: 12,
  get DAYS_PER_YEAR() { return this.DAYS_PER_SEASON * 4; },                   // 48

  /* Sim ticks per real second at 1x. A day is about forty seconds, which is
     long enough to watch somebody walk somewhere and short enough that a
     season is not a chore. */
  BASE_TPS: 6,
  SPEEDS: [0, 1, 2, 4],
  SPEED_LABELS: ['Paused', '1x', '2x', '4x'],

  /* ---------- reading the clock ---------- */

  day: function (tick) { return Math.floor(tick / HF.Time.TICKS_PER_DAY); },
  tickOfDay: function (tick) { return tick % HF.Time.TICKS_PER_DAY; },
  hour: function (tick) { return HF.Time.tickOfDay(tick) / HF.Time.TICKS_PER_HOUR; },

  clockString: function (tick) {
    const h = Math.floor(HF.Time.hour(tick));
    const m = Math.floor((HF.Time.hour(tick) - h) * 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  },

  /* ---------- light ----------
     One number from 0 (deep night) to 1 (full day), plus a name for it. The
     renderer turns this into a single tint over the whole scene rather than
     recolouring every tile, which is what makes a live day/night cycle cheap
     enough to run at sixty frames on a phone. */
  DAWN: 5, SUNUP: 7, SUNDOWN: 17.5, DUSK: 19.5,

  light: function (tick) {
    const h = HF.Time.hour(tick);
    const T = HF.Time;
    if (h >= T.SUNUP && h <= T.SUNDOWN) return 1;
    if (h >= T.DUSK || h < T.DAWN) return 0;
    if (h < T.SUNUP) return (h - T.DAWN) / (T.SUNUP - T.DAWN);
    return 1 - (h - T.SUNDOWN) / (T.DUSK - T.SUNDOWN);
  },

  phase: function (tick) {
    const h = HF.Time.hour(tick);
    const T = HF.Time;
    if (h >= T.SUNUP && h <= T.SUNDOWN) return 'day';
    if (h >= T.DUSK || h < T.DAWN) return 'night';
    return h < T.SUNUP ? 'dawn' : 'dusk';
  },

  isNight: function (tick) {
    const h = HF.Time.hour(tick);
    return h >= HF.Time.DUSK || h < HF.Time.DAWN;
  },

  /* ---------- the sun ----------
     Where the light is coming from, as a direction on screen plus how high it
     is in the sky. The renderer uses the direction to decide which faces are
     lit and which way shadows fall, and the height to decide how long they
     are - so the valley genuinely changes through the day rather than being
     the same picture under a tint.

     Azimuth runs from sunrise in the east to sunset in the west across the
     daylight hours. Screen space is isometric, so east is down-right. */
  sun: function (tick) {
    const T = HF.Time;
    const h = T.hour(tick);
    // 0 at sunrise, 1 at sunset; clamped through the night so shadows do not
    // whip round while nobody can see them anyway.
    const span = T.SUNDOWN - T.SUNUP;
    const t = HF.U ? HF.U.clamp((h - T.SUNUP) / span, 0, 1) : Math.min(1, Math.max(0, (h - T.SUNUP) / span));

    // Height: zero at the horizon, one at noon.
    const height = Math.sin(t * Math.PI);

    /* The compass angle of the light, swung from the east through south to the
       west. Projected into the isometric basis so that "the sun is in the
       east" puts the shadows to the west on screen. */
    const az = Math.PI * (0.15 + t * 0.7);      // never quite due east or west
    const dx = Math.cos(az);
    const dy = Math.sin(az) * 0.5;              // 2:1 isometric foreshortening
    const len = Math.hypot(dx, dy) || 1;

    return {
      t: t,
      height: height,
      /* Unit vector pointing away from the sun: the way shadows are cast.

         The y component is negative on purpose, so shadows always fall up the
         screen, away from the camera. That is both how an isometric view reads
         naturally and the only direction that survives the painter's order: a
         shadow thrown towards the viewer lands on tiles that have not been
         drawn yet and is immediately painted over, which is why the first pass
         at this appeared to do nothing at all. */
      sx: -dx / len,
      sy: -dy / len,
      // Shadows stretch as the sun drops. Capped, or dawn shadows cross the map.
      length: HF.U ? HF.U.clamp(0.55 / Math.max(0.22, height), 0.7, 2.3)
                   : Math.min(2.3, Math.max(0.7, 0.55 / Math.max(0.22, height))),
    };
  },

  /* The colour the light itself is, graded through the day. Warm and low at
     each end, neutral at noon, and a cold moonlight through the night. */
  SKY: [
    { h: 0,    light: [58, 74, 122],  ambient: [40, 52, 88] },    // deep night
    { h: 5,    light: [92, 96, 140],  ambient: [58, 66, 104] },   // first grey
    { h: 6.5,  light: [232, 150, 108], ambient: [126, 116, 138] },// sunrise
    { h: 8.5,  light: [255, 226, 178], ambient: [172, 182, 196] },// early
    { h: 12,   light: [255, 248, 226], ambient: [190, 200, 214] },// noon
    { h: 15.5, light: [255, 236, 196], ambient: [184, 190, 202] },
    { h: 17.5, light: [246, 168, 110], ambient: [150, 136, 148] },// golden
    { h: 19,   light: [186, 108, 96],  ambient: [98, 92, 128] },  // sundown
    { h: 20.5, light: [86, 88, 132],   ambient: [56, 64, 100] },
    { h: 24,   light: [58, 74, 122],   ambient: [40, 52, 88] },
  ],

  skyAt: function (tick) {
    const h = HF.Time.hour(tick);
    const K = HF.Time.SKY;
    let a = K[0], b = K[K.length - 1];
    for (let i = 0; i < K.length - 1; i++) {
      if (h >= K[i].h && h <= K[i + 1].h) { a = K[i]; b = K[i + 1]; break; }
    }
    const span = b.h - a.h || 1;
    const f = HF.U ? HF.U.clamp((h - a.h) / span, 0, 1) : Math.min(1, Math.max(0, (h - a.h) / span));
    function mix(p, q) { return [
      p[0] + (q[0] - p[0]) * f,
      p[1] + (q[1] - p[1]) * f,
      p[2] + (q[2] - p[2]) * f,
    ]; }
    return { light: mix(a.light, b.light), ambient: mix(a.ambient, b.ambient) };
  },

  /* Waking hours, used to decide whether somebody should be looking for a bed
     rather than a job. Villagers still work through the night if they have to,
     they just resent it. */
  isSleepTime: function (tick) {
    const h = HF.Time.hour(tick);
    return h >= 21 || h < 6;
  },
};
