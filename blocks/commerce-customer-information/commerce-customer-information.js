import CustomerInformation from '@dropins/storefront-account/containers/CustomerInformation.js';
import { render as accountRenderer } from '@dropins/storefront-account/render.js';
import {
  CUSTOMER_LOGIN_PATH,
  checkIsAuthenticated,
  rootLink,
} from '../../scripts/commerce.js';
import { createAccountLoadingPlaceholder, markAccountLoading } from '../../scripts/account-loading.js';

// Initialize
import '../../scripts/initializers/account.js';

export function renderCustomerData(ctx) {
  const details = document.createElement('div');
  details.className = 'my-details__identity';
  const name = document.createElement('p');
  name.className = 'my-details__name';
  const email = document.createElement('p');
  email.className = 'my-details__email';
  details.append(name, email);
  const update = ({ customerData = [] }) => {
    const values = new Map(customerData.map((field) => [
      field.name.replace(/_/g, '').toLowerCase(), String(field.value ?? '').trim(),
    ]));
    name.textContent = ['firstname', 'middlename', 'lastname']
      .map((key) => values.get(key)).filter(Boolean).join(' ');
    email.textContent = values.get('email') || '';
    name.hidden = !name.textContent;
    email.hidden = !email.textContent;
  };
  update(ctx);
  ctx.replaceWith(details);
  ctx.onChange(update);
}

export default async function decorate(block) {
  if (!checkIsAuthenticated()) {
    window.location.href = rootLink(CUSTOMER_LOGIN_PATH);
  } else {
    const heading = document.createElement('h2');
    heading.className = 'my-details__heading';
    heading.textContent = 'My details';
    const container = document.createElement('div');
    const earlyPlaceholder = block.querySelector(':scope > .account-loading-placeholder');
    block.replaceChildren(heading, container);
    if (earlyPlaceholder) container.append(earlyPlaceholder);
    const stopLoading = markAccountLoading(
      container,
      createAccountLoadingPlaceholder({ card: true, rows: 2 }),
    );
    try {
      await accountRenderer.render(CustomerInformation, {
        withHeader: false,
        slots: { CustomerData: renderCustomerData },
      })(container);
    } finally {
      stopLoading();
    }
  }
}
