import { formatEventCardDate } from './dates.js';

function metadataIcon(type) {
  const paths = {
    schedule: 'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18',
    venue: 'M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    organizer: 'M4 21h16 M6 21V3h12v18 M9 7h2 M13 7h2 M9 11h2 M13 11h2 M10 21v-5h4v5',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[type]);
  svg.append(path);
  return svg;
}

export function renderEventCardMetadata(metadata, event, labels = {}) {
  metadata.replaceChildren();
  metadata.setAttribute('aria-busy', 'false');
  metadata.hidden = false;
  metadata.classList.toggle('event-card-metadata--unavailable', !event);
  if (!event) {
    metadata.textContent = labels.Global?.EventDetailsUnavailable || 'Event details unavailable';
    return;
  }
  const rows = [
    ['schedule', formatEventCardDate(event)],
    ['venue', `${event.venue.name}, ${event.venue.address}`],
    ['organizer', event.organizer],
  ];
  rows.forEach(([type, text]) => {
    if (!text) return;
    const row = document.createElement('span');
    row.className = `event-card-metadata__${type}`;
    row.textContent = text;
    row.prepend(metadataIcon(type));
    metadata.append(row);
  });
}
