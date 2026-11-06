import { CHECKOUT_BLOCK } from './constants.js';

/**
 * A frozen, nested object of CSS selectors
 * @readonly
 */
export const selectors = Object.freeze({
  checkout: {
    content: '.checkout__content',
    loader: '.checkout__loader',
    mergedCartBanner: '.checkout__merged-cart-banner',
    heading: '.checkout__heading',
    serverError: '.checkout__server-error',
    outOfStock: '.checkout__out-of-stock',
    login: '.checkout__login',
    shippingForm: '.checkout__shipping-form',
    billToShipping: '.checkout__bill-to-shipping',
    delivery: '.checkout__delivery',
    paymentMethods: '.checkout__payment-methods',
    billingForm: '.checkout__billing-form',
    orderSummary: '.checkout__order-summary',
    cartSummary: '.checkout__cart-summary',
    placeOrder: '.checkout__place-order',
    giftOptions: '.checkout__gift-options',
    termsAndConditions: '.checkout__terms-and-conditions',
    main: '.checkout__main',
    aside: '.checkout__aside',
  },
});

// =============================================================================
// CHECKOUT
// =============================================================================

/**
 * Creates the main checkout fragment with all checkout blocks.
 * @returns {DocumentFragment} The complete checkout fragment.
 */
export function createCheckoutFragment() {
  const fragment = document.createDocumentFragment();
  const create = (className, parent, isBlock = false) => {
    const element = document.createElement('div');
    element.className = isBlock ? `${className} ${CHECKOUT_BLOCK}` : className;
    parent.append(element);
    return element;
  };
  const wrapper = create('checkout__wrapper', fragment);
  create('checkout__loader', wrapper);
  const content = create('checkout__content', wrapper);
  create('checkout__merged-cart-banner', content);
  create('checkout__heading', content, true);
  const main = create('checkout__main', content);
  [
    'server-error', 'out-of-stock', 'login', 'shipping-form',
    'bill-to-shipping', 'delivery', 'payment-methods', 'billing-form',
  ].forEach((name) => create(`checkout__${name}`, main, true));
  const aside = create('checkout__aside', content);
  const summary = create('checkout__summary-card', aside);
  create('checkout__order-summary', summary, true);
  create('checkout__place-order', summary, true);
  create('checkout__terms-and-conditions', summary, true);
  create('checkout__gift-options', aside, true);
  create('checkout__cart-summary', aside, true);
  return fragment;
}
