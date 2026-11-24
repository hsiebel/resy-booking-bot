import { findRestaurantId } from './sniper.mjs';

const url = process.argv[2];
if (!url) throw new Error('Usage: npm run find -- https://www.opentable.com/r/<restaurant-page>');
console.log(`Restaurant ID: ${await findRestaurantId(url)}`);
