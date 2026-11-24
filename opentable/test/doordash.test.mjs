import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchingSlots, parseSlots, retarget } from '../src/doordash.mjs';

const link = (store, time, seat, date = '2026-12-09', party = 2) =>
  `/dineout/reservation/checkout?reservation_store_id=${store}&date=${date}&time=${encodeURIComponent(time)}&party_size=${party}&seating_id=${seat}&source=dineout_dashboard`;

// Shaped like DoorDash's page data: slot buttons with deep-link actions.
const response = JSON.stringify({
  data: [
    { content: { value: '4:00 PM' }, actions: [{ action_type: 'common.deep_link_navigate', content: { path: link('aaa', '16:00', 'S1-1.0') } }] },
    { content: { value: '6:30 PM' }, actions: [{ action_type: 'common.deep_link_navigate', content: { path: link('aaa', '18:30', 'S2-2.0') } }] },
    { content: { value: '6:30 PM' }, actions: [{ action_type: 'common.deep_link_navigate', content: { path: link('aaa', '18:30', 'S2-2.0') } }] },
    { content: { value: '7:00 PM' }, actions: [{ action_type: 'common.deep_link_navigate', content: { path: link('aaa', '19:00', 'S3-3.0', '2026-12-09', 4) } }] },
  ],
});

test('reads bookable times from page data and drops duplicates', () => {
  const slots = parseSlots(response);
  assert.deepEqual(slots.map((s) => [s.time, s.partySize]), [['16:00', 2], ['18:30', 2], ['19:00', 4]]);
  assert.equal(slots[0].path.startsWith('/dineout/reservation/checkout?'), true);
});

test('reads times from escaped JSON too', () => {
  const escaped = response.replace(/\//g, '\\/').replace(/&/g, '\\u0026');
  assert.equal(parseSlots(escaped).length, 3);
});

test('keeps only the wanted date and party size', () => {
  assert.deepEqual(matchingSlots(parseSlots(response), { date: '2026-12-09', partySize: 2 }).map((s) => s.time), ['16:00', '18:30']);
});

test('refuses to guess when a page lists several restaurants', () => {
  const mixed = parseSlots(response + link('bbb', '17:00', 'X'));
  assert.throws(() => matchingSlots(mixed, { date: '2026-12-09', partySize: 2 }), /several restaurants/);
  assert.equal(matchingSlots(mixed, { date: '2026-12-09', partySize: 2, storeId: 'bbb' }).length, 1);
});

test('points a captured availability request at the wanted date and party size', () => {
  const url = 'https://www.doordash.com/unified-gateway/dine_out/v1/dashboard?filter_query.reservation.date=2026-12-01&filter_query.reservation.party_size=2&sort=X';
  const out = new URL(retarget(url, { date: '2026-12-09', partySize: 4 }));
  assert.equal(out.searchParams.get('filter_query.reservation.date'), '2026-12-09');
  assert.equal(out.searchParams.get('filter_query.reservation.party_size'), '4');
  assert.equal(out.searchParams.get('sort'), 'X');
});
