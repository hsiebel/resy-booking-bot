import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { anchorTimes, availableSlots, pickSlot } from '../src/slots.mjs';

const data = JSON.parse(readFileSync(new URL('./availability.fixture.json', import.meta.url), 'utf8'));

test('converts slot offsets to clock times around the requested time', () => {
  const slots = availableSlots(data, 212347, '19:00');
  assert.deepEqual(slots.map((s) => s.time), ['18:30', '18:45', '19:00', '19:15', '19:30']);
});

test('returns nothing for a restaurant not in the response', () => {
  assert.deepEqual(availableSlots(data, 999, '19:00'), []);
});

test('picks the highest-priority available time and skips failed slots', () => {
  const slots = availableSlots(data, 212347, '19:00');
  assert.equal(pickSlot(slots, ['20:00', '19:15', '19:00']).time, '19:15');
  const failed = new Set([slots.find((s) => s.time === '19:15').slotHash]);
  assert.equal(pickSlot(slots, ['20:00', '19:15', '19:00'], failed).time, '19:00');
  assert.equal(pickSlot(slots, ['21:00']), null);
});

test('queries one time per ±30 minute window', () => {
  assert.deepEqual(anchorTimes(['19:00', '19:30', '18:45', '20:00', '21:30']), ['19:00', '20:00', '21:30']);
});
