import { getCookie } from '@dropins/tools/lib.js';
import * as authApi from '@dropins/storefront-auth/api.js';
import { render as authRenderer } from '@dropins/storefront-auth/render.js';
import { SignIn } from '@dropins/storefront-auth/containers/SignIn.js';
import {
  CUSTOMER_CREATE_ACCOUNT_PATH,
  CUSTOMER_FORGOTPASSWORD_PATH,
  rootLink,
} from '../../scripts/commerce.js';

function handleLogout(redirections) {
  const shouldRedirect = Object.entries(redirections).some(([currentPath, redirectPath]) => {
    if (window.location.pathname.includes(currentPath)) {
      window.location.href = redirectPath;
      return true;
    }
    return false;
  });

  if (!shouldRedirect) {
    // reload the page if no redirect occurred
    window.location.reload();
  }
}

function renderSignIn(element) {
  authRenderer.render(SignIn, {
    onSuccessCallback: () => {
      // reload the page
      window.location.reload();
    },
    formSize: 'small',
    renderSignUpLink: true,
    routeForgotPassword: () => rootLink(CUSTOMER_FORGOTPASSWORD_PATH),
    routeSignUp: () => rootLink(CUSTOMER_CREATE_ACCOUNT_PATH),
  })(element);
}

export function renderAuthDropdown(navTools) {
  const dropdownElement = document.createRange().createContextualFragment(`
 <div class="dropdown-wrapper nav-tools-wrapper">
    <button type="button" class="nav-dropdown-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="login-modal"></button>
    <div class="nav-auth-menu-panel nav-tools-panel">
      <div id="auth-dropin-container"></div>
      <ul class="authenticated-user-menu">
         <li><a href="${rootLink('/customer/account')}">My Account</a></li>
          <li><button>Logout</button></li>
      </ul>
    </div>
 </div>`);

  navTools.append(dropdownElement);

  const authDropDownPanel = navTools.querySelector('.nav-auth-menu-panel');
  const authDropDownMenuList = navTools.querySelector(
    '.authenticated-user-menu',
  );
  const authDropinContainer = navTools.querySelector('#auth-dropin-container');
  const loginButton = navTools.querySelector('.nav-dropdown-button');
  const dropdownWrapper = loginButton.closest('.dropdown-wrapper');
  const accountLink = authDropDownMenuList.querySelector('a');
  accountLink.textContent = 'My account';
  const logoutButtonElement = navTools.querySelector(
    '.authenticated-user-menu > li > button',
  );
  logoutButtonElement.textContent = 'Log out';
  logoutButtonElement.type = 'button';

  authDropDownPanel.addEventListener('click', (e) => e.stopPropagation());

  async function toggleDropDownAuthMenu(state) {
    const show = state ?? !authDropDownPanel.classList.contains('nav-tools-panel--show');

    authDropDownPanel.classList.toggle('nav-tools-panel--show', show);
    loginButton.setAttribute('aria-expanded', String(show));
    authDropDownPanel.setAttribute('role', 'dialog');
    authDropDownPanel.id = 'login-modal';
    authDropDownPanel.setAttribute('aria-hidden', String(!show));
    authDropDownPanel.setAttribute('aria-label', 'Account');
    if (show && dropdownWrapper.classList.contains('nav-authenticated')) accountLink.focus();
  }

  loginButton.addEventListener('click', () => toggleDropDownAuthMenu());
  dropdownWrapper.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && loginButton.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      toggleDropDownAuthMenu(false);
      loginButton.focus();
    }
  });
  document.addEventListener('click', async (e) => {
    const clickOnDropDownPanel = authDropDownPanel.contains(e.target);
    const clickOnLoginButton = loginButton.contains(e.target);

    if (!clickOnDropDownPanel && !clickOnLoginButton) {
      await toggleDropDownAuthMenu(false);
    }
  });

  logoutButtonElement.addEventListener('click', async () => {
    await authApi.revokeCustomerToken();
    handleLogout({
      '/checkout': rootLink('/cart'),
      '/customer': rootLink('/customer/login'),
      '/order-details': rootLink('/'),
    });
  });

  renderSignIn(authDropinContainer);

  const updateDropDownUI = (isAuthenticated) => {
    const getUserTokenCookie = getCookie('auth_dropin_user_token');
    const getUserNameCookie = getCookie('auth_dropin_firstname');

    if (isAuthenticated || getUserTokenCookie) {
      dropdownWrapper.classList.add('nav-authenticated');
      authDropDownMenuList.style.display = 'block';
      authDropinContainer.style.display = 'none';
      loginButton.textContent = `Hi, ${getUserNameCookie}`;
      const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('viewBox', '0 0 24 24');
      chevron.setAttribute('aria-hidden', 'true');
      chevron.classList.add('nav-account-chevron');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M6 9.5l6 6 6-6');
      chevron.append(path);
      loginButton.append(chevron);
    } else {
      dropdownWrapper.classList.remove('nav-authenticated');
      authDropDownMenuList.style.display = 'none';
      authDropinContainer.style.display = 'block';
      loginButton.innerHTML = `
      <svg
          width="25"
          height="25"
          viewBox="0 0 24 24"
          aria-label="My Account"
          >
          <g fill="none" stroke="#000000" stroke-width="1.5">
          <circle cx="12" cy="6" r="4"></circle>
          <path d="M20 17.5c0 2.485 0 4.5-8 4.5s-8-2.015-8-4.5S7.582 13 12 13s8 2.015 8 4.5Z"></path></g></svg>
        `;
    }
  };

  updateDropDownUI();
}
