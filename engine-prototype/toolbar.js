const address = document.querySelector('#address');
const tabs = document.querySelector('#tabs');
const status = document.querySelector('#status');
const act = (action, value) => window.azwahControls.action(action, value).catch(() => {
  status.textContent = 'The request failed. Check the address, connection or site certificate.';
});
document.querySelector('#navigation').addEventListener('submit', event => {
  event.preventDefault();
  act('navigate', address.value.trim());
});
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => act(button.dataset.action));
const focusAddress = () => { address.focus(); address.select(); };
window.azwahControls.onFocusAddress(focusAddress);
document.addEventListener('keydown', event => {
  if (!event.ctrlKey || event.altKey || event.shiftKey) return;
  const actions = { t: 'new', w: 'close', r: 'reload' };
  const key = event.key.toLowerCase();
  if (key === 'l' || actions[key]) {
    event.preventDefault();
    if (key === 'l') focusAddress(); else act(actions[key]);
  }
});
for (const name of ['bookmarks', 'history']) {
  document.getElementById(name).addEventListener('change', event => {
    if (event.target.value) act('navigate', event.target.value);
  });
}
const list = (id, label, values) => {
  const select = document.getElementById(id);
  select.replaceChildren(new Option(label, ''), ...values.map(({ label, value }) => new Option(label, value)));
};
const historySearch = document.getElementById('history-search');
let history = [];
const showHistory = () => {
  const term = historySearch.value.trim().toLowerCase();
  list('history', 'History', history.filter(url => url.toLowerCase().includes(term)).map(url => ({ label: url, value: url })));
};
historySearch.addEventListener('input', showHistory);
window.azwahControls.onState(state => {
  tabs.replaceChildren(...state.tabs.map(({ url }, index) => {
    const button = document.createElement('button');
    button.textContent = url ? new URL(url).hostname : 'New tab';
    button.setAttribute('aria-pressed', String(index === state.active));
    button.addEventListener('click', () => act('select', index));
    return button;
  }));
  list('bookmarks', 'Bookmarks', state.bookmarks.map(url => ({ label: url, value: url })));
  history = state.history;
  showHistory();
  list('downloads', 'Downloads', state.downloads.map(item => ({ label: item.name + ' · ' + item.status, value: '' })));
  list('extensions', 'Extensions', state.extensions.map(item => ({ label: item.name + ' · ' + item.status, value: '' })));
  const current = state.tabs[state.active]?.url || '';
  if (document.activeElement !== address) address.value = current;
  const error = state.tabs[state.active]?.error;
  status.textContent = [error, state.networkDiagnostic, !error && current ? new URL(current).protocol.slice(0, -1).toUpperCase() : ''].filter(Boolean).join(' · ');
});
act('state');
