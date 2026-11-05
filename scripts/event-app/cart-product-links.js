import { isEventProduct } from './models.js';

const indexes = new WeakMap();
const PARENT_PRODUCTS_QUERY = `
  query CartEventParents($page: Int!) {
    productSearch(phrase: "", page_size: 100, current_page: $page) {
      page_info { total_pages }
      items {
        productView {
          sku
          urlKey
          attributes { name value }
          ... on ComplexProductView {
            options {
              values {
                ... on ProductViewOptionValueProduct {
                  product { sku }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function loadParentIndex(catalog) {
  if (indexes.has(catalog)) return indexes.get(catalog);
  const request = (async () => {
    const parents = new Map();
    let page = 1;
    let totalPages = 1;
    do {
      // The response determines how many catalog pages need to be read.
      // eslint-disable-next-line no-await-in-loop
      const { data, errors } = await catalog.fetchGraphQl(PARENT_PRODUCTS_QUERY, {
        variables: { page },
      });
      if (errors?.length || !data?.productSearch) {
        throw new Error('Event parent products are unavailable');
      }
      const result = data.productSearch;
      totalPages = result.page_info?.total_pages || 1;
      result.items.forEach(({ productView: product }) => {
        if (!product?.sku || !product.urlKey || !isEventProduct(product)) return;
        product.options?.forEach((option) => option.values?.forEach((value) => {
          const sku = value.product?.sku;
          if (sku && !parents.has(sku)) parents.set(sku, product);
        }));
      });
      page += 1;
    } while (page <= totalPages);
    return parents;
  })();
  indexes.set(catalog, request);
  request.catch(() => indexes.delete(catalog));
  return request;
}

export function createCartProductLinkResolver({ catalog, getProductLink }) {
  let parents = new Map();

  function routeProduct(item) {
    const parent = parents.get(item.sku);
    return parent
      ? getProductLink(parent.urlKey, parent.sku)
      : getProductLink(item.url?.urlKey, item.topLevelSku || item.sku);
  }

  async function bind(anchor, item) {
    if (isEventProduct({ attributes: item.productAttributes })) {
      // Keep unresolved event links inert rather than briefly linking to a child PDP.
      anchor.setAttribute('aria-busy', 'true');
      try {
        parents = await loadParentIndex(catalog);
      } catch {
        // Standalone events and unavailable catalog lookups retain their normal route.
      }
      anchor.removeAttribute('aria-busy');
    }
    anchor.href = routeProduct(item);
  }

  return Object.freeze({ bind, routeProduct });
}
