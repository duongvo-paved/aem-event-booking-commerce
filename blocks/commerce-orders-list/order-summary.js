import { createBookingRow } from './upcoming-bookings.js';
import { loadEventProductIndex } from '../../scripts/event-app/cart-product-links.js';
import { getExternalEventId } from '../../scripts/event-app/models.js';
import { loadOrderOccurrences } from '../../scripts/event-app/order-occurrences.js';

export function createOrderSummarySlot({
  catalog,
  client,
  orderLink,
  showOrderLink = true,
  showOrderMetadata = true,
  showEventOccurrence = false,
  renderItemDetails,
}) {
  let pending = [];
  let scheduled = false;
  const eventCache = new Map();
  const eventRequests = new Map();

  async function enrichPending() {
    const batch = pending;
    pending = [];
    scheduled = false;
    try {
      if (!client.config.enabled) throw new Error('Event details are unavailable');
      const [products, occurrences] = await Promise.all([
        loadEventProductIndex(catalog),
        showEventOccurrence
          ? loadOrderOccurrences(batch.map(({ order }) => order.number))
          : new Map(),
      ]);
      const ids = batch.flatMap(({ order }) => order.items || [])
        .map((item) => products.get(item.sku) || products.get(item.topLevelSku))
        .filter(Boolean).map(getExternalEventId)
        .filter(Boolean);
      const missing = [...new Set(ids)]
        .filter((id) => !eventCache.has(id) && !eventRequests.has(id));
      if (missing.length) {
        const request = client.enrich(missing).then((events) => {
          events.forEach((event, id) => eventCache.set(id, event));
        }).catch((error) => {
          missing.forEach((id) => eventRequests.delete(id));
          throw error;
        });
        missing.forEach((id) => eventRequests.set(id, request));
      }
      await Promise.all([...new Set(ids.map((id) => eventRequests.get(id)).filter(Boolean))]);
      batch.forEach((entry) => entry.update(products, eventCache, false, occurrences));
    } catch {
      // Existing order details remain usable when public event metadata is unavailable.
      batch.forEach((entry) => entry.update(new Map(), new Map(), true));
    }
  }

  return (ctx) => {
    const summary = document.createElement('div');
    summary.className = 'order-booking-summary';
    ctx.replaceWith(summary);
    let version = 0;

    const render = ({ orderHistoryListItem: order }) => {
      version += 1;
      const current = version;
      const update = (
        products = new Map(),
        events = new Map(),
        unavailable = false,
        occurrences = new Map(),
      ) => {
        if (current !== version) return;
        const list = document.createElement('ul');
        list.className = 'upcoming-bookings__list';
        list.setAttribute('aria-label', `Items in order ${order.number}`);
        const total = order.total?.grandTotal;
        const amount = total?.currency && Number.isFinite(total.value)
          ? new Intl.NumberFormat(document.documentElement.lang || 'en', {
            style: 'currency', currency: total.currency,
          }).format(total.value) : '';
        const orderSummary = [
          `Ordered on ${order.orderDate || 'date unavailable'}`,
          `Order ${order.number}`, order.status, amount,
        ].filter(Boolean).join(' · ');
        (order.items || []).forEach((item) => {
          const product = products.get(item.sku) || products.get(item.topLevelSku);
          const eventId = product && getExternalEventId(product);
          const row = createBookingRow({
            orderNumber: order.number,
            orderDate: order.orderDate,
            orderSummary,
            name: item.productName,
            quantity: item.quantityOrdered,
            image: item.product?.smallImage?.url,
            isEvent: Boolean(eventId),
            event: events.get(eventId),
            occurrence: occurrences.get(`${order.number}:${item.id}`),
            showOrderLink,
            showOrderMetadata,
          }, orderLink);
          renderItemDetails?.(item, row, Boolean(eventId), product);
          list.append(row);
        });
        summary.replaceChildren(list);
        if (!order.items?.length) {
          summary.append(document.createTextNode(showOrderMetadata ? orderSummary : 'No order items'));
        }
        if (unavailable) {
          const notice = document.createElement('p');
          notice.className = 'order-booking-summary__notice';
          notice.textContent = 'Event details are temporarily unavailable. View your order for more information.';
          summary.append(notice);
        }
        summary.setAttribute('aria-busy', 'false');
      };
      update();
      summary.setAttribute('aria-busy', 'true');
      pending.push({ order, update });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(enrichPending);
      }
    };
    render(ctx);
    ctx.onChange(render);
  };
}
