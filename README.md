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

On first app startup, local browser data is migrated to Supabase once, then cloud is the source of truth.

### Supabase DB preparation for cloud

1. In Supabase SQL editor, run `supabase/schema.sql`.
2. (Optional for demo users) run `supabase/seed_default_users.sql`.
3. In Supabase Storage create a **public** bucket: `asset-photos`.
4. Verify Auth users exist and `public.tmc_users.auth_user_id` is linked to `auth.users.id`.

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
