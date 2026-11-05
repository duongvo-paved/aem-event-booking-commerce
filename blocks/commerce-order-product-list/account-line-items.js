import { events } from '@dropins/tools/event-bus.js';
import { loadCSS } from '../../scripts/aem.js';
import { CS_FETCH_GRAPHQL, getProductLink } from '../../scripts/commerce.js';
import { createEventAppClient } from '../../scripts/event-app/client.js';
import { toAccountOrder } from '../../scripts/event-app/order-line-items.js';
import { createOrderSummarySlot } from '../commerce-orders-list/order-summary.js';

function formatMoney(amount) {
  if (!amount?.currency || !Number.isFinite(amount.value)) return '';
  return new Intl.NumberFormat(document.documentElement.lang || 'en', {
    style: 'currency', currency: amount.currency,
  }).format(amount.value);
}

function renderItemDetails(item, row, isEvent, parent) {
  const content = row.querySelector('.upcoming-booking__content');
  const details = document.createElement('dl');
  details.className = 'order-line-details';
  const add = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = String(value);
    details.append(term, description);
  };
  const data = item.lineDetails;
  if (!isEvent) add('Quantity', data.quantityOrdered);
  add('Unit price', formatMoney(data.priceInclTax || data.price || data.productSalePrice));
  add('Item total', formatMoney(data.totalInclTax || data.total));
  data.prices?.discounts?.forEach((discount) => {
    const amount = formatMoney({ currency: data.price?.currency, ...discount.amount });
    add('Discount', [discount.label, amount].filter(Boolean).join(' · '));
  });
  const options = { ...data.configurableOptions, ...data.bundleOptions };
  Object.entries(options).forEach(([label, value]) => add(label, value));
  if (!Object.keys(options).length) {
    data.selectedOptions?.forEach(({ label, value }) => add(label, value));
  }
  if (data.giftMessage?.message) {
    add('Gift from', data.giftMessage.senderName);
    add('Gift to', data.giftMessage.recipientName);
    add('Gift message', data.giftMessage.message);
  }
  data.productGiftWrapping?.filter((wrapping) => wrapping.selected)
    .forEach((wrapping) => add('Gift wrapping', wrapping.design));
  if (data.giftCard) {
    add('Gift card from', data.giftCard.senderName);
    add('Gift card to', data.giftCard.recipientName);
    add('Gift card recipient', data.giftCard.recipientEmail);
    add('Gift card message', data.giftCard.message);
  }
  if (details.childElementCount) {
    content.insertBefore(details, content.querySelector('.upcoming-booking__actions'));
  }
  const product = parent || data.product;
  const urlKey = product?.urlKey || data.productUrlKey;
  if (urlKey && product?.sku) {
    const title = content.querySelector('.upcoming-booking__name');
    const link = document.createElement('a');
    link.href = getProductLink(urlKey, product.sku);
    link.textContent = title.textContent;
    title.replaceChildren(link);
  }
}

export default async function renderAccountLineItems(block) {
  await loadCSS(`${window.hlx.codeBasePath}/blocks/commerce-orders-list/commerce-orders-list.css`);
  block.classList.add('commerce-orders-list', 'commerce-orders-list--history', 'account-order-line-items');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = 'Loading order items…';
  const mount = document.createElement('div');
  block.replaceChildren(status, mount);
  const slot = createOrderSummarySlot({
    catalog: CS_FETCH_GRAPHQL,
    client: createEventAppClient(),
    showOrderLink: false,
    showOrderMetadata: false,
    showEventOccurrence: true,
    renderItemDetails,
  });
  let update;
  const receive = (order) => {
    status.hidden = true;
    const context = { orderHistoryListItem: toAccountOrder(order, document.documentElement.lang || 'en') };
    if (update) update(context);
    else {
      slot({
        ...context,
        replaceWith: (element) => mount.replaceChildren(element),
        onChange: (callback) => { update = callback; },
      });
    }
  };
  events.on('order/data', receive, { eager: true });
  events.on('order/error', () => {
    if (update) return;
    status.hidden = false;
    status.textContent = 'Order items are temporarily unavailable.';
  });
}
