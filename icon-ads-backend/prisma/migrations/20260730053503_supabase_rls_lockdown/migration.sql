-- Supabase security lockdown.
--
-- Context: this project never uses Supabase's PostgREST/data API or Supabase
-- Auth (auth.users is empty). ALL application reads/writes to Postgres go
-- through this backend's Prisma connection (DATABASE_URL/DIRECT_URL), which
-- authenticates as the table-owning role (normally `postgres` on Supabase),
-- not as `anon`/`authenticated`. The only legitimate use of the Supabase
-- anon key anywhere in the codebase is Supabase *Storage* (file uploads),
-- which is a separate subsystem unaffected by anything in this file.
--
-- That means `anon`/`authenticated` have zero legitimate reason to touch any
-- table in this database. This migration enables Row Level Security with no
-- permissive policies (default-deny) on every table, and revokes their
-- table/sequence grants outright as a second, independent layer — either one
-- alone would close the hole; both together mean a mistake in one layer
-- (e.g. someone re-granting privileges later) doesn't reopen it.
--
-- IMPORTANT: this uses ENABLE ROW LEVEL SECURITY, not FORCE ROW LEVEL
-- SECURITY. The table owner (the role in DATABASE_URL, i.e. Prisma) always
-- bypasses RLS — that's what keeps the app working. Do not add
-- FORCE ROW LEVEL SECURITY here; it would also apply RLS to the owner and
-- break every Prisma query on these tables unless a matching policy is
-- added for that role too.

-- ============================================================
-- 1. Move the two most sensitive tables out of the public schema.
--    Neither is ever queried through Supabase's data API (confirmed by
--    grep across icon-ads-web/icon-ads-android: zero PostgREST usage
--    anywhere), only through Prisma. ALTER ... SET SCHEMA preserves all
--    data, indexes, constraints and sequences in place.
-- ============================================================
CREATE SCHEMA IF NOT EXISTS "private";

ALTER TABLE "public"."users" SET SCHEMA "private";
ALTER TABLE "public"."api_keys" SET SCHEMA "private";

-- Prevent anon/authenticated from even seeing that this schema exists.
REVOKE ALL ON SCHEMA "private" FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. Enable RLS with zero policies (default-deny) on every table in
--    both schemas. Table owner (Prisma's role) is unaffected.
-- ============================================================
ALTER TABLE "private"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "private"."api_keys" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."campaign_clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."playlists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."playlist_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."playlist_ads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tablet_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tablets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sync_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tablet_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."system_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."error_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."admin_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."campaign_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ab_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."driver_points" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."zones" ENABLE ROW LEVEL SECURITY;
-- NOTE: "surveys", "survey_answers" and "tablet_locations" are NOT handled
-- here. They aren't modeled in schema.prisma — src/lib/startup-migrate.js
-- creates them with raw CREATE TABLE IF NOT EXISTS at app boot, which runs
-- *after* Prisma migrations. Naming them here with ALTER TABLE would fail
-- on any environment where this migration runs before that first boot (a
-- fresh DB). Their RLS is enabled from startup-migrate.js itself, right
-- after their CREATE TABLE, so it's applied idempotently in the same place
-- and order that already creates them. The REVOKE ALL below still covers
-- them today (they already exist in production), and the DEFAULT PRIVILEGES
-- change further down covers them automatically if they don't exist yet.

-- ============================================================
-- 3. Revoke anon/authenticated table & sequence privileges outright
--    (covers SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER —
--    explicitly including the DELETE/TRUNCATE access requested to be
--    closed). Independent of the RLS layer above.
-- ============================================================
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM anon, authenticated;

-- ============================================================
-- 4. Make the lockdown stick for tables/sequences created by future
--    migrations, not just the ones that exist today. Applies to
--    whatever role runs this migration (Prisma's DATABASE_URL role,
--    normally `postgres` on Supabase) since no FOR ROLE is given.
-- ============================================================
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "private" REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "private" REVOKE ALL ON SEQUENCES FROM anon, authenticated;
