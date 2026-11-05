import {
  renderEventBooking, renderEventSummary, renderEventMetadata, renderEventFacts, formatBookingDate,
} from '../../../blocks/product-details/event-booking.js';
import { createCalendarButton } from '../../../scripts/event-app/calendar.js';

function futureDates() {
  const dateAt = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return {
    first: dateAt(2), second: dateAt(3), excluded: dateAt(4), last: dateAt(9),
  };
}

// Local-only deterministic content. Submission never contacts Commerce.
export default async function mount({
  paid = false, deferPrices = false, missingPrice = false, recurring = false, rejectPrices = false,
} = {}) {
  const style = (href) => new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = reject;
    document.head.append(link);
  });
  await Promise.all([
    style('/blocks/product-details/product-details.css'),
    style('/blocks/commerce-checkout-success/commerce-checkout-success.css'),
    style('/blocks/commerce-account-header/commerce-account-header.css'),
    style('/blocks/commerce-account-sidebar/commerce-account-sidebar.css'),
    style('/blocks/commerce-orders-list/commerce-orders-list.css'),
  ]);
  const main = document.querySelector('main');
  const root = document.createElement('div');
  root.style.maxWidth = '1200px';
  root.style.margin = '24px auto';
  root.style.padding = '16px';
  const title = document.createElement('h1');
  title.textContent = 'Event booking UI review';
  const block = document.createElement('div');
  block.className = 'product-details product-details--event block';
  if (paid) block.classList.add('product-details--paid-event');
  const accordion = document.createElement(paid ? 'section' : 'details');
  accordion.className = 'event-booking-accordion';
  if (paid) accordion.classList.add('event-booking-panel');
  else accordion.open = true;
  const heading = document.createElement(paid ? 'h2' : 'summary');
  heading.className = 'event-booking-accordion__summary';
  heading.textContent = 'Book tickets';
  const container = document.createElement('div');
  container.className = 'event-booking-accordion__content';
  const panelHeader = document.createElement('div');
  panelHeader.className = 'event-booking-panel__header';
  const panelDate = document.createElement('p');
  panelDate.className = 'event-booking-panel__date';
  if (paid) {
    panelHeader.append(heading, panelDate);
    accordion.append(panelHeader, container);
  } else accordion.append(heading, container);
  block.append(accordion);
  if (!paid) block.style.maxWidth = '520px';
  const event = {
    eventId: 'event-test',
    startsAtUtc: '2026-09-12T07:00:00Z',
    endsAtUtc: '2026-09-12T12:00:00Z',
    timezone: 'Australia/Brisbane',
    venue: { name: 'Riverstage', address: 'Brisbane City' },
    tags: [],
    allocations: [
      {
        allocatedCapacity: 30,
        availableQuantity: 3,
        commerceSku: 'ticket-a',
        eventAllocationId: 'allocation-a',
        space: { id: 'a', name: 'Main space' },
      },
      {
        allocatedCapacity: 30,
        availableQuantity: 20,
        commerceSku: 'ticket-b',
        eventAllocationId: 'allocation-b',
        space: { id: 'b', name: 'Second space' },
      },
    ],
  };
  if (recurring) {
    event.scheduleType = 'recurring';
    const dates = futureDates();
    event.recurrence = {
      startDate: dates.first,
      endDate: dates.last,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      excludedDates: [dates.excluded],
      dailyStartTime: '17:00',
      dailyEndTime: '20:00',
      sessionDurationMinutes: 60,
    };
    event.allocations[0].occurrences = [1, 2].map((index) => ({
      occurrenceId: `session-${index}`,
      localDate: dates.first,
      startsAtUtc: `${dates.first}T${index === 1 ? '07' : '09'}:00:00Z`,
      endsAtUtc: `${dates.first}T${index === 1 ? '08' : '10'}:00:00Z`,
      startTime: index === 1 ? '17:00' : '19:00',
      endTime: index === 1 ? '18:00' : '20:00',
      timezone: event.timezone,
      availableQuantity: index === 1 ? 2 : 0,
    }));
  }
  panelDate.textContent = formatBookingDate(event);
  const product = { name: 'Live music at Riverstage', prices: { final: { amount: 89, currency: 'AUD' } } };
  const summaryElement = document.createElement('div');
  const summary = renderEventSummary(summaryElement, { product, quantity: 0, paid });
  const quantityElement = document.createElement('div');
  const quantity = document.createElement('input');
  quantity.type = 'number';
  quantity.id = 'event-booking-quantity';
  quantity.min = '0';
  quantity.max = '20';
  quantity.value = '0';
  quantity.style.width = '80px';
  quantity.style.minHeight = '44px';
  quantityElement.append(quantity);
  let releasePrices;
  let priceCalls = 0;
  const prices = new Promise((resolve) => { releasePrices = resolve; });
  const children = [
    { ...product, sku: 'ticket-a' },
    { ...product, sku: 'ticket-b', prices: { final: { amount: 120, currency: 'AUD' } } },
  ];
  if (!deferPrices) releasePrices(missingPrice ? [] : children);
  let releaseSubmission;
  let holdSubmission = false;
  let failBooking = false;
  let calls = 0;
  let lastSubmission;
  const booking = renderEventBooking({
    container,
    paid,
    loadProducts: () => {
      priceCalls += 1;
      if (rejectPrices) throw new Error('Price service unavailable');
      return prices;
    },
    onPriceChange: (child) => summary.setProduct(child),
    onDateChange: (date) => {
      if (date) queueMicrotask(() => booking.setSessionAvailability(event));
    },
    onSessionChange: (session) => {
      panelDate.textContent = formatBookingDate(event, session) || 'Choose a date and start time';
    },
    event,
    product,
    labels: {},
    includeMetadata: false,
    initialQuantity: 0,
    quantityElement,
    summaryElement,
    cartUrl: '/cart',
    checkoutUrl: '/checkout',
    browseUrl: '/events',
    onQuantityChange: (value) => summary.setQuantity(value),
    onQuantityReset: () => { quantity.value = '0'; },
    addToCart: async (submission) => {
      lastSubmission = submission;
      calls += 1;
      if (holdSubmission) await new Promise((resolve) => { releaseSubmission = resolve; });
      if (failBooking) throw new Error('Test submission failure');
      return 'local-test-ref';
    },
  });
  quantity.addEventListener('input', () => booking.setQuantity(Number(quantity.value)));
  if (paid) {
    const wrapper = document.createElement('div');
    wrapper.className = 'product-details__wrapper';
    const gallery = document.createElement('div');
    gallery.className = 'product-details__gallery';
    const image = document.createElement('img');
    image.src = '/icons/heart.svg';
    image.alt = 'Riverstage event';
    image.style.height = '220px';
    gallery.append(image);
    const header = document.createElement('div');
    header.className = 'product-details__header';
    const h1 = document.createElement('h1');
    h1.textContent = product.name;
    header.append(h1);
    const metadata = document.createElement('div');
    metadata.className = 'product-details__event-details';
    renderEventMetadata(metadata, event, {}, { product: { ...product, sku: 'fixture-parent' } });
    const facts = document.createElement('div');
    facts.className = 'product-details__event-facts';
    renderEventFacts(facts, event);
    const actions = document.createElement('div');
    actions.className = 'product-details__event-actions';
    actions.append(accordion);
    const information = document.createElement('div');
    information.className = 'product-details__event-information';
    information.textContent = 'About this event: Live music at Riverstage.';
    wrapper.append(header, facts, gallery, actions, information, metadata);
    block.replaceChildren(wrapper);
  }
  const confirmation = document.createElement('div');
  confirmation.className = 'commerce-checkout-success';
  const calendar = createCalendarButton({ event, name: product.name });
  confirmation.append(calendar);
  root.append(title, block, confirmation);
  main.replaceChildren(root);
  document.body.classList.add('appear');
  return {
    booking,
    releasePrices: () => releasePrices(children),
    getPriceCalls: () => priceCalls,
    holdSubmission: (value) => { holdSubmission = value; },
    releaseSubmission: () => releaseSubmission?.(),
    event,
    product,
    confirmation,
    getCalls: () => calls,
    getLastSubmission: () => lastSubmission,
    failBooking: (value) => { failBooking = value; },
    async renderAccount() {
      const [{ default: renderHeader }, { default: renderSidebar }] = await Promise.all([
        import('../../../blocks/commerce-account-header/commerce-account-header.js'),
        import('../../../blocks/commerce-account-sidebar/commerce-account-sidebar.js'),
      ]);
      const account = document.createElement('section');
      const header = document.createElement('div');
      header.className = 'commerce-account-header';
      const sidebarWrapper = document.createElement('div');
      sidebarWrapper.className = 'commerce-account-sidebar-wrapper';
      const sidebar = document.createElement('div');
      sidebar.className = 'commerce-account-sidebar';
      sidebarWrapper.append(sidebar);
      account.append(header, sidebarWrapper);
      root.append(account);
      await renderHeader(header);
      await renderSidebar(sidebar);
      return account;
    },
    async renderConfirmation(eventOrder = true) {
      const { renderCheckoutSuccess } = await import('../../../blocks/commerce-checkout-success/commerce-checkout-success.js');
      const money = { value: 178, currency: 'AUD' };
      const zero = { value: 0, currency: 'AUD' };
      const address = {
        firstName: 'Local',
        lastName: 'Test',
        street: ['1 Test Street'],
        city: 'Brisbane',
        countryCode: 'AU',
        postCode: '4000',
        region: 'QLD',
        regionId: '1',
        telephone: '00000000',
        customAttributes: [],
        company: '',
        middleName: '',
      };
      const orderData = {
        id: 'test-order',
        number: '100000001',
        email: 'local@example.test',
        status: 'Processing',
        isVirtual: true,
        totalQuantity: 2,
        orderDate: '2026-09-01T00:00:00Z',
        discounts: [],
        coupons: [],
        returns: [],
        shipments: [],
        appliedGiftCards: [],
        taxes: [],
        payments: [{ code: 'checkmo', name: 'Test payment' }],
        grandTotal: money,
        grandTotalExclTax: money,
        totalGiftCard: zero,
        subtotalExclTax: money,
        subtotalInclTax: money,
        totalTax: zero,
        totalShipping: zero,
        totalGiftOptions: {
          giftWrappingForItems: zero,
          giftWrappingForItemsInclTax: zero,
          giftWrappingForOrder: zero,
          giftWrappingForOrderInclTax: zero,
          printedCard: zero,
          printedCardInclTax: zero,
        },
        giftReceiptIncluded: false,
        printedCardIncluded: false,
        giftWrappingOrder: { price: zero, uid: '' },
        billingAddress: address,
        shippingAddress: null,
        availableActions: [],
        items: [{
          id: 'test-item',
          productSku: 'ticket-a',
          productName: product.name,
          productUrlKey: 'test-event',
          product: {
            name: product.name,
            sku: 'ticket-a',
            uid: 'test-item',
            id: 'test-item',
            __typename: 'SimpleProduct',
            productType: 'virtual',
            thumbnail: { url: '', label: '' },
          },
          totalQuantity: 2,
          quantityOrdered: 2,
          quantityShipped: 0,
          quantityCanceled: 0,
          quantityInvoiced: 0,
          quantityRefunded: 0,
          quantityReturned: 0,
          quantityReturnRequested: 0,
          giftMessage: { senderName: '', recipientName: '', message: '' },
          productGiftWrapping: [],
          giftWrappingAvailable: false,
          giftWrappingPrice: zero,
          price: { value: 89, currency: 'AUD' },
          total: money,
          totalInclTax: money,
          productSalePrice: { value: 89, currency: 'AUD' },
          selectedOptions: [],
          configurableOptions: {},
          bundleOptions: null,
          downloadableLinks: null,
          prices: { price: money, originalPrice: money, discounts: [] },
          itemPrices: { price: money, originalPrice: money, discounts: [] },
          taxCalculations: {
            includeAndExcludeTax: {
              originalPrice: money,
              baseOriginalPrice: money,
              baseDiscountedPrice: money,
              baseExcludingTax: money,
            },
            excludeTax: {
              originalPrice: money,
              baseOriginalPrice: money,
              baseDiscountedPrice: money,
              baseExcludingTax: money,
            },
            includeTax: {
              originalPrice: money,
              singleItemPrice: money,
              baseOriginalPrice: money,
              baseDiscountedPrice: money,
            },
          },
          eligibleForReturn: false,
        }],
      };
      await renderCheckoutSuccess(confirmation, {
        orderData,
        bookingSummaries: eventOrder ? [{
          sku: 'ticket-a', quantity: 2, correlationStatus: 'linked', event,
        }] : [],
      });
    },
  };
}

// Exercise the real PDP decorator and batch API with local read-only responses.
export async function mountDecoratedPdp({
  amount = 89, eventProduct = true, categories = [], categoryError = false,
  groupedPricesOnly = false, omitGroupedPrices = false,
  recurring = false, deferDetails = false, deferAvailability = false,
  failAvailabilityOnce = false, emptyAvailability = false, scheduledWeekdays,
} = {}) {
  const { initializeConfig } = await import('@dropins/tools/lib/aem/configs.js');
  const { events } = await import('@dropins/tools/event-bus.js');
  const commerce = await import('../../../scripts/commerce.js');
  const config = await fetch('/config.json').then((response) => response.json());
  initializeConfig(config);
  commerce.CS_FETCH_GRAPHQL.setEndpoint('https://paid-event.test/graphql');
  commerce.CORE_FETCH_GRAPHQL.setEndpoint('https://paid-event.test/graphql');
  const meta = document.createElement('meta');
  meta.name = 'sku';
  meta.content = 'fixture-parent';
  document.head.append(meta);
  const originalFetch = window.fetch;
  const rawProduct = (sku, value) => ({
    __typename: 'SimpleProductView',
    sku,
    name: 'Live music at Riverstage',
    inStock: true,
    addToCartAllowed: true,
    attributes: [],
    images: [],
    links: [],
    shortDescription: 'Live music by the river.',
    description: 'About this event: an evening of live music.',
    price: {
      roles: ['visible'],
      final: { amount: { value, currency: 'AUD' } },
      regular: { amount: { value, currency: 'AUD' } },
    },
  });
  let batchRequests = 0;
  const breadcrumbRequests = [];
  const priceRequests = [];
  const availabilityRequests = [];
  let releaseDetails;
  let releaseAvailability;
  const detailsGate = new Promise((resolve) => { releaseDetails = resolve; });
  const availabilityGate = new Promise((resolve) => { releaseAvailability = resolve; });
  if (!deferDetails) releaseDetails();
  if (!deferAvailability) releaseAvailability();
  let eventResponse;
  const dates = futureDates();
  window.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes('/event-api/detail')) {
      await detailsGate;
      eventResponse = {
        event: {
          event_id: 'fixture-event',
          starts_at_utc: '2026-09-12T07:00:00Z',
          ends_at_utc: '2026-09-12T12:00:00Z',
          timezone: 'Australia/Brisbane',
          tags: [],
          venue: {
            venue_id: 'riverstage',
            name: 'Riverstage',
            address: { lines: ['Riverstage'], city: 'Brisbane', country_code: 'AU' },
          },
          allocations: [{
            event_allocation_id: 'allocation-a',
            commerce_sku: 'ticket-a',
            allocated_capacity: 10,
            available_quantity: 10,
            space: { name: 'Main space', space_id: 'main' },
            zone: null,
          }, ...((groupedPricesOnly || recurring) ? [{
            event_allocation_id: 'allocation-b',
            commerce_sku: 'ticket-b',
            allocated_capacity: 20,
            available_quantity: 20,
            space: { name: 'Second space', space_id: 'second' },
            zone: null,
          }] : [])],
        },
      };
      if (recurring) {
        eventResponse.event.schedule_type = 'recurring';
        eventResponse.event.recurrence = {
          start_date: dates.first,
          end_date: dates.last,
          weekdays: scheduledWeekdays || [1, 2, 3, 4, 5, 6, 7],
          daily_start_time: '09:00',
          daily_end_time: '18:00',
          session_duration_minutes: 60,
          excluded_dates: [dates.excluded],
        };
        eventResponse.event.allocations.forEach((allocation) => {
          allocation.available_quantity = 0;
        });
      }
      return Response.json(eventResponse);
    }
    if (url.includes('/event-api/availability')) {
      const allocationId = new URL(url).searchParams.get('event_allocation_id');
      const from = new URL(url).searchParams.get('from') || dates.first;
      const to = new URL(url).searchParams.get('to');
      availabilityRequests.push({ allocationId, from, to });
      if (failAvailabilityOnce && availabilityRequests.length === 1) {
        return Response.json({ error: 'Temporarily unavailable' }, { status: 503 });
      }
      await availabilityGate;
      return Response.json({
        event: {
          ...eventResponse.event,
          allocations: eventResponse.event.allocations
            .filter((allocation) => (
              !allocationId || allocation.event_allocation_id === allocationId
            ))
            .map((allocation) => ({
              ...allocation,
              occurrences: emptyAvailability ? [] : [
                {
                  occurrence_id: `${allocation.event_allocation_id}-${from}-session-1`,
                  local_date: from,
                  start_time: '09:00',
                  end_time: '10:00',
                  starts_at_utc: new Date(Date.parse(`${from}T00:00:00Z`) - 3600000).toISOString(),
                  ends_at_utc: `${from}T00:00:00Z`,
                  timezone: 'Australia/Brisbane',
                  available_quantity: from !== dates.second ? 3
                    : Number(allocation.commerce_sku !== 'ticket-a') * 4,
                },
                {
                  occurrence_id: `${allocation.event_allocation_id}-${from}-session-2`,
                  local_date: from,
                  start_time: '10:00',
                  end_time: '11:00',
                  starts_at_utc: `${from}T00:00:00Z`,
                  ends_at_utc: `${from}T01:00:00Z`,
                  timezone: 'Australia/Brisbane',
                  available_quantity: from === dates.second || allocation.commerce_sku === 'ticket-b'
                    ? 0 : 2,
                },
              ],
            })),
        },
      });
    }
    if (url.startsWith('https://paid-event.test/graphql')) {
      const query = new URL(url).searchParams.get('query') || '';
      if (query.includes('GET_EVENT_BREADCRUMBS')) {
        breadcrumbRequests.push(JSON.parse(new URL(url).searchParams.get('variables')));
        if (categoryError) return Response.json({ errors: [{ message: 'Unavailable' }] });
        return Response.json({ data: { products: [{ sku: 'fixture-parent', categories }] } });
      }
      if (query.includes('GET_PRODUCTS_DATA')) {
        batchRequests += 1;
        const { skus } = JSON.parse(new URL(url).searchParams.get('variables'));
        priceRequests.push(skus);
        if (groupedPricesOnly) {
          const parent = {
            sku: 'fixture-parent',
            __typename: 'ComplexProductView',
            priceRange: { minimum: { final: { amount: { value: 999, currency: 'AUD' } } } },
            options: [{
              values: omitGroupedPrices ? [] : [
                { quantity: 1, product: rawProduct('ticket-a', 22) },
                { quantity: 1, product: rawProduct('ticket-b', 35) },
              ],
            }],
          };
          return Response.json({ data: { products: skus.includes('fixture-parent') ? [parent] : [] } });
        }
        return Response.json({
          data: {
            products: [rawProduct('ticket-a', 120),
              ...(recurring ? [rawProduct('ticket-b', 90)] : [])],
          },
        });
      }
      return Response.json({ data: { products: [rawProduct('fixture-parent', amount)] } });
    }
    if (url.includes('graphql') || url.includes('/booking-api/')) {
      throw new Error('Unexpected external request in local PDP fixture');
    }
    return originalFetch(input, options);
  };
  const { default: decorate } = await import('../../../blocks/product-details/product-details.js');
  events.emit('pdp/data', {
    sku: 'fixture-parent',
    name: 'Live music at Riverstage',
    inStock: true,
    addToCartAllowed: true,
    isBundle: false,
    prices: { final: { amount, currency: 'AUD' }, regular: { amount, currency: 'AUD' } },
    attributes: eventProduct ? [
      { id: 'is_event_ticket', label: 'Is event', value: '1' },
      { id: 'external_event_id', label: 'Event ID', value: 'fixture-event' },
    ] : [],
    images: [],
    options: [],
    description: 'About this event: an evening of live music.',
    shortDescription: 'Live music by the river.',
  });
  const block = document.createElement('div');
  block.className = 'product-details block';
  document.querySelector('main').replaceChildren(block);
  await decorate(block);
  return {
    block,
    getBatchRequests: () => batchRequests,
    getPriceRequests: () => priceRequests,
    releaseDetails,
    releaseAvailability,
    getAvailabilityRequests: () => availabilityRequests,
    getSessionDates: () => dates,
    getBreadcrumbRequests: () => breadcrumbRequests,
  };
}
