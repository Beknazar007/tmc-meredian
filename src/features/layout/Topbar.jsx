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
  const pr = purchaseRequestCount ?? 0;
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 20, background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ cursor: "pointer" }} onClick={() => nav("warehouses")}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: COLORS.accent }}>TMC TRACKER</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>ТМЦ Трекер</div>
        </div>
        <div style={{ flex: 1 }} />
        <NavButton active={page === "warehouses"} onClick={() => nav("warehouses")} buttonStyle={buttonStyle} COLORS={COLORS}>
          Склады{lowStockCount ? ` (${lowStockCount} мало)` : ""}
        </NavButton>
        <NavButton active={page === "requests"} onClick={() => nav("requests", {})} buttonStyle={buttonStyle} COLORS={COLORS}>
          Закупки{pr > 0 ? ` (${pr})` : ""}
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
        <div style={{ padding: "8px 10px", borderRadius: 10, background: COLORS.bg, border: `1px solid ${COLORS.border}`, fontSize: 13 }}>
          {session.user.name}
        </div>
        <button onClick={logout} style={buttonStyle("transparent", { border: `1px solid ${COLORS.border}` })}>
          Выйти
        </button>
      </div>
    </div>
  );
}
