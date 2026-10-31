import {createClient} from 'npm:@supabase/supabase-js@2.49.10';
import {invitationHandler} from './handler.mjs';
Deno.serve(invitationHandler({
  createClient,
  url:Deno.env.get('SUPABASE_URL'),
  serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'))[0]
}));
