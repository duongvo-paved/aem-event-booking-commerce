export function createAccountLoadingPlaceholder({ card = false, rows = 3 } = {}) {
  const placeholder = document.createElement('div');
  placeholder.className = `account-loading-placeholder${card ? ' account-loading-placeholder--card' : ''}`;
  placeholder.setAttribute('role', 'status');
  placeholder.setAttribute('aria-label', 'Loading account information');
  placeholder.setAttribute('aria-hidden', 'true');

  for (let index = 0; index < rows; index += 1) {
    const row = document.createElement('div');
    row.className = 'account-loading-placeholder__row';
    if (index === 0 && card) {
      const image = document.createElement('span');
      image.className = 'account-loading-placeholder__image';
      row.append(image);
    }
    const lines = document.createElement('span');
    lines.className = 'account-loading-placeholder__lines';
    const primary = document.createElement('span');
    primary.className = 'account-loading-placeholder__line';
    const secondary = document.createElement('span');
    secondary.className = 'account-loading-placeholder__line account-loading-placeholder__line--short';
    lines.append(primary, secondary);
    row.append(lines);
    placeholder.append(row);
  }
  return placeholder;
}

export function markAccountLoading(container, placeholder) {
  const existing = container.querySelector(':scope > .account-loading-placeholder');
  const activePlaceholder = existing || placeholder;
  container.setAttribute('aria-busy', 'true');
  if (!existing) container.append(activePlaceholder);
  return () => {
    activePlaceholder.remove();
    container.removeAttribute('aria-busy');
  };
}

export function prepareAccountLoadingPlaceholders(main) {
  if (!window.location.pathname.includes('/customer/')) return;
  main.querySelectorAll('.commerce-account-sidebar, .commerce-customer-information, .commerce-orders-list, .commerce-addresses').forEach((block) => {
    if (block.querySelector(':scope > .account-loading-placeholder')) return;
    const isSidebar = block.classList.contains('commerce-account-sidebar');
    const isDetails = block.classList.contains('commerce-customer-information');
    let rows = 3;
    if (isSidebar) rows = 4;
    else if (isDetails) rows = 2;
    const placeholder = createAccountLoadingPlaceholder({
      card: !isSidebar,
      rows,
    });
    block.setAttribute('aria-busy', 'true');
    block.append(placeholder);
  });
}
