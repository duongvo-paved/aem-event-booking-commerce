import { render as accountRenderer } from '@dropins/storefront-account/render.js';
import { OrdersList } from '@dropins/storefront-account/containers/OrdersList.js';
import { getOrderHistoryList } from '@dropins/storefront-account/api.js';
import { readBlockConfig } from '../../scripts/aem.js';
import { ensureAccountHeading } from '../../scripts/account-heading.js';
import { createAccountLoadingPlaceholder, markAccountLoading } from '../../scripts/account-loading.js';
import {
  checkIsAuthenticated,
  CS_FETCH_GRAPHQL,
  CUSTOMER_LOGIN_PATH,
  CUSTOMER_ORDER_DETAILS_PATH,
  CUSTOMER_ORDERS_PATH,
  rootLink,
} from '../../scripts/commerce.js';
import { createEventAppClient } from '../../scripts/event-app/client.js';

// Initialize
import '../../scripts/initializers/account.js';

export default async function decorate(block) {
  const { 'minified-view': minifiedViewConfig = 'false' } = readBlockConfig(block);

  if (!checkIsAuthenticated()) {
    window.location.href = rootLink(CUSTOMER_LOGIN_PATH);
  } else if (minifiedViewConfig === 'true') {
    const { default: renderUpcomingBookings } = await import('./upcoming-bookings.js');
    await renderUpcomingBookings(block, {
      fetchOrders: getOrderHistoryList,
      catalog: CS_FETCH_GRAPHQL,
      client: createEventAppClient(),
      ordersLink: rootLink(CUSTOMER_ORDERS_PATH),
      orderLink: (number) => rootLink(`${CUSTOMER_ORDER_DETAILS_PATH}?orderRef=${encodeURIComponent(number)}`),
    });
  } else {
    await ensureAccountHeading(block, 'All orders');
    const { createOrderSummarySlot } = await import('./order-summary.js');
    const earlyPlaceholder = block.querySelector(':scope > .account-loading-placeholder');
    block.replaceChildren();
    if (earlyPlaceholder) block.append(earlyPlaceholder);
    block.classList.add('commerce-orders-list--history');
    const stopLoading = markAccountLoading(
      block,
      createAccountLoadingPlaceholder({ card: true, rows: 3 }),
    );
    try {
      await accountRenderer.render(OrdersList, {
        minifiedView: false,
        withHeader: false,
        withThumbnails: false,
        slots: {
          OrdersListCard: createOrderSummarySlot({
            catalog: CS_FETCH_GRAPHQL,
            client: createEventAppClient(),
            orderLink: (number) => rootLink(`${CUSTOMER_ORDER_DETAILS_PATH}?orderRef=${encodeURIComponent(number)}`),
            showEventOccurrence: true,
            showOrderMetadata: false,
          }),
          OrdersListAction: (ctx) => ctx.remove(),
        },
      })(block);
    } finally {
      stopLoading();
    }
  }
}
