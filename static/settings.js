/* Model settings panel — pick a backend, point it at LM Studio, prove it works. */

const cfgEl = id => document.getElementById(id);
let CFG = null;

const PRESETS = {
  'LM Studio': 'http://localhost:1234/v1',
  'Ollama': 'http://localhost:11434/v1',
  'llama.cpp': 'http://localhost:8080/v1',
  'vLLM': 'http://localhost:8000/v1',
};

function openSettings() {
  cfgEl('settings').classList.remove('hidden');
  loadConfig();
}
function closeSettings() {
  cfgEl('settings').classList.add('hidden');
}

async function loadConfig() {
  const r = await fetch('/api/config');
  const d = await r.json();
  CFG = d.settings;
  cfgEl('cfg-provider').value = CFG.provider;
  cfgEl('cfg-base').value = CFG.base_url;
  cfgEl('cfg-model').value = CFG.model;
  cfgEl('cfg-key').value = CFG.has_key ? CFG.api_key : '';
  cfgEl('cfg-temp').value = CFG.temperature;
  cfgEl('cfg-effort').value = CFG.effort;
  cfgEl('cfg-maxtok').value = CFG.max_tokens;
  cfgEl('cfg-timeout').value = CFG.timeout;
  cfgEl('cfg-style').value = CFG.prompt_style || 'auto';
  cfgEl('cfg-nothink').checked = CFG.no_think !== false;
  syncProvider();
  status(d.online ? `connected — ${d.backend}` : (d.error || 'offline'), d.online ? 'ok' : 'warn');
}

function formValues() {
  return {
    provider: cfgEl('cfg-provider').value,
    base_url: cfgEl('cfg-base').value,
    model: cfgEl('cfg-model').value,
    api_key: cfgEl('cfg-key').value,
    temperature: parseFloat(cfgEl('cfg-temp').value) || 0.8,
    effort: cfgEl('cfg-effort').value,
    max_tokens: parseInt(cfgEl('cfg-maxtok').value, 10) || 1200,
    timeout: parseInt(cfgEl('cfg-timeout').value, 10) || 120,
    prompt_style: cfgEl('cfg-style').value,
    no_think: cfgEl('cfg-nothink').checked,
  };
}

function syncProvider() {
  const p = cfgEl('cfg-provider').value;
  document.querySelectorAll('[data-only]').forEach(el => {
    el.classList.toggle('hidden', !el.dataset.only.split(',').includes(p));
  });
  cfgEl('cfg-key').placeholder = p === 'anthropic'
    ? 'sk-ant-…  (or leave blank to use ANTHROPIC_API_KEY)'
    : 'leave blank unless your server has auth switched on';
}

function status(msg, kind = '') {
  const el = cfgEl('cfg-status');
  el.textContent = msg;
  el.className = 'cfg-status ' + kind;
}

async function refreshModels() {
  status('asking the server what it has loaded…');
  const r = await fetch('/api/config/models', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formValues()),
  });
  const d = await r.json();
  const list = cfgEl('cfg-models');
  list.innerHTML = '';
  if (d.error) { status(d.error, 'bad'); return; }
  if (!d.models.length) { status('reachable, but it reports no models loaded', 'warn'); return; }
  for (const m of d.models) {
    const o = document.createElement('option');
    o.value = m;
    list.appendChild(o);
  }
  if (!cfgEl('cfg-model').value) cfgEl('cfg-model').value = d.models[0];
  status(`${d.models.length} model${d.models.length > 1 ? 's' : ''} available`, 'ok');
}

async function testConnection() {
  status('calling the model…');
  const r = await fetch('/api/config/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formValues()),
  });
  const d = await r.json();
  status(d.message, d.ok ? 'ok' : 'bad');
}

async function saveConfig() {
  status('saving…');
  const r = await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formValues()),
  });
  const d = await r.json();
  CFG = d.settings;
  status(d.online ? `connected — ${d.backend}` : (d.error || 'offline'), d.online ? 'ok' : 'warn');
  if (d.online) setTimeout(closeSettings, 700);
}

cfgEl('cfg-provider').addEventListener('change', syncProvider);
cfgEl('cfg-refresh').addEventListener('click', refreshModels);
cfgEl('cfg-test').addEventListener('click', testConnection);
cfgEl('cfg-save').addEventListener('click', saveConfig);
cfgEl('cfg-close').addEventListener('click', closeSettings);
cfgEl('llm').addEventListener('click', openSettings);
document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
  cfgEl('cfg-provider').value = 'openai';
  cfgEl('cfg-base').value = PRESETS[b.dataset.preset];
  syncProvider();
  refreshModels();
}));
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !cfgEl('settings').classList.contains('hidden')) closeSettings();
});

// Open on first load if nothing is configured yet.
(async () => {
  const d = await (await fetch('/api/config')).json();
  if (!d.online) openSettings(); else loadConfig();
})();
