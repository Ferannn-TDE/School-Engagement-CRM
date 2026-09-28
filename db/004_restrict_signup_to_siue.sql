-- 004 — Only allow @siue.edu email addresses to create an account (server-side)
--
-- Why: the sign-up page checks for @siue.edu in the browser (SignUpPage.tsx), but anyone
-- can call the Supabase sign-up API directly with the public key and skip that check.
-- testuser1@gmail.com was created exactly that way. This hook runs inside Supabase Auth
-- before any account is created, so it cannot be skipped from the browser. The browser
-- check stays as a friendly early message; this is the real gate.
--
-- It covers every way an account gets created, including dashboard invites and admin
-- calls, so a non-SIUE address cannot be invited either.
--
-- Accepted for now (see CURRENT_STATE.md): any @siue.edu address can sign up, enrol an
-- authenticator, reach aal2 and read all the data. There is no access tier yet.
--
-- After running this file, the hook must also be switched on in the dashboard:
--   Authentication -> Hooks -> "Before User Created" -> Postgres -> public.hook_restrict_signup_to_siue
-- Running the SQL alone does nothing until that switch is on.
--
-- Reversible: turn the hook off in the dashboard, then drop the function.

begin;

create or replace function public.hook_restrict_signup_to_siue(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  email text := lower(trim(event -> 'user' ->> 'email'));
begin
  -- Exact domain only: rejects look-alikes such as @siue.edu.example.com and
  -- @notsiue.edu, and rejects sign-ups with no email at all (e.g. phone).
  if email is null or email !~ '^[^@]+@siue\.edu$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Only @siue.edu email addresses can sign up.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

-- Only Supabase Auth may call it. Without these revokes it would also be callable
-- through the public API as /rest/v1/rpc/hook_restrict_signup_to_siue.
grant execute on function public.hook_restrict_signup_to_siue(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_to_siue(jsonb) from public, anon, authenticated;

commit;


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- TEST 1 — the function's decisions, without creating anyone. Expect:
--   allowed@siue.edu            -> {}
--   Mixed.Case@SIUE.EDU         -> {}
--   testuser1@gmail.com         -> error 403
--   x@siue.edu.example.com      -> error 403
--   x@notsiue.edu               -> error 403
--   (no email)                  -> error 403
/*
select e, public.hook_restrict_signup_to_siue(jsonb_build_object('user', jsonb_build_object('email', e)))
from unnest(array['allowed@siue.edu', 'Mixed.Case@SIUE.EDU', 'testuser1@gmail.com',
                  'x@siue.edu.example.com', 'x@notsiue.edu', null]) as e;
*/

-- TEST 2 — the real bypass path, after the dashboard switch is on. From a terminal,
-- with the public key, a non-SIUE sign-up must be refused before any account exists:
--   curl -s -X POST "$VITE_SUPABASE_URL/auth/v1/signup" \
--     -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
--     -d '{"email":"hook-probe@example.com","password":"<random>"}'
-- Expect a 403 carrying the message above, and no hook-probe row in auth.users.

-- TEST 3 — the function is not reachable through the public API. Expect 401/404:
--   curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/hook_restrict_signup_to_siue" \
--     -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"event":{}}'
