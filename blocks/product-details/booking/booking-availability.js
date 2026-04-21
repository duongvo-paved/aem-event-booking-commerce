/**
 * Shared booking UI utilities used by all three booking-type components.
 */

/**
 * Creates a +/- number stepper control.
 * Returns the wrapper element; exposes getValue() and setMax(n) on the element.
 * @param {Object} opts
 * @param {number} opts.value - Initial value
 * @param {number} [opts.min=1] - Minimum allowed value
 * @param {number} [opts.max=99] - Maximum allowed value
 * @param {Function} opts.onChange - Called with new value whenever it changes
 * @param {string} [opts.label] - Accessible group label
 * @returns {HTMLElement}
 */
export function createStepper({
  value, min = 1, max = 99, onChange, label = '',
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'booking-stepper';
  wrapper.setAttribute('role', 'group');
  if (label) wrapper.setAttribute('aria-label', label);

  const decrementBtn = document.createElement('button');
  decrementBtn.type = 'button';
  decrementBtn.className = 'booking-stepper__btn booking-stepper__btn--decrement';
  decrementBtn.setAttribute('aria-label', 'Decrease');
  decrementBtn.textContent = '−';

  const valueDisplay = document.createElement('span');
  valueDisplay.className = 'booking-stepper__value';
  valueDisplay.setAttribute('aria-live', 'polite');

  const incrementBtn = document.createElement('button');
  incrementBtn.type = 'button';
  incrementBtn.className = 'booking-stepper__btn booking-stepper__btn--increment';
  incrementBtn.setAttribute('aria-label', 'Increase');
  incrementBtn.textContent = '+';

  let current = value;
  let currentMax = max;

  const sync = () => {
    valueDisplay.textContent = current;
    decrementBtn.disabled = current <= min;
    incrementBtn.disabled = current >= currentMax;
  };

  const update = (next) => {
    current = Math.max(min, Math.min(currentMax, next));
    sync();
    onChange(current);
  };

  decrementBtn.addEventListener('click', () => update(current - 1));
  incrementBtn.addEventListener('click', () => update(current + 1));

  sync();

  wrapper.appendChild(decrementBtn);
  wrapper.appendChild(valueDisplay);
  wrapper.appendChild(incrementBtn);

  /** Update the maximum allowed value and clamp current if necessary */
  wrapper.setMax = (n) => {
    currentMax = n;
    if (current > currentMax) {
      current = currentMax;
      onChange(current);
    }
    sync();
  };

  /** Return the current value */
  wrapper.getValue = () => current;

  return wrapper;
}

/**
 * Creates a labelled section heading element.
 * @param {string} text
 * @returns {HTMLElement}
 */
export function createSectionLabel(text) {
  const el = document.createElement('p');
  el.className = 'booking-panel__section-label';
  el.textContent = text;
  return el;
}

/**
 * Renders a grid of selectable slot cards into a container.
 * @param {HTMLElement} container - Will be cleared and repopulated
 * @param {Array} slots - Slot objects from the booking API
 * @param {string|null} selectedSlotId - Currently selected slot ID
 * @param {Function} onSelect - Called with the selected slot object
 * @param {string} [emptyMsg] - Message shown when no slots are available
 */
export function renderSlotGrid(container, slots, selectedSlotId, onSelect, emptyMsg) {
  container.innerHTML = '';

  if (!slots?.length) {
    const empty = document.createElement('p');
    empty.className = 'booking-panel__empty';
    empty.textContent = emptyMsg ?? 'No available slots for this date.';
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'booking-slots-grid';
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'Available slots');

  slots.forEach((slot) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'booking-slot-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', slot.slotId === selectedSlotId ? 'true' : 'false');
    card.dataset.slotId = slot.slotId;

    const isUnavailable = !slot.isAvailable || slot.availableCapacity <= 0;

    if (isUnavailable) {
      card.disabled = true;
      card.classList.add('booking-slot-card--unavailable');
    }
    if (slot.slotId === selectedSlotId) {
      card.classList.add('booking-slot-card--selected');
    }

    const timeEl = document.createElement('span');
    timeEl.className = 'booking-slot-card__time';
    timeEl.textContent = slot.startTime && slot.endTime
      ? `${slot.startTime} – ${slot.endTime}`
      : (slot.label ?? slot.slotId);
    card.appendChild(timeEl);

    if (!isUnavailable && slot.availableCapacity !== undefined) {
      const capEl = document.createElement('span');
      capEl.className = 'booking-slot-card__capacity';
      capEl.textContent = `${slot.availableCapacity} left`;
      card.appendChild(capEl);
    }

    if (isUnavailable) {
      const statusEl = document.createElement('span');
      statusEl.className = 'booking-slot-card__status';
      statusEl.textContent = 'Full';
      card.appendChild(statusEl);
    }

    card.addEventListener('click', () => {
      if (isUnavailable) return;
      grid.querySelectorAll('.booking-slot-card').forEach((c) => {
        c.classList.remove('booking-slot-card--selected');
        c.setAttribute('aria-checked', 'false');
      });
      card.classList.add('booking-slot-card--selected');
      card.setAttribute('aria-checked', 'true');
      onSelect(slot);
    });

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

/**
 * Renders a loading skeleton for the slot grid.
 * @param {HTMLElement} container - Will be cleared and populated with skeletons
 * @param {number} [count=3] - Number of skeleton cards to show
 */
export function renderLoadingSlots(container, count = 3) {
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'booking-slots-grid booking-slots-grid--loading';
  grid.setAttribute('aria-busy', 'true');
  grid.setAttribute('aria-label', 'Loading available slots');

  for (let i = 0; i < count; i += 1) {
    const skeleton = document.createElement('div');
    skeleton.className = 'booking-slot-card booking-slot-card--skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    grid.appendChild(skeleton);
  }
  container.appendChild(grid);
}
