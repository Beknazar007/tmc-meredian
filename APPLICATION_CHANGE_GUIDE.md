# TMC Tracker - Full Application Guide

This document is the single source of truth for future maintenance and change requests.

Use it when you want to ask for updates like:
- "change login logic"
- "add new page"
- "fix mobile layout"
- "modify DB schema safely"

---

## 1) Project Summary

- **App name:** TMC Tracker (`tmc-tracker-v8`)
- **Type:** React + Vite single-page app
- **Deploy target:** Render (Docker + Nginx)
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions)
- **Main purpose:** Warehouse/TMC accounting with transfers, write-offs, admin tools, and Excel export.

---

## 2) Tech Stack

- **Frontend:** React 18, Vite 7
- **Data/API SDK:** `@supabase/supabase-js` v2
- **Export:** `xlsx`
- **Runtime:** Node 22 for build, Nginx for serving static bundle

Key files:
- `src/App.jsx` - main UI and business flows (currently monolithic)
- `src/state/useAppState.js` - cloud-first state layer
- `src/lib/repository.js` - Supabase read/write/RPC adapter
- `src/lib/supabase.js` - Supabase client and env resolution
- `src/features/layout/Topbar.jsx` - top navigation
- `src/features/auth/Login.jsx` - login screen
- `supabase/schema.sql` - DB schema, RLS, policies, RPC, storage setup
- `supabase/functions/create-user/index.ts` - Edge Function for admin user provisioning
- `render.yaml`, `Dockerfile`, `nginx.conf` - deployment/runtime config

---

## 3) Environment Variables

The app supports both Vite and Next-style names.

Primary:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Fallback:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Runtime behavior:
- Frontend reads values from `window.__RUNTIME_CONFIG__` (generated as `/runtime-env.js` at container start), then falls back to `import.meta.env`.

Related files:
- `index.html` (loads `/runtime-env.js`)
- `public/runtime-env.template.js`
- `Dockerfile` (`envsubst` generates `/runtime-env.js`)

---

## 4) Deployment Model (Render)

- Service uses Docker build from `Dockerfile`.
- Health endpoint: `/healthz`.
- Render must have required env vars configured in service settings.
- Because env is injected at runtime via `runtime-env.js`, it is resilient to typical Vite build-time env issues.

Recommended deploy flow:
1. Push to `main`
2. Deploy on Render
3. Hard refresh browser after deploy

---

## 5) Cloud/Data Architecture

The app now operates in **cloud-first / cloud-only** mode:
- No localStorage fallback as source of truth for core entities.
- UI writes are persisted to Supabase and reflected in state only on success.

Main tables:
- `tmc_users`
- `tmc_warehouses`
- `tmc_assets`
- `tmc_transfers`
- `tmc_categories`
- `tmc_sessions`
- `tmc_warehouse_responsibles`
- `tmc_asset_movements`

Storage:
- Bucket: `asset-photos` (public)
- Photo upload occurs in `repository.uploadPhotoIfNeeded()`

RPC functions (DB-side business logic):
- `tmc_request_transfer(p_transfer_id, p_payload)` — inserts `tmc_transfers` row with status `pending`, deducts `qty` from source asset (or flips single-unit asset to `В пути`), appends a history entry, and logs a row in `tmc_asset_movements`.
- `tmc_confirm_transfer(p_transfer_id, p_actor)` — flips transfer to `confirmed`, records `confirmed_by` / `confirmed_at`. For quantity assets: merges into an existing matching asset at the destination warehouse or creates a new asset. For single-unit assets: updates `warehouse_id`, `responsible_id`, and returns status to `На складе`. Appends history to the destination asset.
- `tmc_reject_transfer(p_transfer_id, p_actor, p_reason)` — **requires a reason**. Flips transfer to `rejected`, stores the reason in `tmc_transfers.reject_reason`. Returns the qty to the source asset (or flips single-unit asset back to `На складе`). Appends a history entry on the source asset with the reason in `notes`.
- `tmc_request_writeoff`
- `tmc_approve_writeoff`
- `tmc_reject_writeoff`
- `tmc_iso_now()` — helper returning ISO-8601 UTC timestamp string, used inside the transfer RPCs for consistent timestamps in both DB rows and embedded JSON history.

---

## 6) Authentication and User Provisioning

### Login flow
Implemented in `App.jsx` + `supabase.js`.
- Requires Supabase config.
- Uses `signInWithPassword`.
- Matches authenticated user against `tmc_users` by:
  - `auth_user_id`
  - `login`
  - authenticated email
- Auto-links `auth_user_id` on first successful login when possible.

### Admin user creation
Implemented via Edge Function:
- Function: `create-user`
- File: `supabase/functions/create-user/index.ts`
- Called by frontend in `repository.createUser()` via `supabase.functions.invoke("create-user")`
- Function creates:
  1. Supabase Auth user
  2. `tmc_users` profile row with linked `auth_user_id`
- Access control: only callers mapped to `tmc_users.role = 'admin'`.

### User ↔ warehouse assignment (many-to-many)
A user can be responsible for **multiple warehouses**. The source of truth is `tmc_warehouses.responsible_ids` (jsonb array of `tmc_users.id`). The trigger `trg_sync_warehouse_responsibles` keeps `tmc_warehouse_responsibles(warehouse_id, user_id)` in sync whenever a warehouse row is updated.
- `tmc_users.warehouse_id` stores the user's **primary** warehouse (first selected in UI) — used as the default `myWHid` filter for "my warehouse" views.
- UI: `UserAdmin` in `src/App.jsx` renders a checkbox list of warehouses. On save it:
  1. Updates the user profile (sets `warehouseId` = first checked warehouse or `null`).
  2. Calls `saveWarehouses()` once with all warehouse rows adjusted — adds/removes the user from each `responsibleIds` array to match the selection.
- Admin users are not listed on warehouses' `responsibleIds` (checkbox list is hidden when role = admin); they have implicit access to everything.

---

## 7) State Layer Contract (`useAppState`)

Exposed actions return success booleans where needed:
- `saveUsers`
- `saveWarehouses`
- `saveAssets`
- `saveTransfers`
- `saveCategories`
- `saveSession`

User-specific actions:
- `createUser`
- `updateUser`
- `deleteUser`

Important UI pattern:
- UI should `await` save actions and update/close modal only on success.

---

## 8) UI Pages and Main Flows

Top-level pages (driven by `page` state in `App.jsx`):
- `warehouses` - warehouse overview
- `warehouse` - warehouse detail + add TMC modal
- `asset` - asset detail + transfer/write-off actions
- `incoming` - incoming transfers
- `writeoffs` - pending write-off approvals
- `admin` - admin panel (warehouses/users/categories)
- `waybill` - transfer **Акт приёма-передачи** view (print-ready)
- `export` - Excel exports

### Add TMC flow
- Trigger: `+ Добавить ТМЦ` in `WarehouseView`.
- Form component: `AddAssetForm`.
- Save behavior:
  - shows loading state (`Сохранение...`)
  - waits for cloud save result
  - closes modal only when save succeeds.

### Transfer flow + Акт приёма-передачи

The transfer process is the core lifecycle event for an asset. Every transfer has an **Акт приёма-передачи** (transfer-acceptance act) that can be viewed and printed at any stage.

**Lifecycle:**
1. **Request** — source warehouse responsible (or admin) initiates transfer from `AssetDetail` via "Передать ТМЦ".
   - RPC: `tmc_request_transfer`.
   - Effect: transfer row created with `status='pending'`; source asset has its `qty` deducted (or, for single-unit assets, status set to `В пути`).
2. **Confirm / Reject** — **only** the user named in `tmc_transfers.to_responsible_id` can act. Admins are observers only: they see the transfer but have no Подтвердить/Отклонить buttons. Both RPCs enforce the same rule server-side via `auth.uid()` → `tmc_users.auth_user_id`; admins calling the RPC directly are rejected with "Администратор только наблюдает."
   - Confirm → RPC `tmc_confirm_transfer`. Asset is actually moved/merged to the destination warehouse. UI shows a `window.confirm` asking "Подтвердить получение ...?" before invoking the RPC.
   - Reject → RPC `tmc_reject_transfer`. UI first prompts for a reason via `window.prompt`, then shows a second `window.confirm` summarizing the transfer and reason. The reason is **required** and is stored in `tmc_transfers.reject_reason`. Source asset is restored.
   - When creating a transfer, the «Ответственный получателя» dropdown lists only users that appear in `tmc_warehouses.responsible_ids` of the destination warehouse — you cannot route a transfer to someone who isn't responsible there.
3. **Act** — available at all three stages. Button `Акт` navigates to the `waybill` page (`WaybillPage` in `App.jsx`).

**Act (`WaybillPage`) contents:**
- Header: `АКТ ПРИЁМА-ПЕРЕДАЧИ` + transfer №.
- Status badge: `Ожидает подтверждения` / `Подтверждён` / `Отклонён`.
- Sections:
  - Предмет передачи — asset name, inv. number, category, quantity.
  - Передающая сторона — source warehouse, source responsible, initiator + timestamp.
  - Принимающая сторона — destination warehouse, destination responsible; plus `Подтвердил` or `Отклонил` (with reason) depending on final status.
  - Примечание (if present).
- Print button opens a formal A4-style print template with signature blocks (`Сдал` / `Принял`).

**Where the act button appears:**
- `AssetDetail` → incoming pending transfer card (button `Акт`).
- `AssetDetail` → "Журнал передач" card (every transfer for the asset, with status chip and `Акт` button — accessible after confirm/reject as well).
- `IncomingPage` → each pending transfer card (button `Акт`).

**When editing the transfer flow, always update:**
1. `supabase/schema.sql` — RPC bodies and any new columns on `tmc_transfers`.
2. `src/lib/repository.js` — `toTransferRow` / `fromTransferRow` mappings and RPC wrappers (`rpcRequestTransfer`, `rpcConfirmTransfer`, `rpcRejectTransfer`).
3. `src/App.jsx` — request/confirm/reject UI (in `AssetDetail` and `IncomingPage`) and the `WaybillPage` template (both the in-app view and the print popup).
4. Run the SQL migration live (or redeploy the full `schema.sql`) before shipping frontend changes that rely on new fields/params.

---

## 9) Responsive Behavior (Current)

Recent improvements:
- Add TMC modal is scroll-safe for small screens.
- Action buttons in Add TMC are now flexible (not fixed/sticky) and wrap naturally.
- Several grids are adaptive (`auto-fit/minmax`) for phone layouts.
- Modal overlay supports vertical scrolling.

If mobile issue appears:
1. Check inline styles in `App.jsx` near the affected section.
2. Prefer `repeat(auto-fit, minmax(...))` over fixed multi-column grids.
3. Avoid fixed heights/positions for critical controls on phones.

---

## 10) Database Safety Rules in Schema

`supabase/schema.sql` includes protections:
- Default category baseline seeding.
- Trigger `tmc_prevent_last_category_delete` to prevent deleting the final category.
- RLS and grants for app roles.
- Storage setup and policies for `asset-photos`.

When changing schema:
- Keep changes idempotent (`if not exists`, `on conflict`, safe `drop ... if exists`).
- Avoid breaking existing RLS/policies.

---

## 11) Edge Function Deployment

Function currently used:
- `create-user`

Deploy:
```bash
npx supabase link --project-ref <project-ref>
npx supabase functions deploy create-user
```

Required function env:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 12) Known Operational Notes

- Login errors `Invalid login credentials` usually mean Auth user/password mismatch, not UI issue.
- If a user exists in `tmc_users` but cannot login, ensure corresponding Auth user exists and `auth_user_id` is linked.
- Render logs mostly show Nginx/container health; browser-side Supabase errors must be checked via browser console/network or Supabase logs.

---

## 13) Recommended Change Workflow

1. **Clarify scope** (UI only, DB only, auth, deployment).
2. **Identify impacted files** from this guide.
3. **Implement smallest safe change**.
4. **Run checks**:
   - `npm run build`
5. **If DB/Function changed**, deploy/apply in Supabase.
6. **Push to `main`** and deploy Render.
7. **Verify in browser** (desktop + phone).

---

## 14) Request Template for Future Changes

Copy/paste this when asking for changes:

```md
Goal:
<what should be different>

Scope:
- UI pages: <list>
- Backend: <db/rpc/function/none>
- Deployment: <yes/no>

Acceptance criteria:
1. ...
2. ...
3. ...

Constraints:
- Do not change: ...
- Must keep: ...

Test cases:
- Case 1: ...
- Case 2: ...
```

---

## 15) File Map (Quick Reference)

- App shell + pages: `src/App.jsx`
- Auth UI: `src/features/auth/Login.jsx`
- Top navigation: `src/features/layout/Topbar.jsx`
- Supabase client/env: `src/lib/supabase.js`
- Data access layer: `src/lib/repository.js`
- State/actions: `src/state/useAppState.js`
- Entry + global styles: `src/main.jsx`, `src/styles.css`
- DB schema/RLS/RPC: `supabase/schema.sql`
- User creation function: `supabase/functions/create-user/index.ts`
- Deploy config: `render.yaml`, `Dockerfile`, `nginx.conf`

