import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalendarContent } from '../../scripts/event-app/calendar.js';

const event = {
  eventId: 'public-event',
  startsAtUtc: '2026-09-12T07:00:00Z',
  endsAtUtc: '2026-09-12T12:00:00Z',
  venue: { name: 'Hall, Brisbane', address: '1 Main Street' },
};
const now = new Date('2026-09-01T00:00:00Z');

test('calendar escapes content, uses UTC and excludes unrelated booking data', () => {
  const content = createCalendarContent({
    event,
    name: 'Concert; music\nBEGIN:ATTENDEE',
    bookingRef: 'private-booking',
    attendees: [{ email: 'private@example.test' }],
  }, now);
  assert.match(content, /DTSTART:20260912T070000Z\r\n/);
  assert.match(content, /DTEND:20260912T120000Z\r\n/);
  assert.ok(content.includes('SUMMARY:Concert\\; music\\nBEGIN:ATTENDEE'));
  assert.ok(content.includes('LOCATION:Hall\\, Brisbane\\, 1 Main Street'));
  assert.doesNotMatch(content, /private-booking|private@example.test/);
});

test('recurring calendars require the selected occurrence and convert its timezone', () => {
  const recurring = { ...event, scheduleType: 'recurring' };
  assert.equal(createCalendarContent({ event: recurring, name: 'Session' }), null);
  const content = createCalendarContent({
    event: recurring,
    name: 'Session',
    occurrence: {
      localDate: '2026-09-15', startTime: '10:00', endTime: '11:30', timezone: 'Australia/Brisbane',
    },
  }, now);
  assert.match(content, /DTSTART:20260915T000000Z/);
  assert.match(content, /DTEND:20260915T013000Z/);
  assert.doesNotMatch(content, /20260912T/);
});

test('invalid, missing, ambiguous and nonexistent session times suppress calendars', () => {
  const recurring = { ...event, scheduleType: 'recurring' };
  [
    ['2026-03-08', '02:30', '03:30', 'America/New_York'],
    ['2026-11-01', '01:30', '02:30', 'America/New_York'],
    ['2026-02-30', '10:00', '11:00', 'Australia/Brisbane'],
    ['2026-09-15', '25:00', '26:00', 'Australia/Brisbane'],
    ['2026-09-15', '10:00', '11:00', 'Invalid/Timezone'],
  ].forEach(([localDate, startTime, endTime, timezone]) => {
    assert.equal(createCalendarContent({
      event: recurring,
      name: 'Session',
      occurrence: {
        localDate, startTime, endTime, timezone,
      },
    }), null);
  });
  assert.equal(createCalendarContent({ event: { ...event, endsAtUtc: null }, name: 'Event' }), null);
  assert.equal(createCalendarContent({ event: { ...event, endsAtUtc: event.startsAtUtc }, name: 'Event' }), null);
});

test('long unicode lines fold within 75 UTF-8 octets and unfold without corruption', () => {
  const name = '音楽 🎫 '.repeat(35);
  const content = createCalendarContent({ event, name }, now);
  content.split('\r\n').forEach((line) => assert.ok(Buffer.byteLength(line) <= 75));
  assert.ok(content.replace(/\r\n /g, '').includes(`SUMMARY:${name}`));
});
