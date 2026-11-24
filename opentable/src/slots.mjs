// OpenTable returns slots within ±30 minutes of the requested time.
export const SLOT_WINDOW_MINUTES = 30;

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const toHHMM = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function anchorTimes(preferredTimes) {
  const anchors = [];
  for (const t of preferredTimes) {
    const m = toMinutes(t);
    if (!anchors.some((a) => Math.abs(toMinutes(a) - m) <= SLOT_WINDOW_MINUTES)) anchors.push(t);
  }
  return anchors;
}

export function availableSlots(availabilityData, restaurantId, anchor) {
  const restaurant = availabilityData?.availability?.find((a) => a.restaurantId === restaurantId);
  const day = restaurant?.availabilityDays?.find((d) => d.dayOffset === 0);
  const base = toMinutes(anchor);
  return (day?.slots ?? [])
    .filter((s) => s.isAvailable)
    .map((s) => ({ ...s, time: toHHMM(base + s.timeOffsetMinutes) }));
}

export function pickSlot(slots, preferredTimes, exclude = new Set()) {
  for (const t of preferredTimes) {
    const slot = slots.find((s) => s.time === t && !exclude.has(s.slotHash));
    if (slot) return slot;
  }
  return null;
}
