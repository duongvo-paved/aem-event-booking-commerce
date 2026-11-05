/** Adapt the installed order drop-in model to the shared account summary model. */
export function toAccountOrder(order, locale = 'en') {
  const date = new Date(order.orderDate);
  const orderDate = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(date) : '';
  return {
    number: order.number,
    status: order.status,
    orderDate,
    total: { grandTotal: order.grandTotal },
    items: (order.items || []).map((item) => ({
      id: item.id,
      sku: item.productSku || item.product?.sku,
      topLevelSku: item.product?.sku,
      productName: item.productName || item.product?.name || 'Product unavailable',
      quantityOrdered: item.quantityOrdered,
      product: {
        smallImage: {
          url: item.thumbnail?.url || item.product?.thumbnail?.url || item.product?.image || '',
        },
      },
      lineDetails: item,
    })),
  };
}
