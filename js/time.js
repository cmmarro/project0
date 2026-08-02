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

  /* Waking hours, used to decide whether somebody should be looking for a bed
     rather than a job. Villagers still work through the night if they have to,
     they just resent it. */
  isSleepTime: function (tick) {
    const h = HF.Time.hour(tick);
    return h >= 21 || h < 6;
  },
};
