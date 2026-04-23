import { hasSupabaseConfig, supabase } from "./supabase";

const TABLES = {
  users: "tmc_users",
  warehouses: "tmc_warehouses",
  assets: "tmc_assets",
  transfers: "tmc_transfers",
  categories: "tmc_categories",
  sessions: "tmc_sessions",
};

const STORAGE_BUCKET = "asset-photos";
const MIGRATION_FLAG = "tmc_cloud_migrated_v1";

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

function toWarehouseRow(warehouse) {
  return {
    id: warehouse.id,
    name: warehouse.name,
    responsible_ids: warehouse.responsible_ids ?? warehouse.responsibleIds ?? [],
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
  };
}

function toAssetRow(asset, photoOverride) {
  const photo = photoOverride ?? asset.photo ?? null;
  return {
    id: asset.id,
    name: asset.name,
    category: asset.category ?? null,
    supplier: asset.supplier ?? null,
    purchase_date: asset.purchaseDate ?? asset.purchase_date ?? null,
    price: asset.price ?? null,
    responsible_id: nullableId(asset.responsibleId ?? asset.responsible_id),
    notes: asset.notes ?? null,
    photo,
    unit: asset.unit ?? null,
    qty: asset.qty ?? null,
    min_qty: asset.minQty ?? asset.min_qty ?? 0,
    initial_qty: asset.initialQty ?? asset.initial_qty ?? null,
    warehouse_id: nullableId(asset.warehouseId ?? asset.warehouse_id),
    status: asset.status ?? "На складе",
    history: asset.history ?? [],
    pending_woqty: asset.pendingWOqty ?? asset.pending_woqty ?? null,
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

async function readTable(table, orderBy = "id") {
  const { data, error } = await supabase.from(table).select("*").order(orderBy, { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadCloudState() {
  assertConfiguredAndClient();
  const [users, warehouses, assets, transfers, categories, sessions] = await Promise.all([
    readTable(TABLES.users),
    readTable(TABLES.warehouses),
    readTable(TABLES.assets),
    readTable(TABLES.transfers, "created_at"),
    readTable(TABLES.categories),
    readTable(TABLES.sessions, "updated_at"),
  ]);

  const activeSession = [...sessions]
    .reverse()
    .find((s) => s.is_active && s.payload && typeof s.payload === "object");

  return {
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      login: u.login,
      role: u.role,
      password: u.password ?? null,
      warehouseId: u.warehouse_id,
      authUserId: u.auth_user_id || null,
      created_at: u.created_at,
      updated_at: u.updated_at,
    })),
    warehouses: warehouses.map((w) => ({
      id: w.id,
      name: w.name,
      responsibleIds: w.responsible_ids || [],
      responsibleId: w.responsible_id || null,
      created_at: w.created_at,
      updated_at: w.updated_at,
    })),
    assets: assets.map((a) => ({
      ...a,
      warehouseId: a.warehouse_id,
      responsibleId: a.responsible_id,
      purchaseDate: a.purchase_date || a.purchaseDate,
    })),
    transfers: transfers.map((t) => ({
      ...t,
      fromWhId: t.from_wh_id,
      toWhId: t.to_wh_id,
      fromResponsibleId: t.from_responsible_id,
      toResponsibleId: t.to_responsible_id,
      createdAt: t.created_at,
      confirmedAt: t.confirmed_at,
      confirmedBy: t.confirmed_by,
    })),
    categories: categories.map((c) => c.name),
    session: activeSession?.payload || null,
  };
}

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

export async function saveUsers(users) {
  assertConfiguredAndClient();
  const normalized = users.map(toUserRow);
  await replaceTable(TABLES.users, normalized);
}

export async function saveWarehouses(warehouses) {
  assertConfiguredAndClient();
  const normalized = warehouses.map(toWarehouseRow);
  await replaceTable(TABLES.warehouses, normalized);
}

export async function saveAssets(assets) {
  assertConfiguredAndClient();
  const normalized = await Promise.all(
    assets.map(async (a) => {
      const withPhoto = await uploadPhotoIfNeeded(a);
      return toAssetRow(withPhoto, withPhoto.photo);
    })
  );
  await replaceTable(TABLES.assets, normalized);
}

export async function saveTransfers(transfers) {
  assertConfiguredAndClient();
  const normalized = transfers.map(toTransferRow);
  await replaceTable(TABLES.transfers, normalized);
}

export async function saveCategories(categories) {
  assertConfiguredAndClient();
  const rows = categories.map((name) => ({ id: `cat-${name}`, name }));
  await replaceTable(TABLES.categories, rows);
}

export async function saveSession(session) {
  assertConfiguredAndClient();
  const payload = session || null;
  const row = {
    id: "active-session",
    is_active: Boolean(payload),
    payload,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from(TABLES.sessions).upsert(row, { onConflict: "id" });
  if (error) throw error;
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

export async function rpcRejectTransfer(transferId, actor) {
  return callRpc("tmc_reject_transfer", {
    p_transfer_id: transferId,
    p_actor: actor,
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
