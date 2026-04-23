import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  rpcApproveWriteoff,
  rpcConfirmTransfer,
  rpcRejectTransfer,
  rpcRejectWriteoff,
  rpcRequestTransfer,
  rpcRequestWriteoff,
} from "./lib/repository";
import { getSupabaseSession, hasSupabaseConfig, signInWithPassword, signOut as signOutSupabase } from "./lib/supabase";
import { useAppState } from "./state/useAppState";
import { Login } from "./features/auth/Login";
import { Topbar } from "./features/layout/Topbar";

const UNITS = ["шт", "л", "кг", "т", "м", "м²", "м³", "уп", "рул", "компл", "пара", "box"];
const DEFAULT_CATEGORIES = [
  "Стройматериалы",
  "Инструменты",
  "Запчасти",
  "ГСМ",
  "Электрика",
  "Сантехника",
  "Спецодежда / СИЗ",
  "Техника / Оборудование",
  "Расходники",
  "Прочее",
];
const STATUS_META = {
  "На складе": { color: "#3b82f6", icon: "●" },
  "Закупка": { color: "#f59e0b", icon: "●" },
  "В пути": { color: "#8b5cf6", icon: "●" },
  "У пользователя": { color: "#10b981", icon: "●" },
  "На списание": { color: "#f97316", icon: "●" },
  "Списан": { color: "#ef4444", icon: "●" },
};
const DEFAULT_USERS = [
  { id: "u1", name: "Администратор", login: "admin", role: "admin", warehouseId: "", authUserId: null },
  { id: "u2", name: "Иванов А.А.", login: "sklad1", role: "user", warehouseId: "w1", authUserId: null },
  { id: "u3", name: "Петров Б.Б.", login: "sklad2", role: "user", warehouseId: "w2", authUserId: null },
];
const DEFAULT_WAREHOUSES = [
  { id: "w1", name: "Главный склад", responsibleIds: ["u2"] },
  { id: "w2", name: "Склад №2", responsibleIds: ["u3"] },
];

const COLORS = {
  bg: "#0c1117",
  surface: "#161b22",
  border: "#21262d",
  text: "#e6edf3",
  muted: "#7d8590",
  accent: "#3b82f6",
  success: "#10b981",
  warn: "#f59e0b",
  danger: "#ef4444",
};

const inputStyle = {
  width: "100%",
  background: "#0d1117",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  color: COLORS.text,
  padding: "10px 12px",
  outline: "none",
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const nowISO = () => new Date().toISOString();
const fmt = (value) =>
  value ? new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtD = (value) => (value ? new Date(value).toLocaleDateString("ru-RU") : "—");
const trNo = () => `НК-${String(Date.now()).slice(-6)}`;
const qtyStr = (qty, unit) => `${Number(qty)} ${unit || "шт"}`;

export default function App() {
  const [page, setPage] = useState("warehouses");
  const [ctx, setCtx] = useState({});

  const {
    ready,
    users,
    warehouses,
    assets,
    transfers,
    categories,
    session,
    saveUsers,
    saveWarehouses,
    saveAssets,
    saveTransfers,
    saveCategories,
    saveSession,
    hydrateFromCloud,
  } = useAppState(
    useMemo(
      () => ({
        users: DEFAULT_USERS,
        warehouses: DEFAULT_WAREHOUSES,
        categories: DEFAULT_CATEGORIES,
      }),
      []
    )
  );

  const login = async ({ login: loginValue, password }) => {
    const normalizedLogin = loginValue.trim().toLowerCase();
    let matchedUser = null;

    if (hasSupabaseConfig) {
      const authEmail = normalizedLogin.includes("@") ? normalizedLogin : `${normalizedLogin}@tmc.local`;
      const authResult = await signInWithPassword(authEmail, password);
      const authId = authResult.user?.id;
      matchedUser = users.find((user) => user.authUserId === authId || user.login.toLowerCase() === normalizedLogin);
    } else {
      matchedUser = users.find((user) => user.login.toLowerCase() === normalizedLogin);
    }

    if (!matchedUser) {
      throw new Error("Пользователь авторизован, но его профиль не найден в tmc_users.");
    }

    const next = { user: matchedUser };
    saveSession(next);
    setPage("warehouses");
  };

  const logout = async () => {
    try {
      if (hasSupabaseConfig) {
        await signOutSupabase();
      }
    } finally {
      saveSession(null);
    }
  };

  const syncAfterRpc = async (rpcCall) => {
    try {
      const cloud = await rpcCall();
      hydrateFromCloud(cloud);
      const authSession = await getSupabaseSession();
      if (!authSession?.user || !session?.user) return;
      const refreshedUser =
        cloud.users?.find((user) => user.authUserId === authSession.user.id || user.id === session.user.id) || session.user;
      saveSession({ user: refreshedUser });
    } catch (error) {
      console.error(error);
      alert("Ошибка серверной операции. Проверьте подключение и права доступа.");
    }
  };

  const nav = (nextPage, nextCtx = {}) => {
    setPage(nextPage);
    setCtx(nextCtx);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (!ready || !hasSupabaseConfig || !session) return;
    let alive = true;
    (async () => {
      const authSession = await getSupabaseSession();
      if (!alive) return;
      if (!authSession?.user) {
        saveSession(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, session, saveSession]);

  if (!ready) return <Splash />;
  if (!session) {
    return (
      <Login
        onLogin={login}
        hasSupabaseConfig={hasSupabaseConfig}
        Field={Field}
        inputStyle={inputStyle}
        buttonStyle={buttonStyle}
        COLORS={COLORS}
        Tag={Tag}
        H1={H1}
        ErrBox={ErrBox}
      />
    );
  }

  const isAdmin = session.user.role === "admin";
  const myWHid = session.user.warehouseId;
  const incoming = transfers.filter((t) => t.status === "pending" && (isAdmin || t.toWhId === myWHid));
  const pendingWO = assets.filter((a) => a.status === "На списание");
  const lowStock = assets.filter((a) => a.qty !== undefined && a.minQty > 0 && a.qty <= a.minQty && a.status !== "Списан");

  const shared = {
    users,
    warehouses,
    assets,
    transfers,
    categories,
    session,
    isAdmin,
    myWHid,
    saveUsers,
    saveWarehouses,
    saveAssets,
    saveTransfers,
    saveCategories,
    syncAfterRpc,
    nav,
  };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg }}>
      <Topbar
        session={session}
        isAdmin={isAdmin}
        page={page}
        nav={nav}
        logout={logout}
        incomingCount={incoming.length}
        writeoffCount={pendingWO.length}
        lowStockCount={lowStock.length}
        COLORS={COLORS}
        buttonStyle={buttonStyle}
      />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {page === "warehouses" && <WarehouseList {...shared} lowStock={lowStock} />}
        {page === "warehouse" && <WarehouseView {...shared} warehouseId={ctx.warehouseId} />}
        {page === "asset" && <AssetDetail {...shared} assetId={ctx.assetId} />}
        {page === "incoming" && <IncomingPage {...shared} />}
        {page === "writeoffs" && isAdmin && <WriteoffPage {...shared} />}
        {page === "admin" && isAdmin && <AdminPanel {...shared} />}
        {page === "waybill" && <WaybillPage {...shared} transferId={ctx.transferId} />}
        {page === "export" && isAdmin && <ExportPage {...shared} />}
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: COLORS.muted }}>
      Загрузка...
    </div>
  );
}

function WarehouseList({ warehouses, assets, users, isAdmin, myWHid, nav, lowStock, transfers }) {
  const visible = isAdmin ? warehouses : warehouses.filter((item) => !myWHid || item.id === myWHid);
  return (
    <div>
      <Tag>ОБЗОР</Tag>
      <H1>Склады</H1>
      {lowStock.length > 0 && <InfoBanner color={COLORS.warn}>Минимальный остаток достигнут у {lowStock.length} позиций.</InfoBanner>}
      <Grid>
        {visible.map((warehouse) => {
          const whAssets = assets.filter((item) => item.warehouseId === warehouse.id && item.status !== "Списан");
          const incoming = transfers.filter((t) => t.status === "pending" && t.toWhId === warehouse.id).length;
          const outgoing = transfers.filter((t) => t.status === "pending" && t.fromWhId === warehouse.id).length;
          const responsibles = users.filter((user) => (warehouse.responsibleIds || []).includes(user.id));
          return (
            <Card key={warehouse.id} hover onClick={() => nav("warehouse", { warehouseId: warehouse.id })}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{warehouse.name}</div>
              <Muted>{responsibles.length ? responsibles.map((item) => item.name).join(", ") : "Ответственный не назначен"}</Muted>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <Chip color={COLORS.accent}>{whAssets.length} позиций</Chip>
                {incoming > 0 && <Chip color={COLORS.success}>{incoming} входящих</Chip>}
                {outgoing > 0 && <Chip color="#8b5cf6">{outgoing} отправлено</Chip>}
              </div>
            </Card>
          );
        })}
      </Grid>
      {visible.length === 0 && <Empty text="Нет доступных складов" />}
    </div>
  );
}

function WarehouseView(props) {
  const { warehouseId, warehouses, assets, users, categories, isAdmin, myWHid, nav, saveAssets, session, transfers } = props;
  const warehouse = warehouses.find((item) => item.id === warehouseId);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Все");
  const [showAdd, setShowAdd] = useState(false);

  if (!warehouse) return <Empty text="Склад не найден" />;

  const responsibleIds = warehouse.responsibleIds || [];
  const canAdd = isAdmin || responsibleIds.includes(session.user.id) || myWHid === warehouse.id || !myWHid;
  const list = assets
    .filter((item) => item.warehouseId === warehouse.id)
    .filter((item) => {
      const q = search.trim().toLowerCase();
      const searchOk = !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
      const statusOk = statusFilter === "Все" || item.status === statusFilter;
      return searchOk && statusOk;
    });

  const addAsset = (asset) => {
    saveAssets([...assets, asset]);
    setShowAdd(false);
  };

  const pendingOutgoing = transfers.filter((item) => item.status === "pending" && item.fromWhId === warehouse.id);
  const pendingIncoming = transfers.filter((item) => item.status === "pending" && item.toWhId === warehouse.id);

  return (
    <div>
      <Breadcrumb items={[{ label: "Склады", onClick: () => nav("warehouses") }, { label: warehouse.name }]} />
      <Row>
        <div>
          <H1>{warehouse.name}</H1>
          <Muted>{assets.filter((item) => item.warehouseId === warehouse.id && item.status !== "Списан").length} активных позиций</Muted>
        </div>
        {canAdd && <button style={buttonStyle(COLORS.accent)} onClick={() => setShowAdd(true)}>+ Добавить ТМЦ</button>}
      </Row>

      {pendingOutgoing.length > 0 && <InfoBanner color="#8b5cf6">В пути: {pendingOutgoing.length} передач.</InfoBanner>}
      {pendingIncoming.length > 0 && <InfoBanner color={COLORS.success}>Ожидают подтверждения: {pendingIncoming.length} передач.</InfoBanner>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {["Все", ...Object.keys(STATUS_META)].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              ...buttonStyle(statusFilter === status ? `${(STATUS_META[status] || {}).color || COLORS.accent}22` : "transparent", {
                border: `1px solid ${statusFilter === status ? (STATUS_META[status] || {}).color || COLORS.accent : COLORS.border}`,
              }),
              color: statusFilter === status ? (STATUS_META[status] || {}).color || COLORS.text : COLORS.text,
            }}
          >
            {status}
          </button>
        ))}
      </div>

      <input style={{ ...inputStyle, marginBottom: 14 }} placeholder="Поиск по названию или ID" value={search} onChange={(e) => setSearch(e.target.value)} />

      <div style={{ display: "grid", gap: 10 }}>
        {list.map((asset) => (
          <AssetRow key={asset.id} asset={asset} users={users} onClick={() => nav("asset", { assetId: asset.id })} />
        ))}
      </div>
      {list.length === 0 && <Empty text="Нет ТМЦ" />}

      {showAdd && (
        <Modal onClose={() => setShowAdd(false)}>
          <AddAssetForm
            warehouseId={warehouse.id}
            warehouses={warehouses}
            users={users}
            categories={categories}
            isAdmin={isAdmin}
            session={session}
            onSave={addAsset}
            onCancel={() => setShowAdd(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function AssetRow({ asset, users, onClick }) {
  const responsible = users.find((user) => user.id === asset.responsibleId);
  const meta = STATUS_META[asset.status] || { color: COLORS.muted, icon: "●" };
  const isLow = asset.qty !== undefined && asset.minQty > 0 && asset.qty <= asset.minQty && asset.status !== "Списан";
  return (
    <Card hover onClick={onClick} style={{ borderColor: isLow ? COLORS.warn : COLORS.border }}>
      <Row>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700 }}>{asset.name}</div>
            <Chip color={meta.color}>{meta.icon} {asset.status}</Chip>
            {isLow && <Chip color={COLORS.warn}>Мало</Chip>}
          </div>
          <Muted>{asset.id}{responsible ? ` · ${responsible.name}` : ""}{asset.category ? ` · ${asset.category}` : ""}</Muted>
        </div>
        <div style={{ textAlign: "right" }}>
          {asset.qty !== undefined ? (
            <>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{asset.qty}</div>
              <Muted>{asset.unit || "шт"}</Muted>
            </>
          ) : (
            <Muted>{fmtD(asset.purchaseDate || asset.createdAt)}</Muted>
          )}
        </div>
      </Row>
    </Card>
  );
}

function AssetDetail(props) {
  const { assetId, assets, warehouses, users, isAdmin, myWHid, session, saveAssets, transfers, saveTransfers, syncAfterRpc, nav } = props;
  const asset = assets.find((item) => item.id === assetId);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showWriteoff, setShowWriteoff] = useState(false);
  const [transferForm, setTransferForm] = useState({ toWhId: "", responsibleId: "", qty: "", notes: "" });
  const [writeoffForm, setWriteoffForm] = useState({ qty: "", notes: "" });
  const fileRef = useRef(null);

  if (!asset) return <Empty text="ТМЦ не найден" />;

  const warehouse = warehouses.find((item) => item.id === asset.warehouseId);
  const responsible = users.find((item) => item.id === asset.responsibleId);
  const hasQty = asset.qty !== undefined;
  const pendingTransfer = transfers.find((item) => item.assetId === asset.id && item.status === "pending");
  const canEdit = isAdmin || myWHid === asset.warehouseId || !myWHid;
  const otherWarehouses = warehouses.filter((item) => item.id !== asset.warehouseId);

  const updateAsset = (patch) => {
    saveAssets(assets.map((item) => (item.id === asset.id ? { ...item, ...patch } : item)));
  };

  const addHistory = (entry) => [...(asset.history || []), entry];

  const onPhoto = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateAsset({ photo: reader.result });
    reader.readAsDataURL(file);
  };

  const createTransfer = async () => {
    if (!transferForm.toWhId) return alert("Выберите склад назначения");
    const toWarehouse = warehouses.find((item) => item.id === transferForm.toWhId);
    const qty = hasQty ? Number(transferForm.qty) : null;
    if (hasQty && (!qty || qty <= 0 || qty > asset.qty)) {
      return alert(`Введите количество от 0.01 до ${asset.qty}`);
    }

    const transfer = {
      id: `TR-${uid()}`,
      no: trNo(),
      assetId: asset.id,
      assetName: asset.name,
      fromWhId: asset.warehouseId,
      fromWhName: warehouse?.name || "—",
      toWhId: transferForm.toWhId,
      toWhName: toWarehouse?.name || "—",
      fromResponsibleId: asset.responsibleId,
      fromResponsibleName: responsible?.name || "—",
      toResponsibleId: transferForm.responsibleId,
      toResponsibleName: users.find((item) => item.id === transferForm.responsibleId)?.name || "",
      notes: transferForm.notes,
      status: "pending",
      createdAt: nowISO(),
      createdBy: session.user.name,
      qty,
      unit: asset.unit,
      confirmedAt: null,
      confirmedBy: null,
    };

    if (hasSupabaseConfig) {
      await syncAfterRpc(() =>
        rpcRequestTransfer({
          ...transfer,
          actor: session.user.name,
        })
      );
    } else {
      saveTransfers([...transfers, transfer]);

      if (hasQty) {
        updateAsset({
          qty: asset.qty - qty,
          history: addHistory({
            date: nowISO(),
            action: `Отправлено (${qtyStr(qty, asset.unit)})`,
            warehouseId: asset.warehouseId,
            responsibleId: asset.responsibleId,
            qty,
            status: "В пути",
            by: session.user.name,
            notes: transferForm.notes,
          }),
        });
      } else {
        updateAsset({
          status: "В пути",
          history: addHistory({
            date: nowISO(),
            action: `Отправлено на ${toWarehouse?.name || "склад"}`,
            warehouseId: asset.warehouseId,
            responsibleId: asset.responsibleId,
            status: "В пути",
            by: session.user.name,
            notes: transferForm.notes,
          }),
        });
      }
    }

    setTransferForm({ toWhId: "", responsibleId: "", qty: "", notes: "" });
    setShowTransfer(false);
  };

  const requestWriteoff = async () => {
    const qty = hasQty ? Number(writeoffForm.qty) : null;
    if (hasQty && (!qty || qty <= 0 || qty > asset.qty)) {
      return alert(`Введите количество от 0.01 до ${asset.qty}`);
    }

    if (hasSupabaseConfig && isAdmin) {
      await syncAfterRpc(() => rpcApproveWriteoff(asset.id, qty, writeoffForm.notes, session.user.name));
    } else if (hasSupabaseConfig) {
      await syncAfterRpc(() => rpcRequestWriteoff(asset.id, qty, writeoffForm.notes, session.user.name));
    } else if (isAdmin) {
      approveWriteoff(asset, qty, writeoffForm.notes, saveAssets, assets, session.user.name);
    } else {
      updateAsset({
        status: "На списание",
        pendingWOqty: qty,
        history: addHistory({
          date: nowISO(),
          action: `Запрос на списание${hasQty ? ` (${qtyStr(qty, asset.unit)})` : ""}`,
          warehouseId: asset.warehouseId,
          responsibleId: asset.responsibleId,
          qty,
          status: "На списание",
          by: session.user.name,
          notes: writeoffForm.notes,
        }),
      });
    }

    setWriteoffForm({ qty: "", notes: "" });
    setShowWriteoff(false);
  };

  const confirmIncoming = async () => {
    if (!pendingTransfer) return;
    if (hasSupabaseConfig) {
      await syncAfterRpc(() => rpcConfirmTransfer(pendingTransfer.id, session.user.name));
      return;
    }
    confirmTransfer(pendingTransfer, assets, saveAssets, transfers, saveTransfers, session.user.name);
  };

  const rejectIncoming = async () => {
    if (!pendingTransfer) return;
    if (hasSupabaseConfig) {
      await syncAfterRpc(() => rpcRejectTransfer(pendingTransfer.id, session.user.name));
      return;
    }
    rejectTransfer(pendingTransfer, assets, saveAssets, transfers, saveTransfers, session.user.name);
  };

  return (
    <div>
      <Breadcrumb items={[{ label: "Склады", onClick: () => nav("warehouses") }, { label: warehouse?.name || "—", onClick: () => warehouse && nav("warehouse", { warehouseId: warehouse.id }) }, { label: asset.name }]} />

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }}>
        <div>
          <Card>
            <div style={{ position: "relative", aspectRatio: "16 / 10", borderRadius: 12, overflow: "hidden", background: COLORS.bg, display: "grid", placeItems: "center" }}>
              {asset.photo ? <img src={asset.photo} alt={asset.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Muted>Фото не загружено</Muted>}
              {canEdit && (
                <>
                  <button onClick={() => fileRef.current?.click()} style={{ ...buttonStyle("rgba(12,17,23,.85)"), position: "absolute", right: 12, top: 12 }}>
                    Загрузить фото
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPhoto} />
                </>
              )}
            </div>
          </Card>

          {pendingTransfer && (isAdmin || myWHid === pendingTransfer.toWhId) && (
            <Card style={{ borderColor: "#8b5cf6" }}>
              <SectionTitle>Входящая передача</SectionTitle>
              <Muted>
                {pendingTransfer.no} · От: {pendingTransfer.fromWhName} · {fmt(pendingTransfer.createdAt)}
              </Muted>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button style={buttonStyle("#8b5cf6")} onClick={() => nav("waybill", { transferId: pendingTransfer.id })}>
                  Накладная
                </button>
                <button style={buttonStyle(COLORS.accent)} onClick={confirmIncoming}>
                  Подтвердить
                </button>
                <button style={buttonStyle("#3a1a1a", { border: `1px solid ${COLORS.danger}` })} onClick={rejectIncoming}>
                  Отклонить
                </button>
              </div>
            </Card>
          )}
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <H1 style={{ margin: 0 }}>{asset.name}</H1>
              <Chip color={(STATUS_META[asset.status] || {}).color || COLORS.muted}>{asset.status}</Chip>
            </div>
            <Muted>{asset.id}</Muted>
            <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
              <InfoLine label="Склад" value={warehouse?.name} />
              <InfoLine label="Ответственный" value={responsible?.name} />
              <InfoLine label="Категория" value={asset.category} />
              <InfoLine label="Поставщик" value={asset.supplier} />
              <InfoLine label="Цена" value={asset.price ? `${asset.price} ₸` : "—"} />
              <InfoLine label="Дата закупки" value={fmtD(asset.purchaseDate || asset.createdAt)} />
              <InfoLine label="Серийный №" value={asset.notes} />
              <InfoLine label="Количество" value={hasQty ? `${asset.qty} ${asset.unit || "шт"}` : "—"} />
            </div>
          </Card>

          {canEdit && asset.status !== "Списан" && !pendingTransfer && (
            <Card>
              <SectionTitle>Действия</SectionTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {otherWarehouses.length > 0 && asset.status !== "В пути" && (
                  <button style={buttonStyle("#8b5cf6")} onClick={() => setShowTransfer((v) => !v)}>
                    Передать
                  </button>
                )}
                {asset.status !== "На списание" && (
                  <button style={buttonStyle(COLORS.danger)} onClick={() => setShowWriteoff((v) => !v)}>
                    {isAdmin ? "Списать" : "Запросить списание"}
                  </button>
                )}
              </div>

              {showTransfer && (
                <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                  <Field label="Склад назначения">
                    <select style={inputStyle} value={transferForm.toWhId} onChange={(e) => setTransferForm((p) => ({ ...p, toWhId: e.target.value }))}>
                      <option value="">— выберите —</option>
                      {otherWarehouses.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </Field>
                  {hasQty && (
                    <Field label={`Количество (макс. ${asset.qty} ${asset.unit})`}>
                      <input style={inputStyle} type="number" min="0" step="0.01" value={transferForm.qty} onChange={(e) => setTransferForm((p) => ({ ...p, qty: e.target.value }))} />
                    </Field>
                  )}
                  <Field label="Ответственный получателя">
                    <select style={inputStyle} value={transferForm.responsibleId} onChange={(e) => setTransferForm((p) => ({ ...p, responsibleId: e.target.value }))}>
                      <option value="">— выберите —</option>
                      {users.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Примечание">
                    <input style={inputStyle} value={transferForm.notes} onChange={(e) => setTransferForm((p) => ({ ...p, notes: e.target.value }))} />
                  </Field>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ ...buttonStyle(COLORS.accent), flex: 1 }} onClick={createTransfer}>Отправить</button>
                    <button style={{ ...buttonStyle("transparent", { border: `1px solid ${COLORS.border}` }), flex: 1 }} onClick={() => setShowTransfer(false)}>Отмена</button>
                  </div>
                </div>
              )}

              {showWriteoff && (
                <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                  {hasQty && (
                    <Field label={`Количество для списания (на складе: ${asset.qty} ${asset.unit})`}>
                      <input style={inputStyle} type="number" min="0" step="0.01" value={writeoffForm.qty} onChange={(e) => setWriteoffForm((p) => ({ ...p, qty: e.target.value }))} />
                    </Field>
                  )}
                  <Field label="Причина">
                    <input style={inputStyle} value={writeoffForm.notes} onChange={(e) => setWriteoffForm((p) => ({ ...p, notes: e.target.value }))} />
                  </Field>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ ...buttonStyle(COLORS.danger), flex: 1 }} onClick={requestWriteoff}>
                      {isAdmin ? "Списать" : "Отправить запрос"}
                    </button>
                    <button style={{ ...buttonStyle("transparent", { border: `1px solid ${COLORS.border}` }), flex: 1 }} onClick={() => setShowWriteoff(false)}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card>
            <SectionTitle>История движения</SectionTitle>
            {(asset.history || []).length === 0 && <Muted>История пуста</Muted>}
            {[...(asset.history || [])].reverse().map((item, index) => (
              <div key={`${item.date}-${index}`} style={{ padding: "10px 0", borderBottom: index === (asset.history || []).length - 1 ? "none" : `1px solid ${COLORS.border}` }}>
                <div style={{ fontWeight: 600 }}>{item.action}</div>
                <Muted>{fmt(item.date)}{item.by ? ` · ${item.by}` : ""}</Muted>
                {item.notes && <div style={{ marginTop: 4, color: "#cbd5e1" }}>{item.notes}</div>}
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

function IncomingPage({ transfers, assets, saveAssets, saveTransfers, isAdmin, myWHid, session, syncAfterRpc, nav }) {
  const list = transfers.filter((item) => item.status === "pending" && (isAdmin || item.toWhId === myWHid));
  return (
    <div>
      <Tag>ПЕРЕДАЧИ</Tag>
      <H1>Входящие</H1>
      <div style={{ display: "grid", gap: 12 }}>
        {list.map((transfer) => (
          <Card key={transfer.id} style={{ borderColor: "#8b5cf6" }}>
            <Row>
              <div>
                <div style={{ fontWeight: 700 }}>{transfer.assetName}</div>
                <Muted>{transfer.assetId} · {transfer.no}</Muted>
              </div>
              <Chip color="#8b5cf6">{transfer.qty ? qtyStr(transfer.qty, transfer.unit) : "1 шт"}</Chip>
            </Row>
            <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
              <InfoLine label="Откуда" value={transfer.fromWhName} />
              <InfoLine label="Куда" value={transfer.toWhName} />
              <InfoLine label="Отправил" value={transfer.createdBy} />
              <InfoLine label="Дата" value={fmt(transfer.createdAt)} />
              <InfoLine label="Примечание" value={transfer.notes || "—"} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button style={buttonStyle("#8b5cf6")} onClick={() => nav("waybill", { transferId: transfer.id })}>Накладная</button>
              <button
                style={buttonStyle(COLORS.accent)}
                onClick={() =>
                  hasSupabaseConfig
                    ? syncAfterRpc(() => rpcConfirmTransfer(transfer.id, session.user.name))
                    : confirmTransfer(transfer, assets, saveAssets, transfers, saveTransfers, session.user.name)
                }
              >
                Подтвердить
              </button>
              <button
                style={buttonStyle("#3a1a1a", { border: `1px solid ${COLORS.danger}` })}
                onClick={() =>
                  hasSupabaseConfig
                    ? syncAfterRpc(() => rpcRejectTransfer(transfer.id, session.user.name))
                    : rejectTransfer(transfer, assets, saveAssets, transfers, saveTransfers, session.user.name)
                }
              >
                Отклонить
              </button>
            </div>
          </Card>
        ))}
      </div>
      {list.length === 0 && <Empty text="Нет входящих передач" />}
    </div>
  );
}

function WaybillPage({ transferId, transfers, assets, nav }) {
  const transfer = transfers.find((item) => item.id === transferId);
  const asset = assets.find((item) => item.id === transfer?.assetId);
  if (!transfer) return <Empty text="Накладная не найдена" />;

  const print = () => {
    const popup = window.open("", "_blank");
    if (!popup) return;
    popup.document.write(`
      <html><head><title>Накладная ${transfer.no}</title></head>
      <body style="font-family: Arial, sans-serif; padding: 32px;">
        <h1>Товарная накладная</h1>
        <p><b>№:</b> ${transfer.no}</p>
        <p><b>Дата:</b> ${fmt(transfer.createdAt)}</p>
        <p><b>Наименование:</b> ${transfer.assetName}</p>
        <p><b>Инв. номер:</b> ${transfer.assetId}</p>
        <p><b>Количество:</b> ${transfer.qty ? qtyStr(transfer.qty, transfer.unit) : "1 шт"}</p>
        <p><b>Категория:</b> ${asset?.category || "—"}</p>
        <p><b>Откуда:</b> ${transfer.fromWhName}</p>
        <p><b>Куда:</b> ${transfer.toWhName}</p>
        <p><b>Сдал:</b> ${transfer.fromResponsibleName || "—"}</p>
        <p><b>Принял:</b> ${transfer.toResponsibleName || "—"}</p>
        <p><b>Примечание:</b> ${transfer.notes || "—"}</p>
        <button onclick="window.print()">Печать</button>
      </body></html>
    `);
    popup.document.close();
  };

  return (
    <div>
      <Breadcrumb items={[{ label: "Входящие", onClick: () => nav("incoming") }, { label: transfer.no }]} />
      <Row>
        <div>
          <Tag>НАКЛАДНАЯ</Tag>
          <H1>{transfer.no}</H1>
        </div>
        <button style={buttonStyle(COLORS.accent)} onClick={print}>Печать</button>
      </Row>
      <Card>
        <SectionTitle>Товар</SectionTitle>
        <InfoLine label="Наименование" value={transfer.assetName} />
        <InfoLine label="Инв. номер" value={transfer.assetId} />
        <InfoLine label="Количество" value={transfer.qty ? qtyStr(transfer.qty, transfer.unit) : "1 шт"} />
        <InfoLine label="Категория" value={asset?.category || "—"} />
      </Card>
      <Card>
        <SectionTitle>Движение</SectionTitle>
        <InfoLine label="Склад-отправитель" value={transfer.fromWhName} />
        <InfoLine label="Склад-получатель" value={transfer.toWhName} />
        <InfoLine label="Дата отправки" value={fmt(transfer.createdAt)} />
        <InfoLine label="Отправил" value={transfer.createdBy || "—"} />
        <InfoLine label="Примечание" value={transfer.notes || "—"} />
      </Card>
    </div>
  );
}

function WriteoffPage({ assets, saveAssets, session, syncAfterRpc, nav }) {
  const pending = assets.filter((item) => item.status === "На списание");
  return (
    <div>
      <Tag>АДМИНИСТРАТОР</Tag>
      <H1>Запросы на списание</H1>
      <div style={{ display: "grid", gap: 12 }}>
        {pending.map((asset) => (
          <Card key={asset.id} style={{ borderColor: "#f97316" }}>
            <Row>
              <div>
                <div style={{ fontWeight: 700 }}>{asset.name}</div>
                <Muted>{asset.id}</Muted>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={buttonStyle("transparent", { border: `1px solid ${COLORS.border}` })} onClick={() => nav("asset", { assetId: asset.id })}>Открыть</button>
                <button
                  style={buttonStyle("#3a1a1a", { border: `1px solid ${COLORS.danger}` })}
                  onClick={() =>
                    hasSupabaseConfig
                      ? syncAfterRpc(() => rpcRejectWriteoff(asset.id, session.user.name))
                      : rejectWriteoff(asset, assets, saveAssets, session.user.name)
                  }
                >
                  Отклонить
                </button>
                <button
                  style={buttonStyle(COLORS.danger)}
                  onClick={() =>
                    hasSupabaseConfig
                      ? syncAfterRpc(() => rpcApproveWriteoff(asset.id, asset.pendingWOqty || asset.qty, "Подтверждено администратором", session.user.name))
                      : approveWriteoff(asset, asset.pendingWOqty || asset.qty, "Подтверждено администратором", saveAssets, assets, session.user.name)
                  }
                >
                  Списать
                </button>
              </div>
            </Row>
          </Card>
        ))}
      </div>
      {pending.length === 0 && <Empty text="Нет запросов на списание" />}
    </div>
  );
}

function AdminPanel(props) {
  const { users, warehouses, assets, categories, saveUsers, saveWarehouses, saveCategories } = props;
  const [tab, setTab] = useState("whs");
  return (
    <div>
      <Tag>НАСТРОЙКИ</Tag>
      <H1>Панель администратора</H1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          ["whs", "Склады"],
          ["users", "Пользователи"],
          ["cats", "Категории"],
        ].map(([id, label]) => (
          <button key={id} style={buttonStyle(tab === id ? `${COLORS.accent}22` : "transparent", { border: `1px solid ${tab === id ? COLORS.accent : COLORS.border}` })} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "whs" && <WarehouseAdmin warehouses={warehouses} users={users} assets={assets} saveWarehouses={saveWarehouses} />}
      {tab === "users" && <UserAdmin users={users} warehouses={warehouses} saveUsers={saveUsers} />}
      {tab === "cats" && <CategoryAdmin categories={categories} saveCategories={saveCategories} />}
    </div>
  );
}

function CategoryAdmin({ categories, saveCategories }) {
  const [value, setValue] = useState("");
  return (
    <Card>
      <SectionTitle>Категории</SectionTitle>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input style={inputStyle} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Новая категория" />
        <button
          style={buttonStyle(COLORS.accent)}
          onClick={() => {
            const next = value.trim();
            if (!next || categories.includes(next)) return;
            saveCategories([...categories, next]);
            setValue("");
          }}
        >
          Добавить
        </button>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {categories.map((category) => (
          <Card key={category} style={{ background: COLORS.bg }}>
            <Row>
              <div>{category}</div>
              <button style={buttonStyle("#3a1a1a", { border: `1px solid ${COLORS.danger}` })} onClick={() => saveCategories(categories.filter((item) => item !== category))}>
                Удалить
              </button>
            </Row>
          </Card>
        ))}
      </div>
    </Card>
  );
}

function WarehouseAdmin({ warehouses, users, assets, saveWarehouses }) {
  const [form, setForm] = useState({ name: "", responsibleIds: [] });
  const [editId, setEditId] = useState("");
  const reset = () => {
    setForm({ name: "", responsibleIds: [] });
    setEditId("");
  };
  const submit = () => {
    if (!form.name.trim()) return;
    const payload = { name: form.name.trim(), responsibleIds: form.responsibleIds };
    if (editId) {
      saveWarehouses(warehouses.map((item) => (item.id === editId ? { ...item, ...payload } : item)));
    } else {
      saveWarehouses([...warehouses, { id: `w${uid()}`, ...payload }]);
    }
    reset();
  };

  return (
    <Card>
      <SectionTitle>Склады</SectionTitle>
      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <Field label="Название">
          <input style={inputStyle} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </Field>
        <Field label="Ответственные">
          <div style={{ display: "grid", gap: 6, padding: 10, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
            {users.map((user) => (
              <label key={user.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={form.responsibleIds.includes(user.id)}
                  onChange={() =>
                    setForm((p) => ({
                      ...p,
                      responsibleIds: p.responsibleIds.includes(user.id) ? p.responsibleIds.filter((id) => id !== user.id) : [...p.responsibleIds, user.id],
                    }))
                  }
                />
                {user.name}
              </label>
            ))}
          </div>
        </Field>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={buttonStyle(COLORS.accent)} onClick={submit}>Сохранить</button>
          {(editId || form.name || form.responsibleIds.length > 0) && <button style={buttonStyle("transparent", { border: `1px solid ${COLORS.border}` })} onClick={reset}>Сбросить</button>}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {warehouses.map((warehouse) => (
          <Card key={warehouse.id} style={{ background: COLORS.bg }}>
            <Row>
              <div>
                <div style={{ fontWeight: 700 }}>{warehouse.name}</div>
                <Muted>{assets.filter((item) => item.warehouseId === warehouse.id).length} ТМЦ</Muted>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={buttonStyle("transparent", { border: `1px solid ${COLORS.border}` })}
                  onClick={() => {
                    setEditId(warehouse.id);
                    setForm({ name: warehouse.name, responsibleIds: warehouse.responsibleIds || [] });
                  }}
                >
                  Редактировать
                </button>
                <button style={buttonStyle("#3a1a1a", { border: `1px solid ${COLORS.danger}` })} onClick={() => saveWarehouses(warehouses.filter((item) => item.id !== warehouse.id))}>
                  Удалить
                </button>
              </div>
            </Row>
          </Card>
        ))}
      </div>
    </Card>
  );
}

function UserAdmin({ users, warehouses, saveUsers }) {
  const [form, setForm] = useState({ name: "", login: "", password: "", role: "user", warehouseId: "", authUserId: "" });
  const [editId, setEditId] = useState("");
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const reset = () => {
    setForm({ name: "", login: "", password: "", role: "user", warehouseId: "", authUserId: "" });
    setEditId("");
  };
  const submit = () => {
    if (!form.name.trim() || !form.login.trim()) return;
    const password = form.password.trim();
    if (!editId && !password) {
      alert("Для нового пользователя укажите пароль.");
      return;
    }
    const authUserId = form.authUserId.trim();
    if (authUserId && !uuidRegex.test(authUserId)) {
      alert("Auth User ID должен быть валидным UUID или пустым.");
      return;
    }
    const payload = {
      ...form,
      name: form.name.trim(),
      login: form.login.trim(),
      authUserId: authUserId || null,
    };
    if (!editId || password) {
      payload.password = password;
    }
    if (editId) {
      saveUsers(users.map((item) => (item.id === editId ? { ...item, ...payload } : item)));
    } else {
      saveUsers([...users, { id: `u${uid()}`, ...payload }]);
    }
    reset();
  };
  return (
    <Card>
      <SectionTitle>Пользователи</SectionTitle>
      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <Field label="ФИО"><input style={inputStyle} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
        <Field label="Email (Supabase Auth)"><input style={inputStyle} value={form.login} onChange={(e) => setForm((p) => ({ ...p, login: e.target.value }))} /></Field>
        <Field label={editId ? "Пароль (оставьте пустым, чтобы не менять)" : "Пароль *"}>
          <input type="password" style={inputStyle} value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
        </Field>
        <Field label="Auth User ID (uuid, optional)"><input style={inputStyle} value={form.authUserId} onChange={(e) => setForm((p) => ({ ...p, authUserId: e.target.value }))} /></Field>
        <Field label="Роль">
          <select style={inputStyle} value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </Field>
        {form.role === "user" && (
          <Field label="Привязанный склад">
            <select style={inputStyle} value={form.warehouseId} onChange={(e) => setForm((p) => ({ ...p, warehouseId: e.target.value }))}>
              <option value="">— не выбран —</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
          </Field>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button style={buttonStyle(COLORS.accent)} onClick={submit}>Сохранить</button>
          {(editId || form.name || form.login) && <button style={buttonStyle("transparent", { border: `1px solid ${COLORS.border}` })} onClick={reset}>Сбросить</button>}
        </div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {users.map((user) => (
          <Card key={user.id} style={{ background: COLORS.bg }}>
            <Row>
              <div>
                <div style={{ fontWeight: 700 }}>{user.name}</div>
                <Muted>{user.login} · {user.role}{user.warehouseId ? ` · ${warehouses.find((w) => w.id === user.warehouseId)?.name || ""}` : ""}</Muted>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={buttonStyle("transparent", { border: `1px solid ${COLORS.border}` })} onClick={() => { setEditId(user.id); setForm({ name: user.name, login: user.login, password: "", role: user.role, warehouseId: user.warehouseId || "", authUserId: user.authUserId || "" }); }}>
                  Редактировать
                </button>
                <button style={buttonStyle("#3a1a1a", { border: `1px solid ${COLORS.danger}` })} onClick={() => saveUsers(users.filter((item) => item.id !== user.id))}>
                  Удалить
                </button>
              </div>
            </Row>
          </Card>
        ))}
      </div>
    </Card>
  );
}

function AddAssetForm({ warehouseId, warehouses, users, categories, isAdmin, session, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: "",
    category: "",
    supplier: "",
    purchaseDate: new Date().toISOString().slice(0, 10),
    price: "",
    responsibleId: session?.user?.id || "",
    notes: "",
    photo: "",
    unit: "шт",
    qty: "",
    minQty: "",
  });
  const fileRef = useRef(null);
  const warehouse = warehouses.find((item) => item.id === warehouseId);
  const responsibleIds = warehouse?.responsibleIds || [];
  const allowedUsers = isAdmin ? users : users.filter((item) => item.role === "admin" || responsibleIds.includes(item.id) || item.id === session?.user?.id);

  const upload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((p) => ({ ...p, photo: reader.result }));
    reader.readAsDataURL(file);
  };

  const submit = () => {
    if (!form.name.trim()) return alert("Введите название");
    if (!form.category) return alert("Выберите категорию");
    const qty = form.qty === "" ? undefined : Number(form.qty);
    const minQty = form.minQty === "" ? 0 : Number(form.minQty);
    const newAsset = {
      id: `TMC-${uid().toUpperCase().slice(0, 8)}`,
      ...form,
      name: form.name.trim(),
      qty,
      initialQty: qty,
      minQty,
      warehouseId,
      status: "На складе",
      createdAt: nowISO(),
      history: [
        {
          date: nowISO(),
          action: `Приход${qty !== undefined ? ` (${qtyStr(qty, form.unit)})` : ""}`,
          warehouseId,
          responsibleId: form.responsibleId,
          qty,
          status: "На складе",
          by: session.user.name,
          notes: form.notes,
        },
      ],
    };
    onSave(newAsset);
  };

  return (
    <div style={{ width: "100%", maxWidth: 520, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20 }}>
      <H1>Новый ТМЦ</H1>
      <div onClick={() => fileRef.current?.click()} style={{ height: 180, borderRadius: 12, border: `2px dashed ${COLORS.border}`, background: COLORS.bg, marginBottom: 14, display: "grid", placeItems: "center", cursor: "pointer", overflow: "hidden" }}>
        {form.photo ? <img src={form.photo} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Muted>Нажмите, чтобы добавить фото</Muted>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={upload} style={{ display: "none" }} />
      <div style={{ display: "grid", gap: 10 }}>
        <Field label="Название *"><input style={inputStyle} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
        <Field label="Категория *">
          <select style={inputStyle} value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
            <option value="">— выберите категорию —</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Количество"><input style={inputStyle} type="number" min="0" step="0.01" value={form.qty} onChange={(e) => setForm((p) => ({ ...p, qty: e.target.value }))} /></Field>
          <Field label="Единица измерения">
            <select style={inputStyle} value={form.unit} onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}>
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Мин. остаток"><input style={inputStyle} type="number" min="0" step="0.01" value={form.minQty} onChange={(e) => setForm((p) => ({ ...p, minQty: e.target.value }))} /></Field>
        <Field label="Поставщик"><input style={inputStyle} value={form.supplier} onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))} /></Field>
        <Field label="Цена (₸)"><input style={inputStyle} type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} /></Field>
        <Field label="Дата закупки"><input style={inputStyle} type="date" value={form.purchaseDate} onChange={(e) => setForm((p) => ({ ...p, purchaseDate: e.target.value }))} /></Field>
        <Field label="Ответственный">
          <select style={inputStyle} value={form.responsibleId} onChange={(e) => setForm((p) => ({ ...p, responsibleId: e.target.value }))}>
            <option value="">— выберите —</option>
            {allowedUsers.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Серийный / инвентарный №"><input style={inputStyle} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button style={{ ...buttonStyle(COLORS.accent), flex: 1 }} onClick={submit}>Сохранить</button>
        <button style={{ ...buttonStyle("transparent", { border: `1px solid ${COLORS.border}` }), flex: 1 }} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

function ExportPage({ assets, transfers, warehouses, users }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const whName = (id) => warehouses.find((item) => item.id === id)?.name || "—";
  const userName = (id) => users.find((item) => item.id === id)?.name || "—";

  const inRange = (value) => {
    if (!dateFrom && !dateTo) return true;
    const date = new Date(value);
    if (dateFrom && date < new Date(dateFrom)) return false;
    if (dateTo && date > new Date(`${dateTo}T23:59:59`)) return false;
    return true;
  };

  const download = (sheets, filename) => {
    const wb = XLSX.utils.book_new();
    sheets.forEach(({ name, rows }) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, filename);
  };

  const movementRows = useMemo(
    () =>
      assets.flatMap((asset) =>
        (asset.history || [])
          .filter((item) => inRange(item.date))
          .map((item) => ({
            Дата: fmt(item.date),
            "Инв. номер": asset.id,
            Наименование: asset.name,
            Категория: asset.category || "",
            Операция: item.action,
            Склад: whName(item.warehouseId),
            Количество: item.qty ?? "",
            "Ед. изм.": asset.unit || "шт",
            Выполнил: item.by || "",
            Примечание: item.notes || "",
          }))
      ),
    [assets, dateFrom, dateTo]
  );

  const writeoffRows = useMemo(
    () => movementRows.filter((item) => String(item.Операция).includes("Списано")),
    [movementRows]
  );

  const stockRows = useMemo(
    () =>
      assets
        .filter((asset) => asset.status !== "Списан")
        .map((asset) => ({
          "Инв. номер": asset.id,
          Наименование: asset.name,
          Категория: asset.category || "",
          Склад: whName(asset.warehouseId),
          Ответственный: userName(asset.responsibleId),
          Количество: asset.qty ?? 1,
          "Ед. изм.": asset.unit || "шт",
          Цена: Number(asset.price) || 0,
          Сумма: (asset.qty ?? 1) * (Number(asset.price) || 0),
          "Дата закупки": fmtD(asset.purchaseDate || asset.createdAt),
          Статус: asset.status,
        })),
    [assets]
  );

  const transferRows = useMemo(
    () =>
      transfers
        .filter((item) => inRange(item.createdAt))
        .map((item) => ({
          Накладная: item.no,
          Дата: fmt(item.createdAt),
          Наименование: item.assetName,
          "Инв. номер": item.assetId,
          Откуда: item.fromWhName,
          Куда: item.toWhName,
          Количество: item.qty ?? "",
          "Ед. изм.": item.unit || "шт",
          Отправил: item.createdBy || "",
          Подтвердил: item.confirmedBy || "",
          Статус: item.status,
        })),
    [transfers, dateFrom, dateTo]
  );

  return (
    <div>
      <Tag>БУХГАЛТЕРИЯ</Tag>
      <H1>Экспорт в Excel</H1>
      <Card>
        <SectionTitle>Фильтр по периоду</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Дата с"><input type="date" style={inputStyle} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
          <Field label="Дата по"><input type="date" style={inputStyle} value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
        </div>
      </Card>
      <Grid>
        <ExportCard title="Остатки ТМЦ" desc="Активные ТМЦ по складам" onClick={() => download([{ name: "Остатки ТМЦ", rows: stockRows }], `Остатки_ТМЦ_${Date.now()}.xlsx`)} />
        <ExportCard title="Движение ТМЦ" desc="История операций" onClick={() => download([{ name: "Движение ТМЦ", rows: movementRows }], `Движение_ТМЦ_${Date.now()}.xlsx`)} />
        <ExportCard title="Акт списания" desc="Списанные позиции" onClick={() => download([{ name: "Акт списания", rows: writeoffRows }], `Акт_списания_${Date.now()}.xlsx`)} />
        <ExportCard title="Накладные" desc="Все передачи между складами" onClick={() => download([{ name: "Накладные", rows: transferRows }], `Накладные_${Date.now()}.xlsx`)} />
        <ExportCard
          title="Полный отчет"
          desc="Все листы в одном файле"
          onClick={() =>
            download(
              [
                { name: "Остатки ТМЦ", rows: stockRows },
                { name: "Движение ТМЦ", rows: movementRows },
                { name: "Акт списания", rows: writeoffRows },
                { name: "Накладные", rows: transferRows },
              ],
              `ТМЦ_Полный_отчет_${Date.now()}.xlsx`
            )
          }
        />
      </Grid>
    </div>
  );
}

function ExportCard({ title, desc, onClick }) {
  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <Muted>{desc}</Muted>
      <button style={{ ...buttonStyle(COLORS.success), width: "100%", marginTop: 14 }} onClick={onClick}>
        Скачать .xlsx
      </button>
    </Card>
  );
}

function confirmTransfer(transfer, assets, saveAssets, transfers, saveTransfers, actor) {
  const asset = assets.find((item) => item.id === transfer.assetId);
  if (!asset) return;

  if (transfer.qty) {
    const existing = assets.find((item) => item.name === asset.name && item.warehouseId === transfer.toWhId && item.id !== asset.id);
    const historyEntry = {
      date: nowISO(),
      action: `Получено (${qtyStr(transfer.qty, transfer.unit)})`,
      warehouseId: transfer.toWhId,
      responsibleId: transfer.toResponsibleId,
      qty: transfer.qty,
      status: "На складе",
      by: actor,
      notes: transfer.notes,
    };
    if (existing) {
      saveAssets(
        assets.map((item) =>
          item.id === existing.id
            ? { ...item, qty: (item.qty || 0) + transfer.qty, history: [...(item.history || []), historyEntry] }
            : item
        )
      );
    } else {
      saveAssets([
        ...assets,
        {
          ...asset,
          id: `TMC-${uid().toUpperCase().slice(0, 8)}`,
          warehouseId: transfer.toWhId,
          responsibleId: transfer.toResponsibleId || asset.responsibleId,
          qty: transfer.qty,
          initialQty: transfer.qty,
          status: "На складе",
          history: [...(asset.history || []), historyEntry],
        },
      ]);
    }
  } else {
    saveAssets(
      assets.map((item) =>
        item.id === transfer.assetId
          ? {
              ...item,
              warehouseId: transfer.toWhId,
              responsibleId: transfer.toResponsibleId || item.responsibleId,
              status: "На складе",
              history: [
                ...(item.history || []),
                {
                  date: nowISO(),
                  action: `Получено на ${transfer.toWhName}`,
                  warehouseId: transfer.toWhId,
                  responsibleId: transfer.toResponsibleId || item.responsibleId,
                  status: "На складе",
                  by: actor,
                  notes: transfer.notes,
                },
              ],
            }
          : item
      )
    );
  }

  saveTransfers(transfers.map((item) => (item.id === transfer.id ? { ...item, status: "confirmed", confirmedAt: nowISO(), confirmedBy: actor } : item)));
}

function rejectTransfer(transfer, assets, saveAssets, transfers, saveTransfers, actor) {
  saveAssets(
    assets.map((item) =>
      item.id === transfer.assetId
        ? {
            ...item,
            qty: transfer.qty ? (item.qty || 0) + transfer.qty : item.qty,
            status: "На складе",
            history: [
              ...(item.history || []),
              {
                date: nowISO(),
                action: `Отклонено${transfer.qty ? ` (+${qtyStr(transfer.qty, transfer.unit)})` : ""}`,
                warehouseId: item.warehouseId,
                responsibleId: item.responsibleId,
                qty: transfer.qty,
                status: "На складе",
                by: actor,
                notes: transfer.notes,
              },
            ],
          }
        : item
    )
  );
  saveTransfers(transfers.map((item) => (item.id === transfer.id ? { ...item, status: "rejected", confirmedAt: nowISO(), confirmedBy: actor } : item)));
}

function approveWriteoff(asset, qtyToWrite, notes, saveAssets, assets, actor) {
  const hasQty = asset.qty !== undefined;
  const qty = hasQty ? Number(qtyToWrite || asset.qty) : null;
  const nextQty = hasQty ? asset.qty - qty : 0;
  const fullyWrittenOff = !hasQty || nextQty <= 0;
  saveAssets(
    assets.map((item) =>
      item.id === asset.id
        ? {
            ...item,
            status: fullyWrittenOff ? "Списан" : "На складе",
            qty: hasQty ? Math.max(0, nextQty) : undefined,
            pendingWOqty: null,
            history: [
              ...(item.history || []),
              {
                date: nowISO(),
                action: `Списано${hasQty ? ` (${qtyStr(qty, item.unit)})` : ""}`,
                warehouseId: item.warehouseId,
                responsibleId: item.responsibleId,
                qty,
                status: fullyWrittenOff ? "Списан" : "На складе",
                by: actor,
                notes,
              },
            ],
          }
        : item
    )
  );
}

function rejectWriteoff(asset, assets, saveAssets, actor) {
  saveAssets(
    assets.map((item) =>
      item.id === asset.id
        ? {
            ...item,
            status: "На складе",
            pendingWOqty: null,
            history: [
              ...(item.history || []),
              {
                date: nowISO(),
                action: "Отклонено списание",
                warehouseId: item.warehouseId,
                responsibleId: item.responsibleId,
                status: "На складе",
                by: actor,
                notes: "Отклонено администратором",
              },
            ],
          }
        : item
    )
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6, letterSpacing: 1 }}>{label}</div>
      {children}
    </div>
  );
}

function Card({ children, onClick, hover, style = {} }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: COLORS.surface,
        border: `1px solid ${style.borderColor || COLORS.border}`,
        borderRadius: 14,
        padding: 16,
        cursor: onClick ? "pointer" : "default",
        transition: "border-color .15s ease, transform .15s ease",
        marginBottom: 12,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (hover) {
          e.currentTarget.style.borderColor = COLORS.accent;
          e.currentTarget.style.transform = "translateY(-1px)";
        }
      }}
      onMouseLeave={(e) => {
        if (hover) {
          e.currentTarget.style.borderColor = style.borderColor || COLORS.border;
          e.currentTarget.style.transform = "translateY(0)";
        }
      }}
    >
      {children}
    </div>
  );
}

function Chip({ color = COLORS.muted, children }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color, border: `1px solid ${color}55`, background: `${color}16`, borderRadius: 999, padding: "4px 8px" }}>{children}</span>;
}

function Muted({ children, style = {} }) {
  return <div style={{ color: COLORS.muted, fontSize: 13, ...style }}>{children}</div>;
}

function Row({ children }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>{children}</div>;
}

function H1({ children, style = {} }) {
  return <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, ...style }}>{children}</div>;
}

function Tag({ children }) {
  return <div style={{ color: COLORS.accent, fontSize: 11, letterSpacing: 2, marginBottom: 4 }}>{children}</div>;
}

function ErrBox({ children }) {
  return <div style={{ background: "#f8514922", border: `1px solid ${COLORS.danger}`, color: "#ffb4b4", borderRadius: 10, padding: 10, marginBottom: 12 }}>{children}</div>;
}

function Empty({ text }) {
  return <Card><Muted style={{ textAlign: "center", padding: "20px 0" }}>{text}</Muted></Card>;
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 12, color: COLORS.muted, letterSpacing: 1.5, marginBottom: 12 }}>{children}</div>;
}

function Breadcrumb({ items }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, color: COLORS.muted, fontSize: 13 }}>
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} style={{ display: "flex", gap: 8 }}>
          {item.onClick ? (
            <span style={{ cursor: "pointer", color: COLORS.accent }} onClick={item.onClick}>{item.label}</span>
          ) : (
            <span>{item.label}</span>
          )}
          {index < items.length - 1 && <span>/</span>}
        </div>
      ))}
    </div>
  );
}

function InfoLine({ label, value }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
      <div style={{ color: COLORS.muted }}>{label}</div>
      <div>{value || "—"}</div>
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>{children}</div>;
}

function InfoBanner({ children, color }) {
  return (
    <div style={{ background: `${color}18`, border: `1px solid ${color}55`, color, borderRadius: 12, padding: 12, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function buttonStyle(background, extra = {}) {
  return {
    background,
    border: "none",
    color: COLORS.text,
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    ...extra,
  };
}
