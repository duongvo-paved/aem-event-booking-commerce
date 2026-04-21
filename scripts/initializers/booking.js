import { events } from '@dropins/tools/event-bus.js';
import { initializeDropin, getUserTokenCookie } from './index.js';
import {
  initializeBookingEndpoint,
  setBookingAuthHeader,
} from '../booking.js';

await initializeDropin(async () => {
  // Initialize the booking API Mesh endpoint from site config
  await initializeBookingEndpoint();

  // Sync auth state to booking GraphQL instance
  const token = getUserTokenCookie();
  setBookingAuthHeader(!!token, token);

  events.on('authenticated', (authenticated) => {
    const currentToken = getUserTokenCookie();
    setBookingAuthHeader(authenticated, currentToken);
  }, { eager: true });
})();
