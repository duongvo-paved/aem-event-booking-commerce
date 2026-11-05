import { render as orderRenderer } from '@dropins/storefront-order/render.js';
import { OrderStatus } from '@dropins/storefront-order/containers/OrderStatus.js';
import {
  CREATE_RETURN_PATH,
  CUSTOMER_CREATE_RETURN_PATH,
  CUSTOMER_PATH,
  checkIsAuthenticated,
  fetchPlaceholders,
  rootLink,
} from '../../scripts/commerce.js';

// Initialize
import '../../scripts/initializers/order.js';

export default async function decorate(block) {
  const accountPath = new URL(rootLink(CUSTOMER_PATH), window.location.origin).pathname;
  const isAccountPage = window.location.pathname.startsWith(`${accountPath}/`);
  if (isAccountPage) {
    const labels = await fetchPlaceholders('placeholders/order.json');
    const actions = labels.Order?.OrderStatusContent?.actions;
    const returnLabels = [actions?.createReturn, actions?.createAnotherReturn].filter(Boolean);
    // Preserve cancellation and reorder: this version only exposes a slot for all actions.
    const removeReturnActions = () => {
      block.querySelectorAll('.order-order-actions button').forEach((button) => {
        if (returnLabels.includes(button.textContent.trim())) {
          button.hidden = true;
          button.style.display = 'none';
        }
      });
    };
    const observer = new MutationObserver(removeReturnActions);
    observer.observe(block, { childList: true, subtree: true });
  }
  await orderRenderer.render(OrderStatus, {
    routeCreateReturn: isAccountPage ? undefined : ({ token, number: orderNumber }) => {
      const isAuthenticated = checkIsAuthenticated();

      const { searchParams } = new URL(window.location.href);
      const orderRefFromUrl = searchParams.get('orderRef');
      const newOrderRef = isAuthenticated ? orderNumber : token;

      const encodedOrderRef = encodeURIComponent(orderRefFromUrl || newOrderRef);

      return checkIsAuthenticated() ? rootLink(`${CUSTOMER_CREATE_RETURN_PATH}?orderRef=${encodedOrderRef}`) : rootLink(`${CREATE_RETURN_PATH}?orderRef=${encodedOrderRef}`);
    },
    routeOnSuccess: () => rootLink('/cart'),
  })(block);
}
