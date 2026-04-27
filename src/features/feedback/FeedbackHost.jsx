import { useCallback, useEffect, useState } from "react";
import { notify, registerFeedback } from "../../lib/notify";

const C = {
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
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  padding: "10px 12px",
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box",
};

function btnStyle(bg, extra = {}) {
  return {
    background: bg,
    border: "1px solid transparent",
    color: C.text,
    borderRadius: 10,
    padding: "10px 18px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    ...extra,
  };
}

const variantBorder = {
  info: C.accent,
  success: C.success,
  error: C.danger,
  warn: C.warn,
};

let toastSeq = 0;

export function FeedbackHost() {
  const [toasts, setToasts] = useState([]);
  const [confirmSt, setConfirmSt] = useState(null);
  const [promptSt, setPromptSt] = useState(null);

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((message, variant = "info") => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, message, variant }]);
    setTimeout(() => dismissToast(id), 4800);
  }, [dismissToast]);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      setConfirmSt({ ...opts, resolve });
    });
  }, []);

  const prompt = useCallback((opts) => {
    return new Promise((resolve) => {
      setPromptSt({
        ...opts,
        value: opts.defaultValue ?? "",
        resolve,
      });
    });
  }, []);

  useEffect(() => {
    registerFeedback({ toast, confirm, prompt });
  }, [toast, confirm, prompt]);

  return (
    <>
      <div
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 400,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              pointerEvents: "auto",
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderLeft: `4px solid ${variantBorder[t.variant] || C.accent}`,
              borderRadius: 12,
              padding: "14px 16px",
              boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{t.message}</div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              style={{
                marginTop: 8,
                background: "none",
                border: "none",
                color: C.muted,
                cursor: "pointer",
                fontSize: 12,
                padding: 0,
              }}
            >
              Закрыть
            </button>
          </div>
        ))}
      </div>

      {confirmSt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            background: "rgba(5,8,12,0.72)",
            backdropFilter: "blur(4px)",
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
          onClick={() => {
            confirmSt.resolve(false);
            setConfirmSt(null);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 440,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "8px 0 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: C.accent, letterSpacing: 2, textTransform: "uppercase", padding: "0 20px" }}>
                Подтверждение
              </div>
              <h2 style={{ margin: "10px 20px 16px", fontSize: 18, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{confirmSt.title}</h2>
            </div>
            <div style={{ padding: "16px 20px 8px", fontSize: 14, color: "#cbd5e1", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{confirmSt.message}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "12px 20px 20px" }}>
              <button
                type="button"
                style={btnStyle("transparent", { border: `1px solid ${C.border}` })}
                onClick={() => {
                  confirmSt.resolve(false);
                  setConfirmSt(null);
                }}
              >
                {confirmSt.cancelText || "Отмена"}
              </button>
              <button
                type="button"
                style={btnStyle(confirmSt.danger ? "#7f1d1d" : C.accent, { border: `1px solid ${confirmSt.danger ? C.danger : C.accent}` })}
                onClick={() => {
                  confirmSt.resolve(true);
                  setConfirmSt(null);
                }}
              >
                {confirmSt.confirmText || "ОК"}
              </button>
            </div>
          </div>
        </div>
      )}

      {promptSt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            background: "rgba(5,8,12,0.72)",
            backdropFilter: "blur(4px)",
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
          onClick={() => {
            promptSt.resolve(null);
            setPromptSt(null);
          }}
        >
          <form
            style={{
              width: "100%",
              maxWidth: 440,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const val = String(fd.get("promptField") ?? "").trim();
              if (promptSt.requireNonEmpty && !val) {
                notify.warn("Заполните поле, чтобы продолжить.");
                return;
              }
              promptSt.resolve(val);
              setPromptSt(null);
            }}
          >
            <div style={{ padding: "8px 0 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: C.accent, letterSpacing: 2, textTransform: "uppercase", padding: "0 20px" }}>Ввод</div>
              <h2 style={{ margin: "10px 20px 8px", fontSize: 18, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{promptSt.title}</h2>
            </div>
            {promptSt.message && (
              <div style={{ padding: "12px 20px 0", fontSize: 14, color: "#94a3b8", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{promptSt.message}</div>
            )}
            <div style={{ padding: "16px 20px" }}>
              {promptSt.label && (
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, letterSpacing: 0.5 }}>{promptSt.label}</div>
              )}
              <input
                name="promptField"
                type={promptSt.password ? "password" : "text"}
                defaultValue={promptSt.value}
                placeholder={promptSt.placeholder || ""}
                style={inputStyle}
                autoFocus
                autoComplete={promptSt.password ? "new-password" : "off"}
              />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "0 20px 20px" }}>
              <button
                type="button"
                style={btnStyle("transparent", { border: `1px solid ${C.border}` })}
                onClick={() => {
                  promptSt.resolve(null);
                  setPromptSt(null);
                }}
              >
                {promptSt.cancelText || "Отмена"}
              </button>
              <button type="submit" style={btnStyle(C.accent, { border: `1px solid ${C.accent}` })}>
                {promptSt.confirmText || "OK"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
