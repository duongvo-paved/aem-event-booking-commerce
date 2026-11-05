/* eslint-disable import/no-unresolved */

// Tools and initializers
import { Button, provider as UI } from '@dropins/tools/components.js';
import { initializers } from '@dropins/tools/initializer.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
import { events } from '@dropins/tools/event-bus.js';

// Order Dropin API
import * as orderApi from '@dropins/storefront-order/api.js';
import { render as OrderProvider } from '@dropins/storefront-order/render.js';
import OrderHeader from '@dropins/storefront-order/containers/OrderHeader.js';
import OrderStatus from '@dropins/storefront-order/containers/OrderStatus.js';
import ShippingStatus from '@dropins/storefront-order/containers/ShippingStatus.js';
import CustomerDetails from '@dropins/storefront-order/containers/CustomerDetails.js';
import OrderCostSummary from '@dropins/storefront-order/containers/OrderCostSummary.js';
import OrderProductList from '@dropins/storefront-order/containers/OrderProductList.js';

// Checkout API/utils used for header and DOM
import * as checkoutApi from '@dropins/storefront-checkout/api.js';
import { createFragment, createScopedSelector } from '@dropins/storefront-checkout/lib/utils.js';

// Cart (for gift options within order confirmation)
import { render as CartProvider } from '@dropins/storefront-cart/render.js';
import GiftOptions from '@dropins/storefront-cart/containers/GiftOptions.js';

// Auth (for sign-up modal in header)
import { render as AuthProvider } from '@dropins/storefront-auth/render.js';
import SignUp from '@dropins/storefront-auth/containers/SignUp.js';

// Commerce helpers
import {
  CS_FETCH_GRAPHQL,
  fetchPlaceholders,
  rootLink,
  SUPPORT_PATH,
  ORDER_STATUS_PATH,
  authPrivacyPolicyConsentSlot,
} from '../../scripts/commerce.js';

// Ensure order drop-in initializer side effects are applied
import '../../scripts/initializers/order.js';

// Local modal helper
import createModal from '../modal/modal.js';
import { loadCSS } from '../../scripts/aem.js';
import {
  getCartBookingLabels,
  renderCartBookingPanel,
} from '../../scripts/event-app/cart-display.js';
import { createCalendarButton } from '../../scripts/event-app/calendar.js';
import { getCheckoutSuccess, saveCheckoutSuccess } from '../../scripts/checkout-success-dev.js';
import { createEventAppClient } from '../../scripts/event-app/client.js';
import { getExternalEventId } from '../../scripts/event-app/models.js';
import { loadEventProductIndex } from '../../scripts/event-app/cart-product-links.js';

// ----------------------------------------------------------------------------
// Local selectors and fragments (order confirmation only)
// ----------------------------------------------------------------------------

const selectors = Object.freeze({
  orderConfirmation: {
    header: '.order-confirmation__header',
    orderStatus: '.order-confirmation__order-status',
    shippingStatus: '.order-confirmation__shipping-status',
    customerDetails: '.order-confirmation__customer-details',
    orderCostSummary: '.order-confirmation__order-cost-summary',
    giftOptions: '.order-confirmation__gift-options',
    orderProductList: '.order-confirmation__order-product-list',
    bookingInformation: '.order-confirmation__booking-information',
    footer: '.order-confirmation__footer',
    continueButton: '.order-confirmation-footer__continue-button',
  },
});

function createOrderConfirmationFragment() {
  return createFragment(`
    <div class="order-confirmation">
      <div class="order-confirmation__main">
        <div class="order-confirmation__header order-confirmation__block"></div>
        <div class="order-confirmation__order-status order-confirmation__block"></div>
        <div class="order-confirmation__shipping-status order-confirmation__block"></div>
        <div class="order-confirmation__customer-details order-confirmation__block"></div>
      </div>
      <div class="order-confirmation__aside">
        <div class="order-confirmation__order-cost-summary order-confirmation__block"></div>
        <div class="order-confirmation__gift-options order-confirmation__block"></div>
        <div class="order-confirmation__order-product-list order-confirmation__block"></div>
        <div class="order-confirmation__booking-information order-confirmation__block"></div>
        <div class="order-confirmation__footer order-confirmation__block"></div>
      </div>
    </div>
  `);
}

function createOrderConfirmationFooter(supportPath) {
  return `
    <div class="order-confirmation-footer__continue-button"></div>
    <div class="order-confirmation-footer__contact-support">
      <p>
        Need help?
        <a
          href="${supportPath}"
          rel="noreferrer"
          class="order-confirmation-footer__contact-support-link"
          data-testid="order-confirmation-footer__contact-support-link"
        >
          Contact us
        </a>
      </p>
    </div>
  `;
}

async function hydrateBookingEventDetails(bookingSummaries = []) {
  const missingSummaries = bookingSummaries.filter((summary) => (
    summary?.sku && !summary.event
  ));
  if (!missingSummaries.length) return bookingSummaries;

  try {
    const productIndex = await loadEventProductIndex(CS_FETCH_GRAPHQL);
    const eventIdsBySku = new Map(missingSummaries.map((summary) => {
      const product = productIndex.get(summary.sku);
      return [summary.sku, getExternalEventId(product)];
    }).filter(([, eventId]) => eventId));
    const eventIds = [...new Set(eventIdsBySku.values())];
    if (!eventIds.length) return bookingSummaries;

    const eventsById = await createEventAppClient().enrich(eventIds);
    return bookingSummaries.map((summary) => {
      if (summary.event) return summary;
      const eventId = eventIdsBySku.get(summary.sku);
      const event = eventsById.get(eventId);
      return event ? { ...summary, event } : summary;
    });
  } catch {
    return bookingSummaries;
  }
}

// ----------------------------------------------------------------------------
// Local utility slots (swatch and modal)
// ----------------------------------------------------------------------------

function swatchImageSlot(ctx) {
  const { imageSwatchContext, defaultImageProps } = ctx;
  tryRenderAemAssetsImage(ctx, {
    alias: imageSwatchContext.label,
    imageProps: defaultImageProps,
    wrapper: document.createElement('span'),
    params: {
      width: defaultImageProps.width,
      height: defaultImageProps.height,
    },
  });
}

let signUpModal;

const handleAuthenticated = (authenticated) => {
  if (authenticated) {
    window.location.reload();
  }
};

// ----------------------------------------------------------------------------
// Local renderers (order confirmation only)
// ----------------------------------------------------------------------------

async function renderOrderHeader(container, options = {}) {
  const handleSignUpClick = async ({ inputsDefaultValueSet, addressesData }) => {
    const signUpForm = document.createElement('div');
    AuthProvider.render(SignUp, {
      inputsDefaultValueSet,
      addressesData,
      routeSignIn: () => rootLink('/customer/login'),
      routeRedirectOnEmailConfirmationClose: () => rootLink('/customer/account'),
      slots: { ...authPrivacyPolicyConsentSlot },
    })(signUpForm);
    signUpModal = await createModal([signUpForm]);
    signUpModal.showModal();
  };

  return OrderProvider.render(OrderHeader, {
    handleEmailAvailability: checkoutApi.isEmailAvailable,
    handleSignUpClick,
    ...options,
  })(container);
}

async function renderOrderStatus(container) {
  return OrderProvider.render(OrderStatus, { slots: { OrderActions: () => null } })(container);
}

async function renderShippingStatus(container) {
  return OrderProvider.render(ShippingStatus)(container);
}

async function renderCustomerDetails(container) {
  return OrderProvider.render(CustomerDetails)(container);
}

async function renderOrderCostSummary(container) {
  return OrderProvider.render(OrderCostSummary)(container);
}

async function renderOrderProductList(container) {
  return OrderProvider.render(OrderProductList, {
    slots: {
      Footer: (ctx) => {
        const giftOptions = document.createElement('div');
        CartProvider.render(GiftOptions, {
          item: ctx.item,
          view: 'product',
          dataSource: 'order',
          isEditable: false,
          slots: {
            SwatchImage: swatchImageSlot,
          },
        })(giftOptions);
        ctx.appendChild(giftOptions);
      },
      CartSummaryItemImage: (ctx) => {
        const { data, defaultImageProps } = ctx;
        tryRenderAemAssetsImage(ctx, {
          alias: data.product.sku,
          imageProps: defaultImageProps,
          params: {
            width: defaultImageProps.width,
            height: defaultImageProps.height,
          },
        });
      },
    },
  })(container);
}

function createBookingDetailIcon(label, labels) {
  let paths = ['M12 8v4l3 2', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'];
  if ([labels.date, labels.selectedDate, labels.schedule, labels.availableDates].includes(label)) {
    paths = ['M4 5h16v16H4Z', 'M8 3v4m8-4v4M4 10h16'];
  } else if (label === labels.location) {
    paths = ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z', 'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'];
  } else if (label === labels.venue) {
    paths = ['M4 21h16 M6 21V3h12v18 M9 7h2 M13 7h2 M9 11h2 M13 11h2 M10 21v-5h4v5'];
  } else if (label === labels.tickets) {
    paths = ['M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4Z', 'M15 6v3m0 2v2m0 2v3'];
  } else if (label === labels.organizer) {
    paths = ['M4 21h16 M6 21V3h12v18 M9 7h2 M13 7h2 M9 11h2 M13 11h2 M10 21v-5h4v5'];
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  paths.forEach((value) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', value);
    svg.append(path);
  });
  return svg;
}

function renderBookingInformation(
  container,
  {
    bookingSummaries = [],
    labels,
    orderData,
  } = {},
) {
  container.replaceChildren();
  if (!bookingSummaries.length) return;

  const bookingLabels = getCartBookingLabels(labels);
  const locale = document.documentElement.lang || 'en';
  const quantitiesBySku = new Map(
    (orderData?.items || [])
      .filter((item) => typeof item?.productSku === 'string')
      .map((item) => [item.productSku, item.totalQuantity]),
  );
  const section = document.createElement('section');
  section.className = 'order-confirmation__booking-information-content';
  const heading = document.createElement('h2');
  heading.textContent = labels.Global?.EventYourTicketsHeading || 'Your tickets';
  section.append(heading);

  bookingSummaries.forEach((summary) => {
    if (typeof summary?.sku !== 'string' || !summary.sku) return;
    const item = orderData?.items?.find((entry) => entry.productSku === summary.sku);
    const panel = renderCartBookingPanel({
      ...summary,
      quantity: quantitiesBySku.get(summary.sku) ?? summary.quantity,
    }, {
      labels: bookingLabels,
      locale,
      surface: 'confirmation',
    });
    const name = item?.productName || item?.product?.name;
    if (name) panel.querySelector('h3').textContent = name;
    const content = document.createElement('div');
    content.className = 'order-confirmation__ticket-content';
    content.append(...panel.childNodes);
    const thumbnail = document.createElement('div');
    thumbnail.className = 'order-confirmation__ticket-image';
    const imageUrl = item?.product?.thumbnail?.url || item?.product?.image;
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      thumbnail.append(image);
    }
    content.querySelectorAll('dt').forEach((term) => {
      const label = term.textContent;
      const accessibleLabel = document.createElement('span');
      accessibleLabel.className = 'order-confirmation__detail-label';
      accessibleLabel.textContent = label;
      term.replaceChildren(createBookingDetailIcon(label, bookingLabels), accessibleLabel);
    });
    panel.append(thumbnail, content);
    if (summary.event) {
      const calendar = createCalendarButton({ ...summary, name }, labels.Global?.EventAddToCalendarLabel || 'Add to calendar');
      if (calendar) {
        calendar.prepend(createBookingDetailIcon(bookingLabels.date, bookingLabels));
        content.append(calendar);
      }
    }
    section.append(panel);
  });

  if (section.children.length > 1) container.append(section);
}

async function renderOrderGiftOptions(container) {
  return CartProvider.render(GiftOptions, {
    view: 'order',
    dataSource: 'order',
    isEditable: false,
    readOnlyFormOrderView: 'secondary',
    slots: {
      SwatchImage: swatchImageSlot,
    },
  })(container);
}

async function renderOrderConfirmationFooterButton(container, eventOrder = false) {
  return UI.render(Button, {
    children: eventOrder ? 'Browse more events' : 'Continue shopping',
    'data-testid': 'order-confirmation-footer__continue-button',
    className: 'order-confirmation-footer__continue-button',
    size: 'medium',
    variant: 'primary',
    type: 'submit',
    href: rootLink(eventOrder ? '/events' : '/'),
  })(container);
}

async function renderCheckoutSuccessContent(
  container,
  {
    bookingSummaries: initialBookingSummaries = [],
    orderData,
  } = {},
) {
  const bookingSummaries = await hydrateBookingEventDetails(initialBookingSummaries);

  // Register event handler for authenticated event
  events.on('authenticated', handleAuthenticated);

  // Scroll to top on success view
  window.scrollTo(0, 0);

  // Create order confirmation layout using local fragments
  const orderConfirmationFragment = createOrderConfirmationFragment();

  // Scoped selector for the fragment
  const getOrderElement = createScopedSelector(orderConfirmationFragment);

  // Query all required elements using local selectors
  const $orderConfirmationHeader = getOrderElement(selectors.orderConfirmation.header);
  const $orderStatus = getOrderElement(selectors.orderConfirmation.orderStatus);
  const $shippingStatus = getOrderElement(selectors.orderConfirmation.shippingStatus);
  const $customerDetails = getOrderElement(selectors.orderConfirmation.customerDetails);
  const $orderCostSummary = getOrderElement(selectors.orderConfirmation.orderCostSummary);
  const $orderGiftOptions = getOrderElement(selectors.orderConfirmation.giftOptions);
  const $orderProductList = getOrderElement(selectors.orderConfirmation.orderProductList);
  const $bookingInformation = getOrderElement(selectors.orderConfirmation.bookingInformation);
  const $orderConfirmationFooter = getOrderElement(selectors.orderConfirmation.footer);

  container.replaceChildren(orderConfirmationFragment);

  // Mount order drop-in with localized placeholders (and optional order data)
  const labels = await fetchPlaceholders();
  const eventOrder = bookingSummaries.length > 0;
  container.classList.toggle('event-order-confirmation', eventOrder);
  const langDefinitions = { default: { ...labels } };
  const initOptions = orderData ? { langDefinitions, orderData } : { langDefinitions };
  await initializers.mountImmediately(orderApi.initialize, initOptions);

  // Render all order confirmation containers using local renderers
  await Promise.all([
    ...(!eventOrder ? [renderOrderHeader($orderConfirmationHeader, { orderData })] : []),
    ...(!eventOrder ? [renderOrderStatus($orderStatus)] : []),
    renderShippingStatus($shippingStatus),
    ...(!eventOrder ? [renderCustomerDetails($customerDetails)] : []),
    renderOrderCostSummary($orderCostSummary),
    ...(!eventOrder ? [renderOrderProductList($orderProductList)] : []),
    renderOrderGiftOptions($orderGiftOptions),
  ]);
  renderBookingInformation($bookingInformation, {
    bookingSummaries,
    labels,
    orderData,
  });
  if (eventOrder) {
    // Keep Commerce's order identifier, account offer, payment status and totals.
    // Public booking references and ticket delivery are separate contracts.
    const introduction = document.createElement('section');
    introduction.className = 'order-confirmation__event-introduction';
    const title = document.createElement('h1');
    const firstName = orderData?.billingAddress?.firstName?.trim();
    title.textContent = firstName ? `You're booked in, ${firstName}` : "You're booked in";
    const message = document.createElement('p');
    if (orderData?.email) {
      const email = document.createElement('strong');
      email.textContent = orderData.email;
      message.append('Your tickets are on their way to ', email, '.');
    } else {
      message.append('Your tickets are on their way.');
    }
    if (orderData?.number) {
      const orderNumber = document.createElement('strong');
      orderNumber.textContent = orderData.number;
      message.append(' Order ID ', orderNumber, '.');
    }
    introduction.append(title, message);
    $orderConfirmationHeader.closest('.order-confirmation__main').before(introduction);
    $orderConfirmationHeader.after($bookingInformation);
    const nextSteps = document.createElement('section');
    nextSteps.className = 'order-confirmation__next-steps';
    const heading = document.createElement('h2');
    heading.textContent = labels.Global?.EventNextStepsHeading || 'What happens next';
    const list = document.createElement('ol');
    [
      labels.Global?.EventNextStepEmail || "Your tickets arrive by email within a few minutes. Check your junk folder if you don't see them.",
      labels.Global?.EventNextStepTickets || 'Bring the tickets on your phone or printed. Each person needs their own ticket.',
    ].forEach((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    });
    const help = document.createElement('li');
    const findBooking = document.createElement('a');
    findBooking.href = rootLink(ORDER_STATUS_PATH);
    findBooking.textContent = 'Find my booking';
    help.append('Need to change or cancel something? Use your Order ID at ', findBooking, '.');
    list.append(help);
    nextSteps.append(heading, list);
    $orderStatus.after(nextSteps);
    const eventSkus = new Set(bookingSummaries.map((summary) => summary.sku));
    if (orderData?.items?.length
      && orderData.items.every((item) => eventSkus.has(item.productSku))) {
      $shippingStatus.hidden = true;
    }
  }

  // Footer content and continue button
  $orderConfirmationFooter.innerHTML = createOrderConfirmationFooter(rootLink(SUPPORT_PATH));
  const $continueBtn = $orderConfirmationFooter.querySelector(
    selectors.orderConfirmation.continueButton,
  );
  if (eventOrder) {
    $continueBtn.remove();
  } else {
    await renderOrderConfirmationFooterButton($continueBtn);
  }
}

export function preloadCheckoutSuccess() {
  return loadCSS(`${window.hlx.codeBasePath}/blocks/commerce-checkout-success/commerce-checkout-success.css`);
}

export async function renderCheckoutSuccess(
  container,
  {
    bookingSummaries = [],
    orderData,
  } = {},
) {
  saveCheckoutSuccess({ orderData, bookingSummaries });
  return renderCheckoutSuccessContent(container, {
    bookingSummaries,
    orderData,
  });
}

export default async function decorate(block) {
  await renderCheckoutSuccessContent(block, getCheckoutSuccess() || {});
}
