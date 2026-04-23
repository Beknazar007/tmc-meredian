# tmc-meredian

## Cloud setup (Supabase)

1. Create a Supabase project.
2. In SQL editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. Create Storage bucket named `asset-photos` (public).
4. Configure Supabase Auth users (email/password) for each operator.
5. Ensure `public.tmc_users.login` matches auth email and optionally set `auth_user_id` to `auth.users.id`.
6. Copy `.env.example` to `.env` and fill:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
7. Deploy Edge Functions used for admin user management:
   - `supabase functions deploy create-user`
   - `supabase functions deploy delete-user`
   - `supabase functions deploy reset-password`
   - `supabase functions deploy update-user-role`
   - `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` (SUPABASE_URL is auto-provided)

On first app startup, local browser data is migrated to Supabase once, then cloud is the source of truth.

### Supabase DB preparation for cloud

1. In Supabase SQL editor, run `supabase/schema.sql`.
2. (Optional for demo users) run `supabase/seed_default_users.sql`.
3. In Supabase Storage create a **public** bucket: `asset-photos`.
4. Verify Auth users exist and `public.tmc_users.auth_user_id` is linked to `auth.users.id`.
5. Deploy Edge Functions from `supabase/functions/`:
   - `create-user`
   - `delete-user`
   - `reset-password`
   - `update-user-role`

### Realtime

`supabase/schema.sql` automatically adds `tmc_users`, `tmc_warehouses`, `tmc_assets`, `tmc_transfers`, `tmc_categories` to the `supabase_realtime` publication, so the frontend receives live updates instead of 15s polling. No extra configuration is needed — run the schema once.

## Run

```bash
npm install
npm run dev
```

## Deploy to Render

1. Push this repository to GitHub.
2. In Render create a new **Blueprint** service from this repo (uses `render.yaml`).
3. Set required env vars in Render:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy and verify health endpoint `/healthz`.

## Verification checklist

1. `npm run build` passes.
2. Login succeeds with a Supabase Auth user and mapped `tmc_users` profile.
3. Transfer and writeoff operations work from UI and update cloud state.
4. `supabase/schema.sql` applies without errors and creates RLS policies, indexes, and RPC functions.
5. Container health endpoint responds: `GET /healthz`.
