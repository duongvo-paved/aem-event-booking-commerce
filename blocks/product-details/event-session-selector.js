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

function dateFromKey(value) {
  return new Date(`${value}T12:00:00Z`);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(value) {
  return value.slice(0, 7);
}

function monthDate(value, day = 1) {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function shiftMonth(value, amount) {
  const date = monthDate(`${value}-01`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

function sessionKey(occurrence) {
  return `${occurrence.startsAtUtc}|${occurrence.endsAtUtc}`;
}

/** Session choices span all spaces; occurrence identity remains allocation-specific. */
export default function createSessionSelector({
  event, labels, onDateChange, onChange,
}) {
  const label = (key, fallback) => labels.Global?.[key] || fallback;
  const locale = document.documentElement.lang || undefined;
  const fieldset = element('fieldset', 'event-booking__occurrences');
  fieldset.setAttribute('aria-label', label('EventOccurrenceHeading', 'Choose a date and time'));
  const { recurrence } = event;
  const today = calendarToday(event.timezone);
  const minDate = recurrence.startDate > today ? recurrence.startDate : today;
  const maxDate = recurrence.endDate;
  const startMonth = monthKey(minDate);
  const endMonth = monthKey(maxDate);
  const scheduledWeekdays = new Set(recurrence.weekdays);
  const excludedDates = new Set(recurrence.excludedDates);

  const datePicker = element('div', 'event-booking__date-picker');
  datePicker.id = 'event-occurrence-date';
  const trigger = element('button', 'event-booking__calendar-trigger');
  trigger.type = 'button';
  trigger.id = 'event-occurrence-date-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'event-occurrence-date-panel');

  const calendar = element('div', 'event-booking__calendar');
  calendar.id = 'event-occurrence-date-panel';
  calendar.hidden = true;
  calendar.setAttribute('role', 'dialog');
  calendar.setAttribute('aria-label', label('EventOccurrenceDateLabel', 'Date'));

  const header = element('div', 'event-booking__calendar-header');
  const monthName = element('span', 'event-booking__calendar-month');
  monthName.tabIndex = -1;
  monthName.setAttribute('aria-live', 'polite');
  const previousMonth = element('button', 'event-booking__calendar-nav', '‹');
  previousMonth.type = 'button';
  previousMonth.setAttribute('aria-label', label('EventCalendarPreviousMonth', 'Previous month'));
  const nextMonth = element('button', 'event-booking__calendar-nav', '›');
  nextMonth.type = 'button';
  nextMonth.setAttribute('aria-label', label('EventCalendarNextMonth', 'Next month'));
  header.append(monthName, previousMonth, nextMonth);

  const grid = element('div', 'event-booking__calendar-grid');
  grid.setAttribute('role', 'group');
  const weekdayFormat = new Intl.DateTimeFormat('en-AU', { weekday: 'narrow', timeZone: 'UTC' });
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const date = new Date(Date.UTC(2023, 0, 2 + weekday, 12));
    const weekdayName = element('span', 'event-booking__calendar-weekday', weekdayFormat.format(date));
    weekdayName.setAttribute('aria-hidden', 'true');
    grid.append(weekdayName);
  }
  const footer = element('div', 'event-booking__calendar-footer');
  const clearDateButton = element('button', 'event-booking__calendar-action', label('EventCalendarClear', 'Clear'));
  clearDateButton.type = 'button';
  const todayButton = element('button', 'event-booking__calendar-action', label('EventCalendarToday', 'Today'));
  todayButton.type = 'button';
  footer.append(clearDateButton, todayButton);
  calendar.append(header, grid, footer);

  const status = element('p', 'event-booking__occurrence-availability');
  status.id = 'event-session-availability';
  status.setAttribute('role', 'status');
  calendar.setAttribute('aria-describedby', status.id);
  trigger.setAttribute('aria-describedby', status.id);
  const time = document.createElement('select');
  time.id = 'event-occurrence-time';
  time.name = 'occurrence-time';
  time.required = true;
  time.setAttribute('aria-describedby', status.id);
  const retry = element(
    'button',
    'event-booking__availability-retry',
    label('EventAvailabilityRetryLabel', 'Retry loading times'),
  );
  retry.type = 'button';
  retry.hidden = true;

  const calendarWrapper = element('div', 'event-booking__occurrence-field');
  const dateLabel = document.createElement('label');
  dateLabel.className = 'event-booking__occurrence-label';
  dateLabel.textContent = label('EventOccurrenceDateLabel', 'Date');
  dateLabel.id = 'event-occurrence-date-label';
  dateLabel.htmlFor = trigger.id;
  calendar.setAttribute('aria-labelledby', dateLabel.id);
  calendar.setAttribute('aria-describedby', status.id);
  const triggerIcon = element('span', 'event-booking__calendar-trigger-icon');
  triggerIcon.setAttribute('aria-hidden', 'true');
  trigger.append(triggerIcon);
  datePicker.append(trigger, calendar);
  calendarWrapper.append(dateLabel, datePicker);
  const timeWrapper = element('div', 'event-booking__occurrence-field');
  const timeLabel = document.createElement('label');
  timeLabel.className = 'event-booking__occurrence-label';
  timeLabel.htmlFor = time.id;
  timeLabel.textContent = label('EventOccurrenceTimeLabel', 'Start time');
  timeWrapper.append(timeLabel, time);
  fieldset.append(calendarWrapper, timeWrapper, status, retry);

  let allocations = [];
  let sessions = [];
  let selected = null;
  let selectedDate = '';
  let activeDate = '';
  let activeMonth = startMonth;
  let state = 'idle';
  const dateFormat = new Intl.DateTimeFormat(locale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  const isSelectable = (value) => {
    if (value < minDate || value > maxDate || excludedDates.has(value)) return false;
    const date = dateFromKey(value);
    return scheduledWeekdays.has(date.getUTCDay() || 7);
  };

  const availableOccurrences = (allocation) => (allocation.occurrences || [])
    .filter((occurrence) => (
      occurrence.localDate === selectedDate && occurrence.availableQuantity > 0
      && Date.parse(occurrence.startsAtUtc) > Date.now()
    ));

  function placeholder(text) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = text;
    time.replaceChildren(option);
    time.disabled = true;
  }

  function updateTrigger() {
    const visibleDate = selectedDate
      ? new Intl.DateTimeFormat('en-AU', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
      }).format(dateFromKey(selectedDate))
      : label('EventChooseDateLabel', 'DD/MM/YYYY');
    trigger.replaceChildren(element('span', 'event-booking__calendar-trigger-value', visibleDate));
    trigger.append(triggerIcon);
    trigger.setAttribute('aria-label', selectedDate
      ? dateFormat.format(dateFromKey(selectedDate))
      : label('EventChooseDateLabel', 'Choose a date'));
  }

  function closeCalendar(returnFocus = false) {
    calendar.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus();
  }

  function openCalendar() {
    if (trigger.disabled) return;
    activeMonth = selectedDate ? monthKey(selectedDate) : startMonth;
    activeDate = selectedDate;
    renderCalendar();
    calendar.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    focusDate(activeDate);
  }

  function focusDate(value) {
    const button = [...grid.querySelectorAll('[data-date]')]
      .find((candidate) => candidate.dataset.date === value);
    if (button) {
      button.focus();
    } else {
      monthName.focus();
    }
  }

  function findSelectableDate(value, delta) {
    const date = dateFromKey(value);
    for (let attempts = 0; attempts < 3660; attempts += 1) {
      date.setUTCDate(date.getUTCDate() + delta);
      const candidate = dateKey(date);
      if (candidate < minDate || candidate > maxDate) return '';
      if (isSelectable(candidate)) return candidate;
    }
    return '';
  }

  function handleDateKeydown(eventObject) {
    const value = eventObject.currentTarget.dataset.date;
    let delta = 0;
    if (eventObject.key === 'ArrowLeft') delta = -1;
    if (eventObject.key === 'ArrowRight') delta = 1;
    if (eventObject.key === 'ArrowUp') delta = -7;
    if (eventObject.key === 'ArrowDown') delta = 7;
    if (eventObject.key === 'Home' || eventObject.key === 'End') {
      const date = dateFromKey(value);
      const monday = (date.getUTCDay() + 6) % 7;
      const offset = eventObject.key === 'Home' ? -monday : 6 - monday;
      const weekDate = dateFromKey(value);
      weekDate.setUTCDate(weekDate.getUTCDate() + offset);
      delta = Math.sign(offset);
      const target = isSelectable(dateKey(weekDate))
        ? dateKey(weekDate) : findSelectableDate(value, delta || 1);
      if (target) moveFocus(target);
      eventObject.preventDefault();
      return;
    }
    if (eventObject.key === 'PageUp' || eventObject.key === 'PageDown') {
      const monthDelta = eventObject.key === 'PageUp' ? -1 : 1;
      const targetMonth = shiftMonth(activeMonth, monthDelta);
      if (targetMonth >= startMonth && targetMonth <= endMonth) {
        activeMonth = targetMonth;
        const [targetYear, targetMonthNumber] = targetMonth.split('-').map(Number);
        const targetLastDay = new Date(Date.UTC(targetYear, targetMonthNumber, 0, 12))
          .getUTCDate();
        const targetDay = Math.min(Number(value.slice(-2)), targetLastDay);
        const target = dateKey(monthDate(activeMonth, targetDay));
        activeDate = isSelectable(target) ? target : '';
        renderCalendar();
        focusDate(activeDate);
      }
      eventObject.preventDefault();
      return;
    }
    if (delta) {
      const target = findSelectableDate(value, delta);
      if (target) moveFocus(target);
      eventObject.preventDefault();
    }
  }

  function renderCalendar() {
    const first = monthDate(activeMonth);
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    monthName.textContent = new Intl.DateTimeFormat(locale, {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(first);
    previousMonth.disabled = activeMonth <= startMonth;
    nextMonth.disabled = activeMonth >= endMonth;
    grid.setAttribute('aria-label', monthName.textContent);
    grid.replaceChildren(...[...grid.children].slice(0, 7));

    let firstSelectable = '';
    const calendarStart = monthDate(activeMonth);
    calendarStart.setUTCDate(calendarStart.getUTCDate() - mondayOffset);
    for (let cell = 0; cell < 42; cell += 1) {
      const date = new Date(calendarStart);
      date.setUTCDate(calendarStart.getUTCDate() + cell);
      const value = dateKey(date);
      const inMonth = monthKey(value) === activeMonth;
      const selectable = inMonth && isSelectable(value);
      const button = element('button', 'event-booking__calendar-day', String(date.getUTCDate()));
      button.type = 'button';
      button.dataset.date = value;
      button.disabled = !selectable;
      button.setAttribute('aria-pressed', String(value === selectedDate));
      button.setAttribute('aria-label', dateFormat.format(dateFromKey(value)));
      if (!inMonth) button.classList.add('is-outside-month');
      if (value === today) button.classList.add('is-today');
      if (value === selectedDate) button.classList.add('is-selected');
      if (selectable && !firstSelectable) firstSelectable = value;
      button.tabIndex = value === activeDate ? 0 : -1;
      button.addEventListener('click', () => selectDate(value));
      button.addEventListener('keydown', handleDateKeydown);
      grid.append(button);
    }

    const activeDateIsCurrent = isSelectable(activeDate) && monthKey(activeDate) === activeMonth;
    if (!activeDateIsCurrent) {
      if (selectedDate && monthKey(selectedDate) === activeMonth) {
        activeDate = selectedDate;
      } else {
        activeDate = firstSelectable;
      }
    }
    grid.querySelectorAll('[data-date]').forEach((button) => {
      button.tabIndex = button.dataset.date === activeDate ? 0 : -1;
    });
    clearDateButton.disabled = !selectedDate;
    todayButton.disabled = !isSelectable(today);
  }

  function moveFocus(value) {
    if (monthKey(value) !== activeMonth) activeMonth = monthKey(value);
    activeDate = value;
    renderCalendar();
    focusDate(value);
  }

  function clearSelection() {
    allocations = [];
    sessions = [];
    selected = null;
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

  function selectDate(value) {
    if (!isSelectable(value)) return;
    selectedDate = value;
    activeDate = value;
    clearSelection();
    state = 'loading';
    renderCalendar();
    updateTrigger();
    closeCalendar(true);
    renderState();
    onChange(null);
    onDateChange(value);
  }

  function clearDate() {
    if (!selectedDate) return;
    selectedDate = '';
    activeDate = '';
    clearSelection();
    state = 'idle';
    updateTrigger();
    closeCalendar(true);
    renderCalendar();
    placeholder(label('EventChooseDateFirst', 'Choose a date first'));
    renderState();
    onChange(null);
    onDateChange('');
  }

  previousMonth.addEventListener('click', () => {
    if (activeMonth <= startMonth) return;
    activeMonth = shiftMonth(activeMonth, -1);
    activeDate = '';
    renderCalendar();
  });
  nextMonth.addEventListener('click', () => {
    if (activeMonth >= endMonth) return;
    activeMonth = shiftMonth(activeMonth, 1);
    activeDate = '';
    renderCalendar();
  });
  clearDateButton.addEventListener('click', clearDate);
  todayButton.addEventListener('click', () => selectDate(today));
  trigger.addEventListener('click', () => {
    if (calendar.hidden) openCalendar();
    else closeCalendar();
  });
  fieldset.addEventListener('keydown', (eventObject) => {
    if (eventObject.key === 'Escape' && !calendar.hidden) {
      eventObject.preventDefault();
      closeCalendar(true);
    }
  });
  document.addEventListener('click', (eventObject) => {
    if (!datePicker.contains(eventObject.target)) closeCalendar();
  });
  time.addEventListener('change', () => {
    selected = sessions.find((session) => session.key === time.value) || null;
    renderState();
    onChange(selected);
  });
  retry.addEventListener('click', () => onDateChange(selectedDate));
  if (minDate > maxDate) {
    calendar.setAttribute('aria-disabled', 'true');
    trigger.disabled = true;
    state = 'ready';
  }
  updateTrigger();
  renderCalendar();
  placeholder(label('EventChooseDateFirst', 'Choose a date first'));
  renderState();

  return Object.freeze({
    fieldset,
    getDate: () => selectedDate,
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
      selectedDate = '';
      activeDate = '';
      activeMonth = startMonth;
      state = 'idle';
      closeCalendar();
      updateTrigger();
      renderCalendar();
      renderState();
    },
  });
}
