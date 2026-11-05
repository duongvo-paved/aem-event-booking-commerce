// Local development only: retain the latest confirmation for this browser tab.
const STORAGE_KEY = 'checkout-success-dev';

function isLocalDevelopment() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

export function saveCheckoutSuccess({ orderData, bookingSummaries }) {
  if (!isLocalDevelopment() || !orderData) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      url: window.location.pathname + window.location.search,
      orderData,
      bookingSummaries,
    }));
  } catch {
    // Storage restrictions must not interrupt a successful checkout.
  }
}

export function getCheckoutSuccess() {
  if (!isLocalDevelopment()) return null;
  try {
    const snapshot = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    const url = window.location.pathname + window.location.search;
    return snapshot?.url === url && snapshot.orderData ? snapshot : null;
  } catch {
    return null;
  }
}
