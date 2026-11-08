const { DEFAULTS, SKINS } = self.SpiderShared;
const $ = (id) => document.getElementById(id);
function fillSkins(sel, settings) {
  sel.innerHTML = '';
  for (const [id, s] of Object.entries(SKINS)) sel.add(new Option(s.name, id));
  for (const name of Object.keys(settings.customSkins || {})) sel.add(new Option(`★ ${name}`, `custom:${name}`));
  sel.value = settings.skin;
  if (sel.value !== settings.skin) sel.value = 'venom';
}

function jevLine(v) {
  if (!v.hunt.trim()) return '';
  if (!v.useJev || (v.jevProvider === 'local' ? !v.jevLocalModel : !v.jevKeySet)) {
    return 'Keyword matching';
  }
  return v.jevProvider === 'local' ? `Jev · ${v.jevLocalModel}` : `Jev · ${v.jevProvider}`;
}

function updateJev(v) {
  const label = jevLine(v);
  $('jevState').textContent = label;
  $('jevState').hidden = !label;
}

chrome.storage.local.get(Object.assign({}, DEFAULTS, { crawlLog: [], jevKeySet: false, jevProvider: 'typesafe', jevLocalModel: '', }), (v) => {
  $('hunt').value = v.hunt || '';
  $('mode').value = v.mode;
  $('creature').value = v.creature;
  fillSkins($('skin'), v);
  $('count').textContent = String((v.crawlLog || []).length);
  updateJev(v);
});

chrome.runtime.sendMessage({ type: 'spider-health' }, response => {
  $('backendState').textContent = !chrome.runtime.lastError && response?.ok
    ? 'Backend connected' : 'Backend offline';
});
$('backendResults').addEventListener('click', () =>
  chrome.tabs.create({ url: 'http://127.0.0.1:5195/' }));

let activeTabId = null;
$('enabled').disabled = true;
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const id = tabs[0]?.id;
  if (!Number.isInteger(id)) return;
  activeTabId = id;
  chrome.storage.session.get(`spider-tab-${id}`, value => {
    $('enabled').checked = value[`spider-tab-${id}`] === true;
    $('enabled').disabled = false;
  });
});
$('enabled').addEventListener('change', () => {
  if (activeTabId === null) return;
  const enabled = $('enabled').checked;
  const key = `spider-tab-${activeTabId}`;
  const notify = () => chrome.tabs.sendMessage(activeTabId,
    { type: 'spider-tab-activation', enabled }, () => void chrome.runtime.lastError);
  if (enabled) chrome.storage.session.set({ [key]: true }, notify);
  else chrome.storage.session.remove(key, notify);
});
$('mode').addEventListener('change', () => chrome.storage.local.set({ mode: $('mode').value }));
$('creature').addEventListener('change', () => chrome.storage.local.set({ creature: $('creature').value }));
$('skin').addEventListener('change', () => chrome.storage.local.set({ skin: $('skin').value }));
let huntTimer = null;
$('hunt').addEventListener('input', () => {
  clearTimeout(huntTimer);
  huntTimer = setTimeout(() => chrome.storage.local.set({ hunt: $('hunt').value.trim() }), 400);
});

$('export').addEventListener('click', () => {
  chrome.storage.local.get({ crawlLog: [] }, (v) => {
    const blob = new Blob([JSON.stringify(v.crawlLog, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spider-crawl-log.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
});
$('clear').addEventListener('click', () => chrome.storage.local.set({ crawlLog: [] }, () => { $('count').textContent = '0'; }));
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.crawlLog) $('count').textContent = String((changes.crawlLog.newValue || []).length);
  if (changes.jevKeySet || changes.hunt || changes.useJev ||
      changes.jevProvider || changes.jevLocalModel) {
    chrome.storage.local.get(Object.assign({}, DEFAULTS, {
      jevKeySet: false, jevProvider: 'typesafe', jevLocalModel: '',
    }), (v) => {
      updateJev(v);
    });
  }
});
