/** Keep the installed region picker's label visible before a value is selected. */
export function observeAddressPickerLabels(container) {
  if (!container) return () => {};
  const update = () => {
    container.querySelectorAll('.checkout__region-label').forEach((label) => {
      if (!label.parentElement.querySelector('select[name="region"]')) label.remove();
    });
    container.querySelectorAll('select[name="region"]').forEach((select) => {
      const content = select.closest('.dropin-field__content');
      if (!content) return;
      let label = content.querySelector('.checkout__region-label');
      if (!label) {
        label = document.createElement('label');
        label.className = 'checkout__region-label';
        content.prepend(label);
      }
      const text = `${select.getAttribute('aria-label') || 'State/Province'}${select.required ? ' *' : ''}`;
      if (label.textContent !== text) label.textContent = text;
      if (label.htmlFor !== select.id) label.htmlFor = select.id;
      const placeholder = select.querySelector('option.dropin-picker__placeholder[value=""]');
      if (placeholder) {
        const emptyLabel = select.closest('.checkout__billing-form')
          ? 'State/Province'
          : '';
        if (placeholder.textContent !== emptyLabel) placeholder.textContent = emptyLabel;
      }
    });
  };
  const observer = new MutationObserver(update);
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['required', 'aria-label', 'id'],
  });
  update();
  return () => observer.disconnect();
}
