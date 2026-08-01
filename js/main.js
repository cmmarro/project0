/* Entry point. Reads an optional ?seed= so a map can be shared or replayed. */
window.HF = window.HF || {};

(function () {
  function start() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('seed');
    const seed = raw !== null && raw !== '' && !isNaN(parseInt(raw, 10))
      ? parseInt(raw, 10) >>> 0
      : (Math.random() * 0xffffffff) >>> 0;

    // ?mode= lets a particular valley be shared complete with how hard it
    // presses; otherwise the last choice is remembered.
    const mode = params.get('mode') || HF.UI.savedScenario();
    const game = new HF.Game(seed, mode);
    window.game = game;               // handy when poking at a colony from the console
    HF.UI.init(game);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
