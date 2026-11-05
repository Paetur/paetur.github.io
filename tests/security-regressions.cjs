const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    vm = require('node:vm');
(async () => {
 const context = {
  URL, URLSearchParams, Response, Intl, Date, localStorage: {
   getItem() {
    throw Error('blocked');
   },
   setItem() {
    throw Error('blocked');
   }
  },
  window: {
   location: {
    href: 'https://example.invalid/setup.html'
   },
   RSVP_CONFIG: {
    supabaseUrl: 'https://old.invalid',
    supabaseKey: 'sb_publishable_old'
   },
   supabase: {
    createClient() {
     return {
      auth: {
       getSession: async () => {
        throw Error('offline');
       }
      },
      functions: {
       invoke: async () => {
        throw Error('offline');
       }
      }
     };
    }
   }
  },
  document: {
   querySelector: () => ({
    src: 'https://example.invalid/js/core.js'
   })
  }
 };
 vm.createContext(context);
 vm.runInContext(fs.readFileSync('js/core.js', 'utf8'), context);
 const R = context.window.RSVP;
 assert.equal(R.config().supabaseUrl, 'https://old.invalid');
 R.savePreview('https://new.invalid', 'sb_publishable_new');
 assert.equal(R.config().supabaseUrl, 'https://new.invalid');
 assert.match(R.configSource(), /new.invalid/);
 assert.equal((await R.adminRpc('admin_save_household')).error.message, 'Could not reach the database.');
 assert.equal((await R.guestRpc('get_invitation_v2', {})).error.message, 'Could not reach the database.');
 context.window.supabase.createClient = () => ({
  functions: {
   invoke: async () => ({
    error: {
     context: new Response(JSON.stringify({
      error: 'Too many requests. Try again in a minute.'
     }), {
      status: 429
     })
    }
   })
  }
 });
 R.savePreview('https://new.invalid', 'sb_publishable_new');
 assert.match((await R.guestRpc('get_invitation_v2', {})).error.message, /Too many requests/);
 // Editing credentials must invalidate a connection check already in flight.
 const fields = new Map();
 const field = id => {
  if (!fields.has(id)) fields.set(id, {
   value: '',
   events: {},
   addEventListener(name, handler) { this.events[name] = handler; }
  });
  return fields.get(id);
 };
 let finishProbe, setupReady;
 let gatewayProbes = 0;
 const pendingProbe = new Promise(resolve => { finishProbe = resolve; });
 vm.runInNewContext(fs.readFileSync('js/setup.js', 'utf8'), {
  URL,
  setTimeout: () => assert.fail('Stale connection check scheduled advancement'),
  document: {
   querySelectorAll: () => [],
   addEventListener: (_, handler) => { setupReady = handler; }
  },
  window: {
   scrollTo() {},
   RSVP_I18N: { load: async () => {} },
   RSVP: {
    byId: field,
    config: () => ({ supabaseUrl: 'https://old.invalid' }),
    savePreview: supabaseUrl => ({ supabaseUrl }),
    getClient: () => ({ rpc: () => pendingProbe }),
    guestRpc: async () => { gatewayProbes++; return {}; },
    showStatus: (id, message) => { field(id).value = message; },
    safeError: error => error.message
   }
  }
 });
 setupReady();
 await Promise.resolve();
 const attempt = field('connectForm').events.submit({ preventDefault() {}, submitter: {} });
 field('setupUrl').value = 'https://new.invalid';
 field('connectForm').events.input();
 finishProbe({});
 await attempt;
 assert.equal(gatewayProbes, 0);
 assert.equal(field('setupStatus').value, '');

 const {
  readLimitedBody
 } = await import('../supabase/functions/_shared/request-body.mjs');
 const req = body => new Request('https://example.invalid', {
  method: 'POST',
  body
 });
 assert.equal(await readLimitedBody(req('ø'), 2), 'ø');
 await assert.rejects(() => readLimitedBody(req('øø'), 3), RangeError);
 let cancelled = false;
 const stream = new ReadableStream({
  pull(c) {
   c.enqueue(new Uint8Array(100));
  },
  cancel() {
   cancelled = true;
  }
 });
 await assert.rejects(() => readLimitedBody(new Request('https://example.invalid', {
  method: 'POST',
  body: stream,
  duplex: 'half'
 }), 150), RangeError);
 assert.equal(cancelled, true);
 let handler;
 global.Deno = {
  serve: fn => handler = fn,
  env: {
   get: () => undefined
  }
 };
 try {
  await import('../supabase/functions/guest-gateway/index.ts');
  assert.equal((await handler(req('{'))).status, 400);
  assert.equal((await handler(req('x'.repeat(20001)))).status, 413);
 } finally {
  delete global.Deno;
 }
 const {
  invitationHandler
 } = await import('../supabase/functions/admin-invitations/handler.mjs');
 const email = invitationHandler({
  url: 'https://example.invalid',
  serviceKey: 'test',
  createClient: () => {
   throw Error('Should reject before client creation');
  }
 });
 assert.equal((await email(new Request('https://example.invalid', {
  method: 'POST',
  headers: {
   authorization: 'Bearer aaa.bbb.ccc'
  },
  body: 'ø'.repeat(1100)
 }))).status, 413);
 for (const file of ['index.html', 'setup.html', 'admin/index.html']) {
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(html.includes('@supabase/supabase-js@2.50.0/'));
  assert.match(html, /integrity="sha384-[A-Za-z0-9+/=]+" crossorigin="anonymous"/);
 }
 console.log('PASS: streaming limits, handler rejection, SDK pins/integrity, preview selection/export, blocked storage, network recovery and gateway messages');
})().catch(e => {
 console.error(e);
 process.exitCode = 1;
});
