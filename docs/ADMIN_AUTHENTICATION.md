# Administrator request authentication

A production Safari request was observed sending the publishable API key as its Authorization credential for `admin_save_household`, resulting in an anonymous-role 401/42501. Database role grants were already correct. SQL role tests alone did not reproduce this request-header failure.

All admin RPCs now use `adminRpc`, which obtains the session token and explicitly supplies `Authorization: Bearer <access_token>` alongside the public `apikey` header. Missing sessions never fall back to anonymous admin requests. Authentication rejection permits one refresh and retry. Business-validation failures are not retried. The database still verifies the signed token and administrator membership; there are no broader grants or exposed privileged keys.

Guest lookups retain their rate-limited gateway route. Direct `get_invitation_v2` access remains denied by design and is exercised by the release smoke test.

Admin notices display local HH:mm:ss, with the full UTC timestamp in the time element, and dismiss after five seconds. A replacement notice resets the timer.

Verification includes request-header unit tests, real pinned Supabase SDK login/refresh in Chromium and WebKit using synthetic servers, and the existing admin workflow tests. No real user passwords or session tokens are used in tests.
