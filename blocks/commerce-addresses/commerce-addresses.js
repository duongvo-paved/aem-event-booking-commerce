import { Addresses } from '@dropins/storefront-account/containers/Addresses.js';
import { render as accountRenderer } from '@dropins/storefront-account/render.js';
import { readBlockConfig } from '../../scripts/aem.js';
import { ensureAccountHeading } from '../../scripts/account-heading.js';
import { createAccountLoadingPlaceholder, markAccountLoading } from '../../scripts/account-loading.js';
import {
  CUSTOMER_ADDRESS_PATH,
  CUSTOMER_LOGIN_PATH,
  checkIsAuthenticated,
  rootLink,
} from '../../scripts/commerce.js';

// Initialize
import '../../scripts/initializers/account.js';

export default async function decorate(block) {
  const {
    'minified-view': minifiedViewConfig = 'false',
  } = readBlockConfig(block);

  if (!checkIsAuthenticated()) {
    window.location.href = rootLink(CUSTOMER_LOGIN_PATH);
  } else {
    const stopLoading = markAccountLoading(
      block,
      createAccountLoadingPlaceholder({ card: true, rows: 3 }),
    );
    try {
      const heading = minifiedViewConfig === 'true'
        ? null : await ensureAccountHeading(block, 'Addresses');
      await accountRenderer.render(Addresses, {
        withHeader: !heading,
        minifiedView: minifiedViewConfig === 'true',
        withActionsInMinifiedView: false,
        withActionsInFullSizeView: true,
        routeAddressesPage: () => rootLink(CUSTOMER_ADDRESS_PATH),
      })(block);
    } finally {
      stopLoading();
    }
  }
}
