import {
  CUSTOMER_PATH,
  CUSTOMER_RETURNS_PATH,
  CUSTOMER_CREATE_RETURN_PATH,
  CUSTOMER_RETURN_DETAILS_PATH,
  CUSTOMER_ORDERS_PATH,
  rootLink,
} from './commerce.js';

const returnPaths = [
  CUSTOMER_RETURNS_PATH,
  CUSTOMER_CREATE_RETURN_PATH,
  CUSTOMER_RETURN_DETAILS_PATH,
];

export function isAccountReturnLink(link) {
  const pathname = new URL(link, window.location.origin).pathname.replace(/\/$/, '');
  return returnPaths.some((path) => (
    pathname === new URL(rootLink(path), window.location.origin).pathname
  ));
}

export function removeAccountReturns(main) {
  const accountPath = new URL(rootLink(CUSTOMER_PATH), window.location.origin).pathname;
  if (!window.location.pathname.startsWith(`${accountPath}/`)) return;

  if (isAccountReturnLink(window.location.href)) {
    window.location.replace(rootLink(CUSTOMER_ORDERS_PATH));
    return;
  }

  main.querySelectorAll('.commerce-returns-list, .commerce-order-returns, .commerce-create-return, .commerce-return-header').forEach((block) => block.remove());
}
