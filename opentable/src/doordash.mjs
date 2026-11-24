// DoorDash reservations ("Dine Out"). Bookable times on DoorDash pages are links to a checkout page,
// e.g. /dineout/reservation/checkout?reservation_store_id=…&date=…&time=…&party_size=…&seating_id=…
// The checkout page holds the table and runs a reCAPTCHA check before booking, so the bot finds a
// time through the same data the page uses, then opens that checkout page and presses Reserve.

export const DOORDASH = 'https://www.doordash.com';
const CHECKOUT_PATH = '/dineout/reservation/checkout?';
const GATEWAY_HEADERS = { 'x-experience-id': 'doordash', 'x-unified-gateway-generated-source': 'v1' };

// Pulls every bookable time out of a DoorDash page or API response.
export function parseSlots(text) {
  const cleaned = text.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const slots = new Map();
  for (const m of cleaned.matchAll(/\/dineout\/reservation\/checkout\?[^"'\s\\<>]+/g)) {
    const q = new URLSearchParams(m[0].slice(CHECKOUT_PATH.length));
    const slot = {
      storeId: q.get('reservation_store_id'),
      date: q.get('date'),
      time: q.get('time'),
      partySize: Number(q.get('party_size')),
      seatingId: q.get('seating_id'),
      path: m[0],
    };
    if (slot.storeId && slot.date && slot.time && slot.seatingId) slots.set(`${slot.storeId}|${slot.date}|${slot.time}|${slot.seatingId}`, slot);
  }
  return [...slots.values()];
}

// Keeps the slots for this restaurant, date and party size.
export function matchingSlots(slots, { date, partySize, storeId }) {
  const forDay = slots.filter((s) => s.date === date && s.partySize === partySize);
  if (storeId) return forDay.filter((s) => s.storeId === storeId);
  const stores = new Set(forDay.map((s) => s.storeId));
  if (stores.size > 1) {
    throw new Error('That DoorDash page lists several restaurants. Open the restaurant\'s own page on DoorDash and use that link.');
  }
  return forDay;
}

// Points a captured availability request at the wanted date and party size.
export function retarget(url, { date, partySize }) {
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) {
    if (/(^|[._])date$/i.test(key)) u.searchParams.set(key, date);
    if (/(^|[._])party_?size$/i.test(key)) u.searchParams.set(key, String(partySize));
  }
  return u.toString();
}

export class DoorDashSession {
  constructor(page) {
    this.page = page;
    this.slotSource = null; // the API request that returned bookable times
    page.on('response', (res) => this.#observe(res).catch(() => {}));
  }

  async #observe(res) {
    const req = res.request();
    if (req.method() !== 'GET' || !res.url().startsWith(`${DOORDASH}/unified-gateway/`)) return;
    const text = await res.text();
    if (text.includes('/dineout/reservation/checkout?') || text.includes('\\/dineout\\/reservation\\/checkout?')) {
      this.slotSource = res.url();
    }
  }

  async load(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 20_000;
    while (!this.slotSource && Date.now() < deadline) await this.page.waitForTimeout(250);
    if (/\/login|identity\.doordash/.test(this.page.url())) throw new Error('You are logged out of DoorDash. Log in again.');
  }

  // Bookable times for the target. Uses the page's own availability request when one was seen,
  // otherwise reloads the page and reads the times from it.
  async slots(target) {
    let text;
    if (this.slotSource) {
      const url = retarget(this.slotSource, target);
      const res = await this.page.evaluate(
        async ({ url, headers }) => {
          const r = await fetch(url, { credentials: 'include', headers: { accept: 'application/json', ...headers } });
          return { status: r.status, text: await r.text() };
        },
        { url, headers: GATEWAY_HEADERS },
      );
      if (res.status !== 200) throw new Error(`DoorDash availability failed with HTTP ${res.status}`);
      text = res.text;
    } else {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(1500);
      text = await this.page.content();
    }
    return matchingSlots(parseSlots(text), target);
  }

  // Opens the checkout page for a slot and presses Reserve. Resolves with DoorDash's booking response.
  async book(slot, { waitMs = 3 * 60_000, onNeedsHelp } = {}) {
    const booked = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/unified-gateway/reservation/v1/reservations'),
      { timeout: waitMs },
    );
    booked.catch(() => {});
    await this.page.goto(`${DOORDASH}${slot.path}`, { waitUntil: 'domcontentloaded' });
    const button = this.page.getByRole('button', { name: /^(reserve|confirm|book|complete)/i }).last();
    try {
      await button.waitFor({ state: 'visible', timeout: 15_000 });
      await this.page.waitForFunction((el) => !el.disabled, await button.elementHandle(), { timeout: 10_000 });
      await button.click({ timeout: 5_000 });
    } catch {
      onNeedsHelp?.();
    }
    const res = await booked;
    let json = {};
    try {
      json = await res.json();
    } catch {}
    return { status: res.status(), ...json };
  }
}
