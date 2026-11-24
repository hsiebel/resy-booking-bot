# OpenTable sniper

Books an OpenTable reservation the moment tables are released. It drives your own Chrome
window (logged in to your OpenTable account) and checks availability every half second for
20 seconds after the drop time, then holds and books the first table that matches your
preferred times, in priority order.

## One-time setup (Mac)
1. Install Google Chrome and Node.js (https://nodejs.org, the "LTS" version).
2. Open Terminal, go to this folder and install:
   ```
   cd path/to/resy-booking-bot/opentable
   npm install
   ```
3. Log in: `npm run login`. A Chrome window opens; log in to OpenTable, then close the window.

## Set up a snipe
1. Find the restaurant ID: `npm run find -- https://www.opentable.com/r/<restaurant-page>`
2. Copy `config.example.json` to `config.json` and fill it in:
   - `restaurantId`: from step 1
   - `date`: the reservation date, `YYYY-MM-DD`
   - `partySize`
   - `preferredTimes`: 24-hour times in priority order. OpenTable slots are every 15 minutes.
   - `dropTime`: when tables are released, with the timezone, e.g. `2026-11-27T09:00:00-05:00` for 9am New York time
   - `creditCardRequired`: `true` if the restaurant asks for a card to book (it says so on the
     booking page). If you leave it `false` and the restaurant turns out to need one, the bot
     switches over by itself, but that costs a second or two at the drop.
   - `diner`: your name, email and phone, as on your OpenTable account (not used for card restaurants;
     the booking page fills them in from your account)
3. Test it without booking, against a date that has tables now:
   `npm run snipe -- --now --dry-run`
4. Start the real run any time before the drop: `npm run snipe`.
   Leave the Chrome window open and keep your computer awake and online until it finishes
   (on a Mac, `caffeinate -i npm run snipe` keeps it from sleeping).

## Restaurants that require a credit card
OpenTable turns your card into a one-time code inside its own payment form, so the bot can't book
these directly. Instead, as soon as a table appears, it opens that table's booking page in the
Chrome window. That page holds the table, ticks the cancellation-policy box (never the marketing
ones) and presses "Complete reservation" using the card saved on your account. Before the drop:
1. Save a card on your OpenTable account (Profile > Payment methods).
2. Do one practice booking by hand at a card restaurant, so you know the saved card is picked
   automatically and no security code is asked for. If the page asks for anything, the bot beeps and
   leaves the window open for you to finish; the table stays held for a few minutes.

## Limits
- Prepaid "Experience" tables (ticketed menus) are skipped; only regular tables are booked.
- If you already have a booking at an overlapping time, OpenTable may refuse or offer to swap it.
  Cancel the old one first if you don't want it.
- OpenTable can change its website at any time, which can break the bot. Run the dry-run test
  the day before a drop.
- Automated booking is against OpenTable's terms of service and could get your account flagged.
