/* The start screen. Sets the backend once, for whichever mode you pick. */

const el = id => document.getElementById(id);
const PRESETS = {
  'LM Studio': 'http://localhost:1234/v1',
  'Ollama': 'http://localhost:11434/v1',
  'llama.cpp': 'http://localhost:8080/v1',
  'vLLM': 'http://localhost:8000/v1',
};
const FIELDS = {
  provider: 'cfg-provider', base_url: 'cfg-base', model: 'cfg-model',
  api_key: 'cfg-key', temperature: 'cfg-temp', effort: 'cfg-effort',
  max_tokens: 'cfg-maxtok', timeout: 'cfg-timeout', prompt_style: 'cfg-style',
  no_think: 'cfg-nothink',
};

function say(text, kind = '') {
  const s = el('status');
  s.textContent = text;
  s.className = 'status ' + kind;
}

function onlyRelevant() {
  const p = el('cfg-provider').value;
  document.querySelectorAll('[data-only]').forEach(n => {
    n.style.display = n.dataset.only === p ? '' : 'none';
  });
}

function read() {
  const out = {};
  for (const [key, id] of Object.entries(FIELDS)) {
    const n = el(id);
    if (!n) continue;
    out[key] = n.type === 'checkbox' ? n.checked
      : n.type === 'number' ? Number(n.value)
      : n.value;
  }
  // A masked key means "leave what's stored alone" — never send the dots back.
  if (out.api_key && /^•+$/.test(out.api_key)) delete out.api_key;
  return out;
}

function write(cfg) {
  for (const [key, id] of Object.entries(FIELDS)) {
    const n = el(id);
    if (!n || cfg[key] === undefined) continue;
    if (n.type === 'checkbox') n.checked = !!cfg[key];
    else n.value = cfg[key];
  }
  onlyRelevant();
}

function report(d) {
  if (d.error) say(d.error, 'bad');
  else if (d.online) say(`Ready — ${d.backend}`, 'ok');
  else say('No model configured. Both modes still run; the characters just '
         + "won't have anything to say.", '');
}

async function load() {
  try {
    const d = await (await fetch('/api/config')).json();
    write(d.settings);
    report(d);
  } catch (e) { say('Cannot reach the server.', 'bad'); }
}

el('cfg-provider').addEventListener('change', onlyRelevant);
document.querySelectorAll('[data-preset]').forEach(b =>
  b.addEventListener('click', () => {
    el('cfg-provider').value = 'openai';
    el('cfg-base').value = PRESETS[b.dataset.preset];
    onlyRelevant();
  }));

el('cfg-refresh').addEventListener('click', async () => {
  say('Asking what it has loaded…', 'busy');
  const d = await (await fetch('/api/config/models', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(read()),
  })).json();
  if (d.error) return say(d.error, 'bad');
  el('cfg-models').innerHTML = d.models.map(m => `<option value="${m}">`).join('');
  if (d.models.length && !el('cfg-model').value) el('cfg-model').value = d.models[0];
  say(d.models.length ? `Found: ${d.models.join(', ')}` : 'Nothing loaded.',
      d.models.length ? 'ok' : 'bad');
});

el('cfg-test').addEventListener('click', async () => {
  say('Making a real call…', 'busy');
  const d = await (await fetch('/api/config/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(read()),
  })).json();
  say(d.message, d.ok ? 'ok' : 'bad');
});

el('cfg-save').addEventListener('click', async () => {
  say('Saving…', 'busy');
  const d = await (await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(read()),
  })).json();
  write(d.settings);
  report(d);
});

load();
