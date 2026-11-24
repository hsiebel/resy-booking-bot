import { setTimeout as sleep } from 'node:timers/promises';
import { OpenTableSession, openBrowser } from './opentable.mjs';
import { anchorTimes, availableSlots, pickSlot } from './slots.mjs';

export function checkConfig(config, { dryRun = false } = {}) {
  const { restaurantId, date, partySize, preferredTimes, diner } = config;
  if (!restaurantId || !date || !partySize || !preferredTimes?.length) {
    throw new Error('Missing restaurant, date, party size or times.');
  }
  if (!dryRun && !config.creditCardRequired && !(diner?.firstName && diner?.lastName && diner?.email && diner?.phoneNumber)) {
    throw new Error('Missing your name, email or phone number.');
  }
}

// Runs one snipe. `now` skips waiting for the drop; `dryRun` finds a table without booking it.
// Abort `signal` to stop early. Resolves with a one-line result message.
export async function runSnipe(config, { dryRun = false, now = false, log = console.log, signal } = {}) {
  checkConfig(config, { dryRun });
  const { restaurantId, date, partySize, preferredTimes, diner } = config;
  const dropAt = now ? Date.now() : new Date(config.dropTime).getTime();
  if (Number.isNaN(dropAt)) throw new Error('The release time is not a valid date.');

  const { context, page } = await openBrowser();
  const closeOnAbort = () => context.close().catch(() => {});
  signal?.addEventListener('abort', closeOnAbort);
  const wait = (ms) => sleep(Math.max(0, ms), undefined, { signal });
  const ot = new OpenTableSession(page);
  let cardMode = Boolean(config.creditCardRequired);
  let leaveOpen = false;

  try {
    await ot.load();
    log(`Ready. Restaurant ${restaurantId}, ${date}, party of ${partySize}, times ${preferredTimes.join(', ')}.`);

    const refreshAt = dropAt - 45_000;
    if (Date.now() < refreshAt) {
      log(`Waiting until ${new Date(dropAt).toLocaleString()}. Keep your Mac awake, online and plugged in.`);
      await wait(refreshAt - Date.now());
      await ot.load();
    }
    await wait(dropAt - Date.now());

    const result = (await snipe()) ?? `No matching table found within ${config.windowSeconds ?? 20} seconds.`;
    log(result);
    if (leaveOpen) {
      log('The Chrome window is left open so you can finish there. Close it when you are done.');
      await new Promise((resolve) => context.on('close', resolve));
    }
    return result;
  } catch (err) {
    if (signal?.aborted) return 'Stopped.';
    throw err;
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await context.close().catch(() => {});
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
          await wait(config.pollIntervalMs ?? 500);
          continue;
        }
        if (dryRun) return `TEST OK: would book ${slot.time}. Open times: ${[...new Set(slots.map((s) => s.time))].join(', ')}`;

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
            if (signal?.aborted) throw err;
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
            if (signal?.aborted) throw err;
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
        if (signal?.aborted) throw err;
        log(`Request error: ${err.message}`);
        await wait(config.pollIntervalMs ?? 500);
      }
    }
    return null;
  }
}

// Finds the OpenTable restaurant ID for a restaurant page link.
export async function findRestaurantId(url) {
  if (!/^https:\/\/(www\.)?opentable\.com\//.test(url)) throw new Error('Paste a link that starts with https://www.opentable.com/');
  const fromUrl = url.match(/[?&](?:rid|restref)=(\d+)/) ?? url.match(/\/restref\/client\/?\?rid=(\d+)/);
  if (fromUrl) return Number(fromUrl[1]);
  const { context, page } = await openBrowser();
  const ot = new OpenTableSession(page);
  try {
    await ot.load(url.replace('://opentable.com', '://www.opentable.com'));
    await page.waitForTimeout(4000);
    const html = await page.content();
    const counts = new Map();
    for (const m of html.matchAll(/"(?:rid|restaurantId)"\s*:\s*(\d+)/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    for (const id of ot.seenRestaurantIds) counts.set(String(id), (counts.get(String(id)) ?? 0) + 100);
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) throw new Error('Could not find a restaurant on that page. Is it a restaurant page?');
    return Number(ranked[0][0]);
  } finally {
    await context.close().catch(() => {});
  }
}
