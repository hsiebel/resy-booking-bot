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
   - `diner`: your name, email and phone, as on your OpenTable account
3. Test it without booking, against a date that has tables now:
   `npm run snipe -- --now --dry-run`
4. Start the real run any time before the drop: `npm run snipe`.
   Leave the Chrome window open and keep your computer awake and online until it finishes
   (on a Mac, `caffeinate -i npm run snipe` keeps it from sleeping).

## Limits
- Restaurants that require a credit card or deposit to book aren't supported yet; the bot will
  report the error instead of booking.
- OpenTable can change its website at any time, which can break the bot. Run the dry-run test
  the day before a drop.
- Automated booking is against OpenTable's terms of service and could get your account flagged.
