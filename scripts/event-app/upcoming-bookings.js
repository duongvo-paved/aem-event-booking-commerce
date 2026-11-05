import { getExternalEventId } from './models.js';
import { loadEventProductIndex } from './cart-product-links.js';
import { localInstant } from './calendar.js';
import { loadOrderOccurrences } from './order-occurrences.js';

function isCanceled(status) {
  return ['canceled', 'cancelled'].includes(String(status).trim().toLowerCase());
}

export async function loadCustomerOrders(fetchOrders) {
  const orders = [];
  let page = 1;
  let totalPages = 1;
  do {
    // Order placement date cannot determine whether its event is still upcoming.
    // eslint-disable-next-line no-await-in-loop
    const result = await fetchOrders(20, 'viewAll', page);
    if (!result || !Array.isArray(result.items)) throw new Error('Orders are unavailable');
    orders.push(...result.items);
    totalPages = result.pageInfo?.totalPages || 1;
    page += 1;
  } while (page <= totalPages);
  return orders;
}

export function selectUpcomingBookings(
  orders,
  products,
  events,
  now = Date.now(),
  occurrences = new Map(),
) {
  const bookings = [];
  let unavailable = false;
  orders.filter((order) => !isCanceled(order.status)).forEach((order) => {
    order.items?.filter((item) => !isCanceled(item.status)).forEach((item) => {
      const product = products.get(item.sku) || products.get(item.topLevelSku);
      const eventId = product && getExternalEventId(product);
      if (!eventId) return;
      const event = events.get(eventId);
      if (!event) {
        unavailable = true;
        return;
      }
      const recurring = event.scheduleType === 'recurring';
      const occurrence = occurrences.get(`${order.number}:${item.id}`);
      let startsAt;
      if (occurrence) {
        startsAt = localInstant(
          occurrence.localDate,
          occurrence.startTime,
          occurrence.timezone,
        );
      } else if (recurring) {
        startsAt = null;
      } else {
        startsAt = Date.parse(event.startsAtUtc);
      }
      if (!Number.isFinite(startsAt)) {
        unavailable = true;
        return;
      }
      if (startsAt <= now) return;
      bookings.push({
        orderNumber: order.number,
        itemId: item.id,
        name: item.productName,
        quantity: item.quantityOrdered,
        image: item.product?.smallImage?.url,
        event,
        occurrence,
        startsAt,
      });
    });
  });
  bookings.sort((a, b) => a.startsAt - b.startsAt);
  return { bookings, unavailable };
}

export async function loadUpcomingBookings({
  fetchOrders, catalog, client, now,
}) {
  const orders = await loadCustomerOrders(fetchOrders);
  if (!orders.length) return { bookings: [], unavailable: false };
  if (!client.config.enabled) throw new Error('Event details are unavailable');
  const products = await loadEventProductIndex(catalog);
  const eventOrders = orders.filter((order) => !isCanceled(order.status)
    && order.items?.some((item) => {
      if (isCanceled(item.status)) return false;
      const product = products.get(item.sku) || products.get(item.topLevelSku);
      return product && getExternalEventId(product);
    }));
  const ids = eventOrders.flatMap((order) => order.items || [])
    .filter((item) => !isCanceled(item.status))
    .map((item) => products.get(item.sku) || products.get(item.topLevelSku))
    .filter(Boolean)
    .map(getExternalEventId)
    .filter(Boolean);
  const [occurrences, events] = await Promise.all([
    loadOrderOccurrences(eventOrders.map((order) => order.number)),
    ids.length ? client.enrich([...new Set(ids)]) : new Map(),
  ]);
  return selectUpcomingBookings(orders, products, events, now, occurrences);
}
