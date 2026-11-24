import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { OpenTableSession, openBrowser } from './opentable.mjs';
import { anchorTimes, availableSlots, pickSlot } from './slots.mjs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const runNow = args.has('--now');

const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const { restaurantId, date, partySize, preferredTimes, diner } = config;
if (!restaurantId || !date || !partySize || !preferredTimes?.length) {
  throw new Error('config.json needs restaurantId, date, partySize and preferredTimes.');
}
let cardMode = Boolean(config.creditCardRequired);
let leaveOpen = false;
if (!dryRun && !cardMode && !(diner?.firstName && diner?.lastName && diner?.email && diner?.phoneNumber)) {
  throw new Error('config.json needs your name, email and phone number under "diner".');
}

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const dropAt = runNow ? Date.now() : new Date(config.dropTime).getTime();
if (Number.isNaN(dropAt)) throw new Error('dropTime is not a valid date, e.g. "2026-11-27T09:00:00-05:00".');

const { context, page } = await openBrowser();
const ot = new OpenTableSession(page);

try {
  await ot.load();
  log(`Ready. Target: restaurant ${restaurantId}, ${date}, party of ${partySize}, times ${preferredTimes.join(', ')}.`);

  const refreshAt = dropAt - 45_000;
  if (Date.now() < refreshAt) {
    log(`Waiting until ${new Date(dropAt).toLocaleString()} (keep this window and your computer awake).`);
    await sleep(refreshAt - Date.now());
    await ot.load();
  }
  if (Date.now() < dropAt) await sleep(dropAt - Date.now());

  const result = await snipe();
  if (result) log(result);
  else log(`No matching table found within ${config.windowSeconds ?? 20} seconds.`);
  if (leaveOpen) {
    log('The Chrome window is left open so you can finish there. Close it when you are done.');
    await new Promise((resolve) => context.on('close', resolve));
  }
} finally {
  await context.close();
}

async function snipe() {
  const deadline = dropAt + (config.windowSeconds ?? 20) * 1000;
  const anchors = anchorTimes(preferredTimes);
  const failed = new Set();

  while (Date.now() < deadline) {
    try {
      const slots = [];
      for (const time of anchors) {
        const data = await ot.availability({ restaurantId, date, time, partySize });
        slots.push(...availableSlots(data, restaurantId, time));
      }
      const slot = pickSlot(slots, preferredTimes, failed);
      if (!slot) {
        await sleep(config.pollIntervalMs ?? 500);
        continue;
      }
      if (dryRun) return `DRY RUN: would book ${slot.time}. Available: ${[...new Set(slots.map((s) => s.time))].join(', ')}`;

      if (cardMode) {
        log(`Found ${slot.time}, opening the booking page (card required)...`);
        try {
          const res = await ot.bookInBrowser({
            restaurantId,
            date,
            partySize,
            slot,
            onNeedsHelp: () => log('\x07Could not press "Complete reservation" automatically. Finish the booking in the Chrome window now; the table is being held for you.'),
          });
          if (res.success) return `BOOKED ${date} at ${slot.time}, party of ${partySize}. Confirmation #${res.confirmationNumber}.`;
          leaveOpen = true;
          return `\x07Booking failed (HTTP ${res.status}): ${JSON.stringify(res.error ?? res).slice(0, 300)}. The table may still be held: try finishing in the Chrome window.`;
        } catch (err) {
          log(`Could not book ${slot.time}: ${err.message}`);
        }
      } else {
        log(`Found ${slot.time}, holding it...`);
        try {
          const slotLockId = await ot.lockSlot({ restaurantId, date, partySize, slot });
          const res = await ot.makeReservation({ restaurantId, date, partySize, slot, slotLockId, diner });
          if (res.success) return `BOOKED ${date} at ${slot.time}, party of ${partySize}. Confirmation #${res.confirmationNumber}.`;
          log(`Booking was not confirmed: ${JSON.stringify(res).slice(0, 300)}`);
        } catch (err) {
          log(`Could not book ${slot.time}: ${err.message}`);
          if (/credit.?card/i.test(err.message)) {
            log('This restaurant needs a credit card; switching to the booking page for the rest of this run.');
            cardMode = true;
            continue;
          }
        }
      }
      failed.add(slot.slotHash);
    } catch (err) {
      log(`Request error: ${err.message}`);
      await sleep(config.pollIntervalMs ?? 500);
    }
  }
  return null;
}
