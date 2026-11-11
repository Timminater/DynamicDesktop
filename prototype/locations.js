'use strict';

async function searchLocations(query, language) {
  const postal = query.match(/^([1-9]\d{3})(?:\s*[a-z]{2})?$/i);
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: postal ? postal[1] : query, language, count: '10' });
  if (postal) url.searchParams.set('countryCode', 'NL');

  const response = await fetch(url, { signal: AbortSignal.timeout(10000), credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('Location search failed.');
  const data = await response.json();
  return (data.results || []).filter(place =>
    typeof place.name === 'string' && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)
  ).map(place => ({
    label: [...new Set([place.name, place.admin1, place.country].filter(Boolean))].join(', '),
    latitude: place.latitude,
    longitude: place.longitude,
    timeZone: typeof place.timezone === 'string' ? place.timezone : ''
  }));
}
