import assert from 'node:assert/strict';
import test from 'node:test';

import { formatEventCardDate, formatEventDateRange, formatEventHeadlineDate } from '../../scripts/event-app/dates.js';

test('card dates match the prototype single-day format in the event timezone', () => {
  assert.equal(formatEventCardDate({
    startsAtUtc: '2026-09-07T23:30:00Z',
    endsAtUtc: '2026-09-08T00:00:00Z',
    timezone: 'Australia/Brisbane',
  }), 'Tue 8 Sep, 9:30am – 10:00am');
});

test('card dates show a date-only range across local days', () => {
  assert.equal(formatEventCardDate({
    startsAtUtc: '2026-09-15T00:00:00Z',
    endsAtUtc: '2026-09-26T07:00:00Z',
    timezone: 'Australia/Brisbane',
  }), 'Tue 15 Sep – Sat 26 Sep');
});

test('UTC midnight does not split a single local-day event', () => {
  assert.equal(formatEventCardDate({
    startsAtUtc: '2026-09-11T23:00:00Z',
    endsAtUtc: '2026-09-12T07:00:00Z',
    timezone: 'Australia/Brisbane',
  }), 'Sat 12 Sep, 9:00am – 5:00pm');
});

test('card dates use the daylight-saving offset of the event timezone', () => {
  assert.equal(formatEventCardDate({
    startsAtUtc: '2026-10-04T00:00:00Z',
    endsAtUtc: '2026-10-04T02:00:00Z',
    timezone: 'Australia/Sydney',
  }), 'Sun 4 Oct, 11:00am – 1:00pm');
});

test('recurring card dates use calendar bounds without UTC timestamps or timezone shifts', () => {
  assert.equal(formatEventCardDate({
    scheduleType: 'recurring',
    timezone: 'America/Los_Angeles',
    recurrence: { startDate: '2026-09-15', endDate: '2026-09-26' },
  }), 'Tue 15 Sep – Sat 26 Sep');
});

test('card date ranges distinguish different years', () => {
  assert.equal(formatEventCardDate({
    startsAtUtc: '2026-12-31T00:00:00Z',
    endsAtUtc: '2027-01-01T07:00:00Z',
    timezone: 'Australia/Brisbane',
  }), 'Thu 31 Dec 2026 – Fri 1 Jan 2027');
});

test('card dates handle an absent end or schedule', () => {
  assert.equal(formatEventCardDate({
    startsAtUtc: '2026-09-12T07:00:00Z', timezone: 'Australia/Brisbane',
  }), 'Sat 12 Sep, 5:00pm');
  assert.equal(formatEventCardDate({}), '');
});

test('formats the event range in the supplied event timezone', () => {
  const formatted = formatEventDateRange({
    endsAtUtc: '2026-08-01T04:00:00.000Z',
    startsAtUtc: '2026-08-01T02:00:00.000Z',
    timezone: 'Australia/Sydney',
  }, 'en-AU');

  assert.match(formatted, /1 Aug 2026/);
  assert.match(formatted, /12:00/);
  assert.match(formatted, /2:00/);
});

test('PDP facts match the prototype and collapse a repeated local date', () => {
  assert.equal(formatEventHeadlineDate({
    startsAtUtc: '2026-09-12T07:00:00Z',
    endsAtUtc: '2026-09-12T12:00:00Z',
    timezone: 'Australia/Brisbane',
  }), 'Saturday 12 September 2026, 5:00pm – 10:00pm');
});

test('PDP recurring facts preserve calendar bounds and local hours across DST', () => {
  assert.equal(formatEventHeadlineDate({
    scheduleType: 'recurring',
    timezone: 'Australia/Sydney',
    recurrence: {
      startDate: '2026-09-15',
      endDate: '2026-12-31',
      dailyStartTime: '09:00',
      dailyEndTime: '18:00',
    },
  }), 'Tuesday 15 September 2026 – Thursday 31 December 2026, 9:00am – 6:00pm');
});

test('PDP facts retain distinct dates for overnight events and respect DST', () => {
  assert.equal(formatEventHeadlineDate({
    startsAtUtc: '2026-10-03T13:00:00Z',
    endsAtUtc: '2026-10-04T02:00:00Z',
    timezone: 'Australia/Sydney',
  }), 'Saturday 3 October 2026, 11:00pm – Sunday 4 October 2026, 1:00pm');
});

test('PDP facts handle missing end dates and absent schedules', () => {
  assert.equal(formatEventHeadlineDate({}), '');
  assert.equal(formatEventHeadlineDate({
    startsAtUtc: '2026-09-12T07:00:00Z', timezone: 'Australia/Brisbane',
  }), 'Saturday 12 September 2026, 5:00pm');
});
