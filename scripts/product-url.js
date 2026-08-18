/**
 * Encodes a Commerce SKU for use as a single URL path segment without
 * normalizing the SKU's value.
 * @param {string} sku Commerce SKU
 * @returns {string} Encoded SKU path segment
 */
export function encodeProductSku(sku) {
  return encodeURIComponent(sku);
}

/**
 * Decodes a Commerce SKU read from a URL path segment.
 * @param {string} value Encoded SKU path segment
 * @returns {string} Original SKU, or the raw segment if malformed
 */
export function decodeProductSku(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
