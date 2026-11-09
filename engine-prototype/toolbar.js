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
window.azwahControls.onState(state => {
  tabs.replaceChildren(...state.tabs.map(({ url }, index) => {
    const button = document.createElement('button');
    button.textContent = url ? new URL(url).hostname : 'New tab';
    button.setAttribute('aria-pressed', String(index === state.active));
    button.addEventListener('click', () => act('select', index));
    return button;
  }));
  const current = state.tabs[state.active]?.url || '';
  if (document.activeElement !== address) address.value = current;
  status.textContent = current ? new URL(current).protocol === 'https:' ? 'HTTPS' : 'HTTP' : '';
});
act('state');
