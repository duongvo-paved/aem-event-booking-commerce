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
  fetchPlaceholders,
  rootLink,
  SUPPORT_PATH,
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
  heading.textContent = bookingLabels.heading;
  section.append(heading);

  bookingSummaries.forEach((summary) => {
    if (typeof summary?.sku !== 'string' || !summary.sku) return;
    section.append(renderCartBookingPanel({
      ...summary,
      quantity: quantitiesBySku.get(summary.sku) ?? summary.quantity,
    }, {
      labels: bookingLabels,
      locale,
      surface: 'confirmation',
    }));
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

async function renderOrderConfirmationFooterButton(container) {
  return UI.render(Button, {
    children: 'Continue shopping',
    'data-testid': 'order-confirmation-footer__continue-button',
    className: 'order-confirmation-footer__continue-button',
    size: 'medium',
    variant: 'primary',
    type: 'submit',
    href: rootLink('/'),
  })(container);
}

async function renderCheckoutSuccessContent(
  container,
  {
    bookingSummaries = [],
    orderData,
  } = {},
) {
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
  const langDefinitions = { default: { ...labels } };
  const initOptions = orderData ? { langDefinitions, orderData } : { langDefinitions };
  await initializers.mountImmediately(orderApi.initialize, initOptions);

  // Render all order confirmation containers using local renderers
  await Promise.all([
    renderOrderHeader($orderConfirmationHeader, { orderData }),
    renderOrderStatus($orderStatus),
    renderShippingStatus($shippingStatus),
    renderCustomerDetails($customerDetails),
    renderOrderCostSummary($orderCostSummary),
    renderOrderProductList($orderProductList),
    renderOrderGiftOptions($orderGiftOptions),
  ]);
  renderBookingInformation($bookingInformation, {
    bookingSummaries,
    labels,
    orderData,
  });

  // Footer content and continue button
  $orderConfirmationFooter.innerHTML = createOrderConfirmationFooter(rootLink(SUPPORT_PATH));
  const $continueBtn = $orderConfirmationFooter.querySelector(
    selectors.orderConfirmation.continueButton,
  );
  await renderOrderConfirmationFooterButton($continueBtn);
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
  return renderCheckoutSuccessContent(container, {
    bookingSummaries,
    orderData,
  });
}

export default async function decorate(block) {
  await renderCheckoutSuccessContent(block);
}
