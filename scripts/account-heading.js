import { buildBlock, decorateBlock, loadBlock } from './aem.js';

/** Reuse the account title block above the sidebar and page content. */
export async function ensureAccountHeading(block, title) {
  const main = block.closest('main');
  if (!main) return null;
  let header = main.querySelector('.commerce-account-header');
  if (!header) {
    header = buildBlock('commerce-account-header', [['Title', title]]);
    const wrapper = document.createElement('div');
    wrapper.className = 'commerce-account-header-wrapper';
    wrapper.append(header);
    (block.closest('.section') || main).prepend(wrapper);
    decorateBlock(header);
  }
  await loadBlock(header);
  return header.querySelector('h1');
}
