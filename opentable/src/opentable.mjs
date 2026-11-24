import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = 'https://www.opentable.com';
const PROFILE_DIR = fileURLToPath(new URL('../.chrome-profile', import.meta.url));

// Persisted-query hashes captured from opentable.com; replaced by live values when the site sends them.
const QUERY_HASHES = {
  RestaurantsAvailability: '9d41be178447f0688ceebc509e9e1d8b68c48c02e37a6a5fe313a8231975a4a0',
  BookDetailsStandardSlotLock: '1100bf68905fd7cb1d4fd0f4504a4954aa28ec45fb22913fa977af8b06fd97fa',
};

export async function openBrowser() {
  // A real Chrome install with a saved profile, so requests look like a normal logged-in visitor.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: null,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

export class OpenTableSession {
  constructor(page) {
    this.page = page;
    this.csrf = null;
    this.seenRestaurantIds = new Set();
    page.on('request', (req) => this.#observe(req).catch(() => {}));
  }

  async #observe(req) {
    if (!req.url().startsWith(`${BASE}/dapi/`)) return;
    const headers = await req.allHeaders();
    if (headers['x-csrf-token']) this.csrf = headers['x-csrf-token'];
    const body = req.postDataJSON?.();
    const name = body?.operationName;
    const hash = body?.extensions?.persistedQuery?.sha256Hash;
    if (name && hash && name in QUERY_HASHES) QUERY_HASHES[name] = hash;
    for (const id of body?.variables?.restaurantIds ?? []) this.seenRestaurantIds.add(id);
  }

  async load(url = `${BASE}/`) {
    this.csrf = null;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 20_000;
    while (!this.csrf && Date.now() < deadline) await this.page.waitForTimeout(250);
    if (!this.csrf) throw new Error('Could not get a security token from opentable.com. Is the page loading?');
  }

  async #post(path, body, extraHeaders = {}) {
    // Sent from inside the page so cookies and bot-protection state come along automatically.
    const res = await this.page.evaluate(
      async ({ url, body, headers }) => {
        const r = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
          body: JSON.stringify(body),
        });
        return { status: r.status, text: await r.text() };
      },
      { url: `${BASE}${path}`, body, headers: { 'x-csrf-token': this.csrf, ...extraHeaders } },
    );
    let json = null;
    try {
      json = JSON.parse(res.text);
    } catch {}
    if (res.status !== 200 || !json) {
      throw new Error(`${path} failed with HTTP ${res.status}: ${res.text.slice(0, 300)}`);
    }
    return json;
  }

  async #gql(operationName, variables, pageGroup, pageType) {
    const json = await this.#post(
      `/dapi/fe/gql?optype=${operationName === 'RestaurantsAvailability' ? 'query' : 'mutation'}&opname=${operationName}`,
      { operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash: QUERY_HASHES[operationName] } } },
      { 'ot-page-group': pageGroup, 'ot-page-type': pageType },
    );
    if (json.errors?.length) throw new Error(`${operationName}: ${JSON.stringify(json.errors).slice(0, 300)}`);
    return json.data;
  }

  availability({ restaurantId, date, time, partySize }) {
    return this.#gql(
      'RestaurantsAvailability',
      {
        onlyPop: false,
        forwardDays: 0,
        requireTimes: false,
        requireTypes: [],
        privilegedAccess: ['UberOneDiningProgram', 'VisaDiningProgram', 'VisaEventsProgram', 'ChaseDiningProgram', 'VIP'],
        includeGuestTagAccessRules: false,
        includeAvailableSpaces: false,
        includeMetaSearchListingSlots: false,
        includeSlotTypes: false,
        restaurantIds: [restaurantId],
        date,
        time,
        partySize,
        databaseRegion: 'NA',
        restaurantAvailabilityTokens: ['eyJ2IjozLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ'],
        slotDiscovery: ['on'],
        loyaltyRedemptionTiers: [],
      },
      'rest-profile',
      'restaurant',
    );
  }

  async lockSlot({ restaurantId, date, partySize, slot }) {
    const data = await this.#gql(
      'BookDetailsStandardSlotLock',
      {
        input: {
          restaurantId,
          seatingOption: 'DEFAULT',
          reservationDateTime: `${date}T${slot.time}`,
          partySize,
          databaseRegion: 'NA',
          slotHash: slot.slotHash,
          reservationType: 'STANDARD',
          diningAreaId: 1,
          slotAvailabilityToken: slot.slotAvailabilityToken,
        },
      },
      'booking',
      'network_details',
    );
    const lock = data?.lockSlot;
    if (!lock?.success) throw new Error(`Slot hold refused: ${JSON.stringify(lock?.slotLockErrors)}`);
    return lock.slotLock.slotLockId;
  }

  makeReservation({ restaurantId, date, partySize, slot, slotLockId, diner }) {
    return this.#post('/dapi/booking/make-reservation', {
      additionalServiceFees: [],
      correlationId: randomUUID(),
      country: diner.country ?? 'US',
      diningAreaId: 1,
      email: diner.email,
      firstName: diner.firstName,
      lastName: diner.lastName,
      isModify: false,
      katakanaFirstName: '',
      katakanaLastName: '',
      nonBookableExperiences: [],
      partySize,
      points: slot.pointsValue ?? 0,
      pointsType: slot.pointsType ?? 'Standard',
      reservationAttribute: 'default',
      reservationDateTime: `${date}T${slot.time}`,
      reservationType: 'Standard',
      restaurantId,
      slotAvailabilityToken: slot.slotAvailabilityToken,
      slotHash: slot.slotHash,
      slotLockId,
      tipAmount: 0,
      tipPercent: 0,
      phoneNumber: diner.phoneNumber,
      phoneNumberCountryId: diner.country ?? 'US',
      optInEmailRestaurant: false,
    });
  }
}
