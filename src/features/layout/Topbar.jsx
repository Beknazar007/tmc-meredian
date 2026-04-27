import { useState } from "react";

function NavButton({ children, active, onClick, buttonStyle, COLORS }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...buttonStyle(active ? `${COLORS.accent}22` : "transparent", { border: `1px solid ${active ? COLORS.accent : COLORS.border}` }),
        color: active ? COLORS.accent : COLORS.text,
      }}
    >
      {children}
    </button>
  );
}

export function Topbar({ session, isAdmin, page, nav, logout, incomingCount, writeoffCount, lowStockCount, purchaseRequestCount, COLORS, buttonStyle }) {
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const pr = purchaseRequestCount ?? 0;
  const login = String(session.user.login || "").trim() || "—";
  const displayName = String(session.user.name || "").trim();
  const showSubline = displayName && displayName.toLowerCase() !== login.toLowerCase();
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 20, background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
      {logoutConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.6)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setLogoutConfirm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 400,
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            }}
          >
            <div id="logout-confirm-title" style={{ fontWeight: 600, fontSize: 16, marginBottom: 8, color: COLORS.text }}>
              Выйти из системы?
            </div>
            <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.5, marginBottom: 20 }}>
              Вы уверены? Сессия будет завершена. Чтобы остаться, нажмите «Остаться».
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setLogoutConfirm(false)} style={buttonStyle("transparent", { border: `1px solid ${COLORS.border}` })}>
                Остаться
              </button>
              <button
                type="button"
                onClick={async () => {
                  setLogoutConfirm(false);
                  await logout();
                }}
                style={buttonStyle("#3a1a1a", { border: `1px solid ${COLORS.danger}`, color: "#fca5a5" })}
              >
                Да, выйти
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }} onClick={() => nav("warehouses")}>
          <img src="/tmc.svg" alt="ТМЦ Трекер" width={36} height={36} style={{ borderRadius: 10, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, color: COLORS.accent }}>TMC TRACKER</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>ТМЦ Трекер</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <NavButton active={page === "warehouses"} onClick={() => nav("warehouses")} buttonStyle={buttonStyle} COLORS={COLORS}>
          Склады{lowStockCount ? ` (${lowStockCount} мало)` : ""}
        </NavButton>
        <NavButton active={page === "requests"} onClick={() => nav("requests", {})} buttonStyle={buttonStyle} COLORS={COLORS}>
          Заявки{pr > 0 ? ` (${pr})` : ""}
        </NavButton>
        <NavButton active={page === "incoming"} onClick={() => nav("incoming")} buttonStyle={buttonStyle} COLORS={COLORS}>
          Входящие{incomingCount ? ` (${incomingCount})` : ""}
        </NavButton>
        {isAdmin && (
          <>
            <NavButton active={page === "writeoffs"} onClick={() => nav("writeoffs")} buttonStyle={buttonStyle} COLORS={COLORS}>
              Списания{writeoffCount ? ` (${writeoffCount})` : ""}
            </NavButton>
            <NavButton active={page === "export"} onClick={() => nav("export")} buttonStyle={buttonStyle} COLORS={COLORS}>
              Экспорт
            </NavButton>
            <NavButton active={page === "admin"} onClick={() => nav("admin")} buttonStyle={buttonStyle} COLORS={COLORS}>
              Панель
            </NavButton>
          </>
        )}
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            background: "linear-gradient(180deg, rgba(59, 130, 246, 0.08), rgba(0,0,0,0.1))",
            border: `1px solid ${COLORS.border}`,
            minWidth: 0,
            maxWidth: 220,
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", color: COLORS.muted, marginBottom: 2 }}>Пользователь</div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: COLORS.text,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
            title="Логин"
          >
            {login}
          </div>
          {showSubline && (
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={displayName}>
              {displayName}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setLogoutConfirm(true)}
          style={buttonStyle("#2b1115", { border: `1px solid ${COLORS.danger}`, color: "#f87171" })}
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
