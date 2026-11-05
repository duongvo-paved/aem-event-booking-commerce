function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function calendarToday(timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sessionKey(occurrence) {
  return `${occurrence.startsAtUtc}|${occurrence.endsAtUtc}`;
}

/** Session choices span all spaces; occurrence identity remains allocation-specific. */
export default function createSessionSelector({
  event, labels, onDateChange, onChange,
}) {
  const label = (key, fallback) => labels.Global?.[key] || fallback;
  const fieldset = element('fieldset', 'event-booking__occurrences');
  const legend = element('legend', '', label('EventOccurrenceHeading', 'Choose a date and time'));
  const date = document.createElement('input');
  date.type = 'date';
  date.id = 'event-occurrence-date';
  date.name = 'occurrence-date';
  date.required = true;
  date.min = [event.recurrence.startDate, calendarToday(event.timezone)].sort().at(-1);
  date.max = event.recurrence.endDate;
  const time = document.createElement('select');
  time.id = 'event-occurrence-time';
  time.name = 'occurrence-time';
  time.required = true;
  const status = element('p', 'event-booking__occurrence-availability');
  status.id = 'event-session-availability';
  status.setAttribute('role', 'status');
  date.setAttribute('aria-describedby', status.id);
  time.setAttribute('aria-describedby', status.id);
  const retry = element(
    'button',
    'event-booking__availability-retry',
    label('EventAvailabilityRetryLabel', 'Retry loading times'),
  );
  retry.type = 'button';
  retry.hidden = true;
  [[date, 'EventOccurrenceDateLabel', 'Date'], [time, 'EventOccurrenceTimeLabel', 'Start time']]
    .forEach(([control, key, fallback]) => {
      const wrapper = element('div', 'event-booking__occurrence-field');
      const caption = document.createElement('label');
      caption.htmlFor = control.id;
      caption.textContent = label(key, fallback);
      wrapper.append(caption, control);
      fieldset.append(wrapper);
    });
  fieldset.prepend(legend);
  fieldset.append(status, retry);

  let allocations = [];
  let sessions = [];
  let selected = null;
  let state = 'idle';

  const availableOccurrences = (allocation) => (allocation.occurrences || [])
    .filter((occurrence) => (
      occurrence.localDate === date.value && occurrence.availableQuantity > 0
      && Date.parse(occurrence.startsAtUtc) > Date.now()
    ));

  function placeholder(text) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = text;
    time.replaceChildren(option);
    time.disabled = true;
  }

  function renderState() {
    fieldset.setAttribute('aria-busy', String(state === 'loading'));
    retry.hidden = state !== 'error';
    if (state === 'loading') {
      time.disabled = true;
      status.textContent = label('EventAvailabilityLoadingLabel', 'Loading available times…');
    } else if (state === 'error') {
      placeholder(label('EventTimesUnavailable', 'Times unavailable'));
      status.textContent = label('EventAvailabilityErrorLabel', 'Availability could not be loaded.');
    } else if (state === 'idle') {
      placeholder(label('EventChooseDateFirst', 'Choose a date first'));
      status.textContent = label('EventChooseDatePrompt', 'Choose a date to load available times.');
    } else if (!sessions.length) {
      placeholder(label('EventNoAvailableTimes', 'No available times'));
      status.textContent = label(
        'EventNoSessionsOnDate',
        'No available sessions on this date. Choose another date.',
      );
    } else {
      status.textContent = selected
        ? label('EventChooseSpacePrompt', 'Choose an available space.')
        : label('EventChooseTimePrompt', 'Choose a start time to see available spaces.');
    }
  }

  function clearSelection() {
    allocations = [];
    sessions = [];
    selected = null;
  }

  date.addEventListener('change', () => {
    clearSelection();
    const day = new Date(`${date.value}T12:00:00Z`);
    const valid = date.value && date.value >= date.min && date.value <= date.max
      && event.recurrence.weekdays.includes(day.getUTCDay() || 7)
      && !event.recurrence.excludedDates.includes(date.value);
    state = valid ? 'loading' : 'idle';
    date.setAttribute('aria-invalid', String(Boolean(date.value) && !valid));
    renderState();
    if (date.value && !valid) {
      status.textContent = label(
        'EventDateNotScheduled',
        'Choose a scheduled date within the event’s available date range.',
      );
    }
    onChange(null);
    onDateChange(valid ? date.value : '');
  });
  time.addEventListener('change', () => {
    selected = sessions.find((session) => session.key === time.value) || null;
    renderState();
    onChange(selected);
  });
  retry.addEventListener('click', () => onDateChange(date.value));
  if (date.min > date.max) {
    date.disabled = true;
    state = 'ready';
  }
  renderState();

  return Object.freeze({
    fieldset,
    getDate: () => date.value,
    getSelected: () => selected,
    getOccurrence(allocation) {
      if (!selected) return null;
      const entry = allocations.find((candidate) => (
        candidate.eventAllocationId === allocation?.eventAllocationId
      ));
      return entry ? availableOccurrences(entry)
        .find((occurrence) => sessionKey(occurrence) === selected.key) || null : null;
    },
    setAvailabilityState(nextState) {
      clearSelection();
      state = nextState;
      renderState();
    },
    setAvailability(availabilityEvent) {
      allocations = availabilityEvent.allocations;
      const unique = new Map();
      allocations.flatMap(availableOccurrences).forEach((occurrence) => {
        const {
          localDate, startTime, endTime, timezone, startsAtUtc, endsAtUtc,
        } = occurrence;
        const key = sessionKey(occurrence);
        unique.set(key, {
          key, localDate, startTime, endTime, timezone, startsAtUtc, endsAtUtc,
        });
      });
      sessions = [...unique.values()].sort((first, second) => (
        Date.parse(first.startsAtUtc) - Date.parse(second.startsAtUtc)
          || Date.parse(first.endsAtUtc) - Date.parse(second.endsAtUtc)
      ));
      selected = null;
      state = 'ready';
      if (sessions.length) {
        placeholder(label('EventChooseStartTime', 'Choose a start time'));
        time.disabled = false;
        sessions.forEach((session) => {
          const option = document.createElement('option');
          option.value = session.key;
          option.textContent = `${session.startTime} – ${session.endTime}`;
          time.append(option);
        });
      }
      renderState();
    },
    reset() {
      clearSelection();
      date.value = '';
      date.setAttribute('aria-invalid', 'false');
      state = 'idle';
      renderState();
    },
  });
}
