import { hasSupabaseConfig, supabase } from "./supabase";

const TABLES = {
  users: "tmc_users",
  warehouses: "tmc_warehouses",
  assets: "tmc_assets",
  transfers: "tmc_transfers",
  categories: "tmc_categories",
};

const STORAGE_BUCKET = "asset-photos";
const MIGRATION_FLAG = "tmc_cloud_migrated_v1";

const GENERIC_EDGE_FN_MSG = /edge function returned a non-2xx status code/i;

/**
 * On HTTP 4xx/5xx, Supabase often sets `data` to null; the real `{ error: "..." }` is only
 * readable from `error.context` (Response). See: supabase.com/docs/guides/functions/error-handling
 */
async function detailFromFunctionsInvokeError(data, error) {
  if (!error) return "";
  if (data && typeof data === "object" && data.error != null) {
    return String(data.error);
  }
  if (typeof data === "string" && data.trim()) {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object" && parsed.error != null) {
        return String(parsed.error);
      }
    } catch {
      // ignore
    }
  }
  const ctx = error?.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const raw = await ctx.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && parsed.error != null) {
            return String(parsed.error);
          }
        } catch {
          return raw.trim();
        }
      }
    } catch {
      // context may be unusable
    }
  }
  const m = String(error.message || "").trim();
  if (m && !GENERIC_EDGE_FN_MSG.test(m)) {
    return m;
  }
  if (GENERIC_EDGE_FN_MSG.test(m) || !m) {
    return "Сервер отклонил запрос (Edge Function). Часто это: логин/email уже занят, пароль короче 6 символов, нет прав администратора, или не задеплоена функция. Откройте логи «create-user» в Supabase, если проблема повторяется.";
  }
  return m;
}

/**
 * Text inputs often yield `""`; Postgres `numeric` / `date` reject empty strings.
 */
function nullIfBlankNum(value) {
  if (value === null || value === undefined) return null;
  if (value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const t = String(value).trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (Number.isNaN(n) || !Number.isFinite(n)) return null;
  return n;
}

function nullIfBlankDate(value) {
  if (value === null || value === undefined) return null;
  if (value === "") return null;
  return value;
}

function nullableId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

function nullableUuid(value) {
  const normalized = nullableId(value);
  if (normalized === null) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(String(normalized)) ? normalized : null;
}

function toUserRow(user) {
  return {
    id: user.id,
    auth_user_id: nullableUuid(user.authUserId ?? user.auth_user_id),
    name: user.name,
    login: user.login,
    password: user.password ?? null,
    role: user.role,
    warehouse_id: nullableId(user.warehouseId ?? user.warehouse_id),
  };
}

function fromUserRow(u) {
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    role: u.role,
    password: u.password ?? null,
    warehouseId: u.warehouse_id,
    authUserId: u.auth_user_id || null,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

function normalizeResponsibleIdArray(warehouse) {
  const raw = warehouse.responsible_ids ?? warehouse.responsibleIds ?? [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))].sort();
}

function toWarehouseRow(warehouse) {
  return {
    id: warehouse.id,
    name: warehouse.name,
    responsible_ids: normalizeResponsibleIdArray(warehouse),
    responsible_id: nullableId(warehouse.responsible_id ?? warehouse.responsibleId),
  };
}

function toTransferRow(transfer) {
  return {
    id: transfer.id,
    no: transfer.no ?? null,
    asset_id: nullableId(transfer.assetId ?? transfer.asset_id),
    asset_name: transfer.assetName ?? transfer.asset_name ?? null,
    from_wh_id: nullableId(transfer.fromWhId ?? transfer.from_wh_id),
    from_wh_name: transfer.fromWhName ?? transfer.from_wh_name ?? null,
    to_wh_id: nullableId(transfer.toWhId ?? transfer.to_wh_id),
    to_wh_name: transfer.toWhName ?? transfer.to_wh_name ?? null,
    from_responsible_id: nullableId(transfer.fromResponsibleId ?? transfer.from_responsible_id),
    from_responsible_name: transfer.fromResponsibleName ?? transfer.from_responsible_name ?? null,
    to_responsible_id: nullableId(transfer.toResponsibleId ?? transfer.to_responsible_id),
    to_responsible_name: transfer.toResponsibleName ?? transfer.to_responsible_name ?? null,
    notes: transfer.notes ?? null,
    status: transfer.status ?? "pending",
    created_by: transfer.createdBy ?? transfer.created_by ?? null,
    qty: transfer.qty ?? null,
    unit: transfer.unit ?? null,
    confirmed_at: transfer.confirmedAt ?? transfer.confirmed_at ?? null,
    confirmed_by: transfer.confirmedBy ?? transfer.confirmed_by ?? null,
    reject_reason: transfer.rejectReason ?? transfer.reject_reason ?? null,
  };
}

function toAssetRow(asset, photoOverride) {
  const photo = photoOverride ?? asset.photo ?? null;
  const minRaw = nullIfBlankNum(asset.minQty ?? asset.min_qty);
  return {
    id: asset.id,
    name: asset.name,
    category: asset.category ?? null,
    supplier: asset.supplier ?? null,
    purchase_date: nullIfBlankDate(asset.purchaseDate ?? asset.purchase_date),
    price: nullIfBlankNum(asset.price),
    responsible_id: nullableId(asset.responsibleId ?? asset.responsible_id),
    notes: asset.notes ?? null,
    photo,
    unit: asset.unit ?? null,
    qty: nullIfBlankNum(asset.qty),
    min_qty: minRaw === null ? 0 : minRaw,
    initial_qty: nullIfBlankNum(asset.initialQty ?? asset.initial_qty),
    warehouse_id: nullableId(asset.warehouseId ?? asset.warehouse_id),
    status: asset.status ?? "На складе",
    history: asset.history ?? [],
    pending_woqty: nullIfBlankNum(asset.pendingWOqty ?? asset.pending_woqty),
  };
}

function ensureConfigured() {
  if (!hasSupabaseConfig || !supabase) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)."
    );
  }
}

function assertConfiguredAndClient() {
  ensureConfigured();
  return supabase;
}

function toBlob(dataUrl) {
  return fetch(dataUrl).then((r) => r.blob());
}

function getExtFromMime(mime) {
  if (!mime) return "png";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

async function uploadPhotoIfNeeded(asset) {
  if (!asset?.photo || !asset.photo.startsWith("data:")) return asset;
  const mime = asset.photo.slice(5, asset.photo.indexOf(";"));
  const ext = getExtFromMime(mime);
  const blob = await toBlob(asset.photo);
  const path = `${asset.id}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type || mime || "image/png",
  });
  if (error) throw error;

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { ...asset, photo: data.publicUrl };
}

async function upsertRows(table, rows) {
  if (!rows?.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

async function deleteRowsById(table, ids) {
  if (!ids?.length) return;
  const { error } = await supabase.from(table).delete().in("id", ids);
  if (error) throw error;
}

async function replaceTable(table, rows) {
  const nextRows = rows || [];
  const nextIds = nextRows.map((r) => r.id);
  await upsertRows(table, nextRows);
  const { data, error } = await supabase.from(table).select("id");
  if (error) throw error;
  const cloudIds = (data || []).map((d) => d.id);
  const toDelete = cloudIds.filter((id) => !nextIds.includes(id));
  if (toDelete.length) {
    const { error: delError } = await supabase.from(table).delete().in("id", toDelete);
    if (delError) throw delError;
  }
}

/**
 * Applies a row-level diff: upserts `upsertRows` and deletes ids in `deleteIds`.
 * Unlike replaceTable, does NOT delete rows based on "not in next set" — so
 * concurrent inserts by other users aren't lost.
 */
async function applyRowDiff(table, upsertRowsList, deleteIdsList) {
  if (upsertRowsList?.length) {
    await upsertRows(table, upsertRowsList);
  }
  if (deleteIdsList?.length) {
    await deleteRowsById(table, deleteIdsList);
  }
}

function diffById(prevList, nextList, { compareRow } = {}) {
  const prev = Array.isArray(prevList) ? prevList : [];
  const next = Array.isArray(nextList) ? nextList : [];
  const prevMap = new Map(prev.map((r) => [r.id, r]));
  const nextIds = new Set(next.map((r) => r.id));

  const toUpsert = [];
  next.forEach((row) => {
    const prevRow = prevMap.get(row.id);
    if (!prevRow) {
      toUpsert.push(row);
      return;
    }
    if (compareRow) {
      if (!compareRow(prevRow, row)) toUpsert.push(row);
    } else {
      if (JSON.stringify(prevRow) !== JSON.stringify(row)) toUpsert.push(row);
    }
  });

  const toDelete = [];
  prev.forEach((row) => {
    if (!nextIds.has(row.id)) toDelete.push(row.id);
  });

  return { toUpsert, toDelete };
}

async function readTable(table, orderBy = "id") {
  const { data, error } = await supabase.from(table).select("*").order(orderBy, { ascending: true });
  if (error) throw error;
  return data || [];
}

function fromWarehouseRow(w) {
  return {
    id: w.id,
    name: w.name,
    responsibleIds: w.responsible_ids || [],
    responsibleId: w.responsible_id || null,
    created_at: w.created_at,
    updated_at: w.updated_at,
  };
}

function fromAssetRow(a) {
  return {
    ...a,
    warehouseId: a.warehouse_id,
    responsibleId: a.responsible_id,
    purchaseDate: a.purchase_date || a.purchaseDate,
    price: a.price,
    minQty: a.min_qty ?? a.minQty,
    initialQty: a.initial_qty ?? a.initialQty,
    qty: a.qty,
    pendingWOqty: a.pending_woqty ?? a.pendingWOqty,
  };
}

function fromTransferRow(t) {
  return {
    ...t,
    assetId: t.asset_id,
    assetName: t.asset_name,
    fromWhId: t.from_wh_id,
    fromWhName: t.from_wh_name,
    toWhId: t.to_wh_id,
    toWhName: t.to_wh_name,
    fromResponsibleId: t.from_responsible_id,
    fromResponsibleName: t.from_responsible_name,
    toResponsibleId: t.to_responsible_id,
    toResponsibleName: t.to_responsible_name,
    createdAt: t.created_at,
    createdBy: t.created_by,
    confirmedAt: t.confirmed_at,
    confirmedBy: t.confirmed_by,
    rejectReason: t.reject_reason ?? null,
  };
}

export async function loadUsersSlice() {
  assertConfiguredAndClient();
  const rows = await readTable(TABLES.users);
  return rows.map(fromUserRow);
}

export async function loadWarehousesSlice() {
  assertConfiguredAndClient();
  const rows = await readTable(TABLES.warehouses);
  return rows.map(fromWarehouseRow);
}

export async function loadAssetsSlice() {
  assertConfiguredAndClient();
  const rows = await readTable(TABLES.assets);
  return rows.map(fromAssetRow);
}

export async function loadTransfersSlice() {
  assertConfiguredAndClient();
  const rows = await readTable(TABLES.transfers, "created_at");
  return rows.map(fromTransferRow);
}

export async function loadCategoriesSlice() {
  assertConfiguredAndClient();
  const rows = await readTable(TABLES.categories);
  return rows.map((c) => c.name);
}

export async function loadCloudState() {
  assertConfiguredAndClient();
  const [users, warehouses, assets, transfers, categories] = await Promise.all([
    loadUsersSlice(),
    loadWarehousesSlice(),
    loadAssetsSlice(),
    loadTransfersSlice(),
    loadCategoriesSlice(),
  ]);

  return {
    users,
    warehouses,
    assets,
    transfers,
    categories,
  };
}

export const CLOUD_TABLES = TABLES;

export async function migrateLocalToCloud(local) {
  assertConfiguredAndClient();
  const done = localStorage.getItem(MIGRATION_FLAG);
  if (done === "1") return;

  const { count, error } = await supabase.from(TABLES.users).select("*", { count: "exact", head: true });
  if (error) throw error;
  if ((count || 0) > 0) {
    localStorage.setItem(MIGRATION_FLAG, "1");
    return;
  }

  const categories = (local.categories || []).map((name) => ({ id: `cat-${name}`, name }));
  const users = (local.users || []).map(toUserRow);
  const warehouses = (local.warehouses || []).map(toWarehouseRow);
  const assets = await Promise.all(
    (local.assets || []).map(async (a) => {
      const withPhoto = await uploadPhotoIfNeeded(a);
      return toAssetRow(withPhoto, withPhoto.photo);
    })
  );
  const transfers = (local.transfers || []).map(toTransferRow);

  await Promise.all([
    upsertRows(TABLES.categories, categories),
    upsertRows(TABLES.users, users),
    upsertRows(TABLES.warehouses, warehouses),
    upsertRows(TABLES.assets, assets),
    upsertRows(TABLES.transfers, transfers),
  ]);

  if (local.session) {
    await saveSession(local.session);
  }

  localStorage.setItem(MIGRATION_FLAG, "1");
}

export async function saveUsers(nextList, prevList) {
  assertConfiguredAndClient();
  const nextRows = (nextList || []).map(toUserRow);
  const prevRows = (prevList || []).map(toUserRow);
  const { toUpsert, toDelete } = diffById(prevRows, nextRows);
  await applyRowDiff(TABLES.users, toUpsert, toDelete);
}

export async function createUser(user) {
  assertConfiguredAndClient();
  const login = String(user.login || "").trim().toLowerCase();
  const password = String(user.password || "").trim();
  if (!login || !password) {
    throw new Error("Для создания пользователя нужны login и пароль.");
  }

  const { data, error } = await supabase.functions.invoke("create-user", {
    body: {
      id: user.id,
      name: user.name,
      login,
      password,
      role: user.role || "user",
      warehouseId: user.warehouseId || null,
      authUserId: user.authUserId || null,
    },
  });
  if (error) {
    const msg = await detailFromFunctionsInvokeError(data, error);
    throw new Error(msg || "Не удалось вызвать create-user.");
  }
  if (!data?.user) {
    throw new Error(data?.error || "Не удалось создать пользователя через Edge Function.");
  }
  return data.user;
}

export async function updateUser(userId, patch) {
  assertConfiguredAndClient();
  const row = toUserRow({ id: userId, ...patch });
  const { id: _id, ...updateRow } = row;
  const { error } = await supabase.from(TABLES.users).update(updateRow).eq("id", userId);
  if (error) throw error;
}

export async function deleteUser(userId) {
  assertConfiguredAndClient();
  const { data, error } = await supabase.functions.invoke("delete-user", {
    body: { userId },
  });
  if (error) {
    const msg = await detailFromFunctionsInvokeError(data, error);
    throw new Error(msg || "Не удалось вызвать delete-user.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function resetUserPassword(userId, password) {
  assertConfiguredAndClient();
  const { data, error } = await supabase.functions.invoke("reset-password", {
    body: { userId, password },
  });
  if (error) {
    const msg = await detailFromFunctionsInvokeError(data, error);
    throw new Error(msg || "Не удалось вызвать reset-password.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function updateUserRole({ userId, role, warehouseId, name }) {
  assertConfiguredAndClient();
  const body = { userId, role };
  if (warehouseId !== undefined) body.warehouseId = warehouseId;
  if (name !== undefined) body.name = name;
  const { data, error } = await supabase.functions.invoke("update-user-role", {
    body,
  });
  if (error) {
    const msg = await detailFromFunctionsInvokeError(data, error);
    throw new Error(msg || "Не удалось вызвать update-user-role.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function saveWarehouses(nextList, prevList) {
  assertConfiguredAndClient();
  const nextRows = (nextList || []).map(toWarehouseRow);
  const prevRows = (prevList || []).map(toWarehouseRow);
  const { toUpsert, toDelete } = diffById(prevRows, nextRows);
  await applyRowDiff(TABLES.warehouses, toUpsert, toDelete);
}

export async function saveAssets(nextList, prevList) {
  assertConfiguredAndClient();
  const prevRows = (prevList || []).map((a) => toAssetRow(a, a?.photo ?? null));
  const nextRows = await Promise.all(
    (nextList || []).map(async (a) => {
      const withPhoto = await uploadPhotoIfNeeded(a);
      return toAssetRow(withPhoto, withPhoto.photo);
    })
  );
  const { toUpsert, toDelete } = diffById(prevRows, nextRows);
  await applyRowDiff(TABLES.assets, toUpsert, toDelete);
}

export async function saveTransfers(nextList, prevList) {
  assertConfiguredAndClient();
  const nextRows = (nextList || []).map(toTransferRow);
  const prevRows = (prevList || []).map(toTransferRow);
  const { toUpsert, toDelete } = diffById(prevRows, nextRows);
  await applyRowDiff(TABLES.transfers, toUpsert, toDelete);
}

export async function saveCategories(nextList, prevList) {
  assertConfiguredAndClient();
  const nextRows = (nextList || []).map((name) => ({ id: `cat-${name}`, name }));
  const prevRows = (prevList || []).map((name) => ({ id: `cat-${name}`, name }));
  const { toUpsert, toDelete } = diffById(prevRows, nextRows, {
    compareRow: (a, b) => a.name === b.name,
  });
  await applyRowDiff(TABLES.categories, toUpsert, toDelete);
}

export async function saveSession(session) {
  // Session persistence is handled by Supabase Auth per device.
  // Kept as noop for compatibility with existing call sites.
  void session;
}

async function callRpc(name, params) {
  assertConfiguredAndClient();
  const { error } = await supabase.rpc(name, params);
  if (error) throw error;
  return loadCloudState();
}

export async function rpcRequestTransfer(input) {
  return callRpc("tmc_request_transfer", {
    p_transfer_id: input.id,
    p_transfer_no: input.no,
    p_asset_id: input.assetId,
    p_asset_name: input.assetName,
    p_from_wh_id: input.fromWhId,
    p_from_wh_name: input.fromWhName,
    p_to_wh_id: input.toWhId,
    p_to_wh_name: input.toWhName,
    p_from_responsible_id: input.fromResponsibleId,
    p_from_responsible_name: input.fromResponsibleName,
    p_to_responsible_id: input.toResponsibleId,
    p_to_responsible_name: input.toResponsibleName,
    p_qty: input.qty,
    p_unit: input.unit,
    p_notes: input.notes,
    p_actor: input.actor,
  });
}

export async function rpcConfirmTransfer(transferId, actor) {
  return callRpc("tmc_confirm_transfer", {
    p_transfer_id: transferId,
    p_actor: actor,
  });
}

export async function rpcRejectTransfer(transferId, actor, reason) {
  return callRpc("tmc_reject_transfer", {
    p_transfer_id: transferId,
    p_actor: actor,
    p_reason: reason,
  });
}

export async function rpcRequestWriteoff(assetId, qty, notes, actor) {
  return callRpc("tmc_request_writeoff", {
    p_asset_id: assetId,
    p_qty: qty,
    p_notes: notes,
    p_actor: actor,
  });
}

export async function rpcApproveWriteoff(assetId, qty, notes, actor) {
  return callRpc("tmc_approve_writeoff", {
    p_asset_id: assetId,
    p_qty: qty,
    p_notes: notes,
    p_actor: actor,
  });
}

export async function rpcRejectWriteoff(assetId, actor) {
  return callRpc("tmc_reject_writeoff", {
    p_asset_id: assetId,
    p_actor: actor,
  });
}
