import { events } from '@dropins/tools/event-bus.js';
import { Header, provider as UI } from '@dropins/tools/components.js';
import { ensureAccountHeading } from '../../scripts/account-heading.js';
import {
  CUSTOMER_ORDER_DETAILS_PATH,
  CUSTOMER_ORDERS_PATH,
  fetchPlaceholders,
  rootLink,
} from '../../scripts/commerce.js';

export default async function decorate(block) {
  block.innerHTML = '';

  const accountOrderPath = new URL(rootLink(CUSTOMER_ORDER_DETAILS_PATH), window.location.origin)
    .pathname;
  if (window.location.pathname.replace(/\/$/, '') === accountOrderPath && block.closest('main')) {
    const heading = await ensureAccountHeading(block, 'Order');
    const placeholders = await fetchPlaceholders();
    const link = document.createElement('a');
    link.textContent = placeholders?.Global?.CommerceOrderHeader?.backToAllOrders || 'Back to all orders';
    link.href = rootLink(CUSTOMER_ORDERS_PATH);
    link.className = 'orders-list-link';
    block.append(link);
    events.on('order/data', (orderData) => {
      heading.textContent = orderData?.number ? `Order ${orderData.number}` : 'Order';
    }, { eager: true });
    return;
  }

  const headerContainer = document.createElement('div');
  await UI.render(Header, { title: 'Order' })(headerContainer);

  if (window.location.href.includes(CUSTOMER_ORDER_DETAILS_PATH)) {
    const placeholders = await fetchPlaceholders();

    const link = document.createElement('a');

    link.innerText = placeholders?.Global?.CommerceOrderHeader?.backToAllOrders;
    link.href = rootLink(CUSTOMER_ORDERS_PATH);
    link.classList.add('orders-list-link');

    block.appendChild(link);
  }

  block.appendChild(headerContainer);

  events.on('order/data', (orderData) => {
    UI.render(Header, { title: `Order ${orderData.number}` })(headerContainer);
  }, { eager: true });
}
