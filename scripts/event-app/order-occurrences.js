import { CORE_FETCH_GRAPHQL } from '../commerce.js';

const OCCURRENCE_ATTRIBUTE_CODES = Object.freeze({
  date: 'event_occurrence_date',
  endTime: 'event_occurrence_end_time',
  id: 'event_occurrence_id',
  startTime: 'event_occurrence_start_time',
  timezone: 'event_occurrence_timezone',
});

const CUSTOMER_ORDER_OCCURRENCES_QUERY = `
  query CUSTOMER_ORDER_OCCURRENCES($orderNumbers: [String!]!) {
    customer {
      orders(filter: { number: { in: $orderNumbers } }) {
        items {
          number
          items {
            id
            custom_attributes {
              attribute_code
              value
            }
          }
        }
      }
    }
  }
`;

function readOccurrence(attributes = []) {
  const values = new Map(attributes.map(({ attribute_code: code, value }) => [code, value]));
  const occurrence = {
    occurrenceId: values.get(OCCURRENCE_ATTRIBUTE_CODES.id),
    localDate: values.get(OCCURRENCE_ATTRIBUTE_CODES.date),
    startTime: values.get(OCCURRENCE_ATTRIBUTE_CODES.startTime),
    endTime: values.get(OCCURRENCE_ATTRIBUTE_CODES.endTime),
    timezone: values.get(OCCURRENCE_ATTRIBUTE_CODES.timezone),
  };
  return Object.values(occurrence).every((value) => typeof value === 'string' && value.trim())
    ? occurrence : null;
}

export async function loadOrderOccurrences(orderNumbers, fetchGraphQl = CORE_FETCH_GRAPHQL) {
  const numbers = [...new Set(orderNumbers.filter((number) => typeof number === 'string' && number))];
  if (!numbers.length) return new Map();

  const result = await fetchGraphQl.fetchGraphQl(CUSTOMER_ORDER_OCCURRENCES_QUERY, {
    method: 'POST',
    cache: 'no-cache',
    variables: { orderNumbers: numbers },
  });
  if (result.errors?.length) throw new Error('Unable to load booking occurrence details');

  const occurrences = new Map();
  result.data?.customer?.orders?.items?.forEach((order) => {
    order.items?.forEach((item) => {
      const occurrence = readOccurrence(item.custom_attributes);
      if (occurrence) occurrences.set(`${order.number}:${item.id}`, occurrence);
    });
  });
  return occurrences;
}
