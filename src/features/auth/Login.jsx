import { useState } from "react";

export function Login({ onLogin, hasSupabaseConfig, Field, inputStyle, buttonStyle, COLORS, Tag, H1, ErrBox }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    if (!hasSupabaseConfig) {
      setError("Supabase не настроен. Вход в cloud-only режиме невозможен.");
      return;
    }
    if (!login.trim() || !password) {
      setError("Введите логин и пароль");
      return;
    }
    try {
      setLoading(true);
      await onLogin({ login, password });
    } catch (err) {
      setError(err?.message || "Не удалось выполнить вход");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: `radial-gradient(120% 80% at 50% -10%, ${COLORS.accent}14, transparent), ${COLORS.bg}`,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 20,
          padding: "28px 26px 24px",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04) inset",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 8 }}>
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: 88,
              height: 88,
              borderRadius: 18,
              background: "linear-gradient(145deg, rgba(59, 130, 246, 0.12), rgba(255, 255, 255, 0.02))",
              border: `1px solid ${COLORS.border}`,
              marginBottom: 18,
            }}
          >
            <img src="/tmc.svg" alt="TMC" style={{ width: 56, height: 56, objectFit: "contain", display: "block" }} />
          </div>
          <div style={{ textAlign: "center", width: "100%" }}>
            <Tag>АВТОРИЗАЦИЯ</Tag>
            <H1>Вход</H1>
          </div>
        </div>
        {error && <ErrBox>{error}</ErrBox>}
        <Field label="Логин">
          <input style={inputStyle} value={login} onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>
        <Field label="Пароль">
          <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>
        <button onClick={submit} style={{ ...buttonStyle(COLORS.accent), width: "100%", marginTop: 10, padding: "12px 16px" }} disabled={loading || !hasSupabaseConfig}>
          {loading ? "Вход..." : "Войти"}
        </button>
        {hasSupabaseConfig ? (
          <div
            style={{
              marginTop: 20,
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(255, 255, 255, 0.03)",
              border: `1px solid ${COLORS.border}`,
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: COLORS.muted, lineHeight: 1.45 }}>
              Латинский логин или email. Короткое имя в Supabase:{" "}
              <code
                style={{
                  fontSize: 11,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  color: COLORS.text,
                  background: "rgba(59, 130, 246, 0.12)",
                  padding: "2px 6px",
                  borderRadius: 6,
                }}
              >
                логин@tmc.local
              </code>
            </p>
          </div>
        ) : (
          <p style={{ margin: "20px 0 0", fontSize: 12, color: COLORS.muted, lineHeight: 1.5, textAlign: "center" }}>
            Supabase не настроен: cloud-only вход отключен. Добавьте env переменные в Render.
          </p>
        )}
      </div>
    </div>
  );
}
