import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/* eslint-disable no-console */
const target = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/config.json', {
  method: 'PUT',
}).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  id += 1;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const run = async (expression) => {
  const message = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (message.result.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails));
  return message.result.result.value;
};

try {
  await send('Page.enable');
  await new Promise(resolve => setTimeout(resolve, 700));
  const result = await run(`(async () => {
    const { createCheckoutFragment, selectors } = await import('/blocks/commerce-checkout/fragments.js');
    const { observeAddressPickerLabels } = await import('/blocks/commerce-checkout/address-picker-labels.js');
    const fragment = createCheckoutFragment();
    const block = document.createElement('div'); block.className = 'commerce-checkout';
    document.body.replaceChildren(block); block.append(fragment);
    const moved = fragment.querySelector(selectors.checkout.main) === null;
    const main = block.querySelector(selectors.checkout.main);
    const stop = observeAddressPickerLabels(main);
    const missingStop = observeAddressPickerLabels(null);
    missingStop();
    const content = document.createElement('div'); content.className = 'dropin-field__content';
    const picker = document.createElement('div'); picker.className = 'dropin-picker'; content.append(picker);
    const select = document.createElement('select'); select.name = 'region'; select.id = 'billing_region'; select.required = true; select.setAttribute('aria-label', 'State/Province');
    const option = document.createElement('option'); option.value = ''; option.textContent = 'State/Province *'; option.className = 'dropin-picker__placeholder'; select.append(option); picker.append(select); main.append(content);
    await new Promise(resolve => setTimeout(resolve, 30));
    const label = content.querySelector('.checkout__region-label');
    const result = { moved, main: main instanceof Node, label: label?.textContent, associated: label?.htmlFor === select.id, required: !select.checkValidity() };
    picker.remove(); await new Promise(resolve => setTimeout(resolve, 30));
    result.cleaned = !content.querySelector('.checkout__region-label');
    stop();
    const source = await fetch('/blocks/commerce-checkout/commerce-checkout.js').then(response => response.text());
    result.mountedLookup = source.includes('block.querySelector(selectors.checkout.main)');
    return result;
  })()`);
  assert.equal(result.moved, true);
  assert.equal(result.main, true);
  assert.equal(result.label, 'State/Province *');
  assert.equal(result.associated, true);
  assert.equal(result.required, true);
  assert.equal(result.cleaned, true);
  assert.equal(result.mountedLookup, true);
  console.log('Checkout address-label regression passed: mounted fragment lookup, null guard, dynamic label, association, required validation, and cleanup.');
} finally {
  socket.close();
}
