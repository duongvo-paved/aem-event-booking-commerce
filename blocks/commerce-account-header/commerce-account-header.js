import { readBlockConfig } from '../../scripts/aem.js';

export default function decorate(block) {
  const {
    title = 'My account',
  } = readBlockConfig(block);

  const heading = document.createElement('h1');
  heading.textContent = title;
  block.replaceChildren(heading);

  const main = block.closest('main');
  const wrapper = block.closest('.commerce-account-header-wrapper');
  if (main && wrapper) {
    main.classList.add('account-page');
    let titleSection = main.querySelector(':scope > .account-page-title');
    if (!titleSection) {
      titleSection = document.createElement('div');
      titleSection.classList.add('section', 'account-page-title');
      titleSection.dataset.sectionStatus = 'loaded';
      main.prepend(titleSection);
    }
    titleSection.append(wrapper);
  }
}
