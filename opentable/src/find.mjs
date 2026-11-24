import { OpenTableSession, openBrowser } from './opentable.mjs';

const url = process.argv[2];
if (!url?.startsWith('https://www.opentable.com/')) {
  throw new Error('Usage: npm run find -- https://www.opentable.com/r/<restaurant-page>');
}

const { context, page } = await openBrowser();
const ot = new OpenTableSession(page);
try {
  await ot.load(url);
  await page.waitForTimeout(5000);
  const html = await page.content();
  const counts = new Map();
  for (const m of html.matchAll(/"(?:rid|restaurantId)"\s*:\s*(\d+)/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  for (const id of ot.seenRestaurantIds) counts.set(String(id), (counts.get(String(id)) ?? 0) + 100);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) console.log('No restaurant ID found on that page.');
  else console.log(`Restaurant ID: ${ranked[0][0]}${ranked.length > 1 ? `  (other candidates: ${ranked.slice(1, 4).map((r) => r[0]).join(', ')})` : ''}`);
} finally {
  await context.close();
}
