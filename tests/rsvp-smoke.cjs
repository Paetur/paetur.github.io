// Public-release smoke checks. No real guest invite codes or admin credentials.
const { chromium, request } = require('playwright');
const fs = require('node:fs');
const cfg = fs.readFileSync('js/config.js', 'utf8');
const projectUrl = cfg.match(/"supabaseUrl"\s*:\s*"([^"]+)"/)?.[1];
const publishable = cfg.match(/"supabaseKey"\s*:\s*"([^"]+)"/)?.[1];
if (!projectUrl || !publishable || publishable.startsWith('sb_secret_')) throw Error('Missing public-only Supabase configuration');
const site = 'https://paetur.github.io/';
async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const issues = [];
  page.on('pageerror', e => issues.push(e.message));
  try {
    const publicEvent=page.waitForResponse(r=>r.url().endsWith('/rpc/get_public_event_v2'));
    await page.goto(site, { waitUntil: 'load', timeout: 45000 });
    if(await (await publicEvent).json()!==null)throw Error('Event must remain unpublished');
    if (await page.locator('#invitationCard').isVisible()) throw Error('Invitation should be hidden while unpublished');
    const meta = await page.locator('meta[name=referrer]').getAttribute('content');
    if (meta !== 'no-referrer') throw Error('Guest referrer policy must be no-referrer');
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      screen: document.documentElement.clientWidth
    }));
    if (width.scroll > width.screen + 3) throw Error('Horizontal overflow on mobile: ' + JSON.stringify(width));
    const secondEvent=page.waitForResponse(r=>r.url().endsWith('/rpc/get_public_event_v2'));
    await page.goto(site + '?=AAAAAAAA', { waitUntil: 'load', timeout: 45000 });
    if(await (await secondEvent).json()!==null)throw Error('Event must remain unpublished');
    if(await page.locator('#invitationCard').isVisible())throw Error('Unpublished invitation must stay hidden');
    await page.waitForFunction(() => !location.search.includes('AAAAAAAA'), { timeout: 20000 });
    await page.goto(site + 'admin/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('#loginForm').waitFor({ state: 'visible', timeout: 20000 });
    if (await page.locator('#adminApp').isVisible()) throw Error('Anonymous admin panel should be hidden');
    if (issues.length) throw Error('Browser script errors: ' + issues.join('; '));
  } finally { await browser.close(); }
  const api = await request.newContext({ timeout: 25000 });
  try {
    const gateway = projectUrl + '/functions/v1/guest-gateway';
    const corsOrigin = { Origin: site.slice(0, -1) };
    const fake = 'AAAAAAAA';
    const unauthorized = await api.post(gateway, {
      headers: { ...corsOrigin, 'Content-Type': 'application/json', apikey: publishable },
      data: { action: 'get_invitation_v2', args: { p_code: fake } }
    });
    if (unauthorized.status() !== 200) throw Error('Gateway valid-shape request failed ' + unauthorized.status() + ' ' + (await unauthorized.text()).slice(0,250));
    const result = await unauthorized.json();
    if (result !== null) throw Error('Unpublished event leaked invitation data');
    const invalid = await api.post(gateway, {
      headers: { ...corsOrigin, apikey: publishable },
      data: { action: 'get_invitation_v2', args: { p_code: 'INVALID!' } }
    });
    if (invalid.status() !== 400) throw Error('Invalid code should be rejected as 400; got ' + invalid.status());
    // Keep all requests inside a single server minute window; limits intentionally reset each minute.
    const currentSecond = new Date().getUTCSeconds();
    if (currentSecond > 12) {
      await new Promise(resolve => setTimeout(resolve, (61 - currentSecond) * 1000));
    }
    // Exercise actual gateway throttling with a fresh, fabricated code (never a real invitation).
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const entropy = require('node:crypto').randomBytes(8);
    const rateCode = [...entropy].map(n => alphabet[n % alphabet.length]).join('');
    for (let i = 0; i < 20; i++) {
      const response = await api.post(gateway, {
        headers: { ...corsOrigin, apikey: publishable },
        data: { action: 'get_invitation_v2', args: { p_code: rateCode } }
      });
      if (response.status() !== 200) throw Error('Live gateway rate limit triggered early at request ' + (i + 1) + ': ' + response.status());
      if (await response.json() !== null) throw Error('Unknown code unexpectedly returned an invitation');
    }
    const throttled = await api.post(gateway, {
      headers: { ...corsOrigin, apikey: publishable },
      data: { action: 'get_invitation_v2', args: { p_code: rateCode } }
    });
    if (throttled.status() !== 429) throw Error('21st request should be throttled, got ' + throttled.status());
    const direct = await api.post(projectUrl + '/rest/v1/rpc/get_invitation_v2', {
      headers: { apikey: publishable, 'Content-Type': 'application/json' },
      data: { p_code: fake }
    });
    if (![401, 403, 404].includes(direct.status())) throw Error('Direct guest RPC must be denied; got ' + direct.status());
  } finally { await api.dispose(); }
  process.stdout.write('PASS: live guest page, mobile viewport, query scrubbing, login screen, gateway, live throttling and direct-RPC denial\n');
}
run().catch(e => { console.error(e); process.exitCode = 1; });

