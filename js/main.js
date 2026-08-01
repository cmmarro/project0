/* Entry point. Reads an optional ?seed= so a map can be shared or replayed. */
window.HF = window.HF || {};

(function () {
  function start() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('seed');
    const seed = raw !== null && raw !== '' && !isNaN(parseInt(raw, 10))
      ? parseInt(raw, 10) >>> 0
      : (Math.random() * 0xffffffff) >>> 0;

    const game = new HF.Game(seed);
    window.game = game;               // handy when poking at a colony from the console
    HF.UI.init(game);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
