import type { Skill } from './index.js';

export const playwrightSkill: Skill = {
  id: 'playwright',
  name: 'Playwright Browser Automation',
  description: 'Automate browser tasks: testing, scraping, screenshots',
  category: 'browser',
  autoActivate: ['browser', 'screenshot', 'scrape', 'web', '网页', '浏览器', 'playwright', 'e2e'],
  prompt: `## Playwright Browser Automation

You can use the shell tool to run Playwright commands for browser automation.

### Setup
\`\`\`bash
npm install playwright
npx playwright install chromium
\`\`\`

### Common Tasks

**Take a screenshot:**
\`\`\`bash
npx playwright screenshot https://example.com screenshot.png
\`\`\`

**Scrape page content:**
\`\`\`javascript
// save as scrape.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  const title = await page.title();
  const text = await page.textContent('body');
  console.log('Title:', title);
  console.log('Content:', text.slice(0, 500));
  await browser.close();
})();
\`\`\`

**Fill and submit forms:**
\`\`\`javascript
await page.fill('#username', 'user');
await page.fill('#password', 'pass');
await page.click('button[type="submit"]');
\`\`\`

**Wait for dynamic content:**
\`\`\`javascript
await page.waitForSelector('.results');
await page.waitForLoadState('networkidle');
\`\`\`

**E2E Testing:**
\`\`\`javascript
const { test, expect } = require('@playwright/test');
test('login flow', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'test@example.com');
  await page.fill('#password', 'password');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/dashboard');
});
\`\`\`

### Best Practices
- Use \`waitForSelector\` before interacting with elements
- Use \`page.locator()\` for reliable element selection
- Take screenshots for visual verification
- Use \`--headed\` flag to watch: \`npx playwright test --headed\``,
};
