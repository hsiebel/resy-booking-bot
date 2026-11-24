import { openBrowser } from './opentable.mjs';

const { context, page } = await openBrowser();
await page.goto('https://www.opentable.com/');
console.log('Log in to OpenTable in the Chrome window that just opened, then close that window.');
console.log('Your login is saved for the bot; you only need to do this again if it expires.');
await new Promise((resolve) => context.on('close', resolve));
