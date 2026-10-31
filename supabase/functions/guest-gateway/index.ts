// RSVP guest gateway — prevents direct PostgREST bypass and enforces atomic rate limits.
// Project-specific allowed origin. Use the same frontend hostname when reusing the starter.
const allowedOrigin = "https://paetur.github.io";
const allowed = new Set([
  "get_invitation_v2", "get_household_food", "set_household_food_claim",
  "confirm_household_food", "submit_household_rsvp"
]);
const codePattern = /^[A-HJ-NP-Z2-9]{8}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Vary": "Origin",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
function reply(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, "0")).join("");
}
function requestValid(action: string, args: Record<string, unknown>) {
  const keys = Object.keys(args).sort().join(",");
  if (action === "get_invitation_v2" || action === "get_household_food" || action === "confirm_household_food") return keys === "p_code";
  if (action === "set_household_food_claim") {
    return (keys === "p_code,p_food_item_id,p_notes,p_quantity" || keys === "p_code,p_food_item_id,p_quantity")
      && typeof args.p_food_item_id === "string" && uuidPattern.test(args.p_food_item_id)
      && Number.isInteger(args.p_quantity) && (args.p_quantity as number) >= 0 && (args.p_quantity as number) <= 1000
      && (args.p_notes == null || (typeof args.p_notes === "string" && args.p_notes.length <= 500));
  }
  if (action === "submit_household_rsvp") {
    return keys === "p_code,p_request_id,p_responses"
      && typeof args.p_request_id === "string" && uuidPattern.test(args.p_request_id)
      && Array.isArray(args.p_responses) && args.p_responses.length <= 100
      && args.p_responses.every((x: unknown) => {
        if (!x || typeof x !== "object" || Array.isArray(x)) return false;
        const r = x as Record<string, unknown>;
        return Object.keys(r).sort().join(",") === "guest_id,session_id,status"
          && typeof r.guest_id === "string" && uuidPattern.test(r.guest_id)
          && typeof r.session_id === "string" && uuidPattern.test(r.session_id)
          && (r.status === "attending" || r.status === "declined");
      });
  }
  return false;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) return reply(403, { error: "Origin not allowed" });
  const len = Number(req.headers.get("content-length") || "0");
  if (len > 20000) return reply(413, { error: "Request too large" });
  try {
    const textBody = await req.text();
    if (textBody.length > 20000) return reply(413, { error: "Request too large" });
    const input = JSON.parse(textBody);
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply(400, { error: "Invalid request" });
    const { action, args } = input as { action?: string; args?: unknown };
    if (typeof action !== "string" || !allowed.has(action) || !args || typeof args !== "object" || Array.isArray(args)) return reply(400, { error: "Invalid action" });
    const params = args as Record<string, unknown>;
    if (typeof params.p_code !== "string" || !codePattern.test(params.p_code) || !requestValid(action, params)) return reply(400, { error: "Invalid request parameters" });
    // The gateway controls this header on the hosted edge. Use the final forwarded value,
    // which corresponds to the closest proxy; per-code and global limits backstop IP changes.
    const forwarded = req.headers.get("x-forwarded-for")?.split(",").map(x => x.trim()).filter(Boolean);
    const source = req.headers.get("x-real-ip") || forwarded?.[forwarded.length - 1] || req.headers.get("cf-connecting-ip") || "unknown";
    const ipHash = await sha256(source);
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0];
    if (!url || typeof serviceKey !== "string" || !serviceKey) return reply(503, { error: "Gateway not configured" });
    const headers = { "apikey": serviceKey, "Authorization": "Bearer " + serviceKey, "Content-Type": "application/json" };
    async function invoke(name: string, arguments_: Record<string, unknown>) {
      return fetch(url + "/rest/v1/rpc/" + name, {
        method: "POST", headers, body: JSON.stringify(arguments_), signal: AbortSignal.timeout(10000)
      });
    }
    const limited = await invoke("guest_gateway_allow_request", { p_ip_hash: ipHash, p_code: params.p_code, p_action: action });
    if (!limited.ok) return reply(503, { error: "Request validation unavailable" });
    if (await limited.json() !== true) return reply(429, { error: "Too many requests. Try again in a minute." });
    const result = await invoke(action === "get_invitation_v2" ? "get_invitation_logged" : action, params);
    if (!result.ok) {
      // Do not expose internal PostgreSQL errors to unauthenticated clients.
      const status = result.status === 401 || result.status === 403 ? 403 : result.status === 404 ? 404 : 400;
      return reply(status, { error: status === 403 ? "Access denied or event not published" : "Request could not be completed" });
    }
    const raw = await result.text();
    let value: unknown = null;
    if (raw) { try { value = JSON.parse(raw); } catch { return reply(502, { error: "Invalid response" }); } }
    return reply(200, value);
  } catch {
    return reply(503, { error: "Request temporarily unavailable" });
  }
});

