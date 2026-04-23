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
      setError("Введите логин (или email) и пароль");
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
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24 }}>
        <Tag>АВТОРИЗАЦИЯ</Tag>
        <H1>Вход</H1>
        {error && <ErrBox>{error}</ErrBox>}
        <Field label="Логин или Email">
          <input style={inputStyle} value={login} onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>
        <Field label="Пароль">
          <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>
        <button onClick={submit} style={{ ...buttonStyle(COLORS.accent), width: "100%", marginTop: 8 }} disabled={loading || !hasSupabaseConfig}>
          {loading ? "Вход..." : "Войти"}
        </button>
        <div style={{ marginTop: 16, fontSize: 12, color: COLORS.muted, lineHeight: 1.6 }}>
          {hasSupabaseConfig
            ? "Можно входить логином (admin/sklad1/sklad2). Приложение авторизует через Supabase email вида <login>@tmc.local."
            : "Supabase не настроен: cloud-only вход отключен. Добавьте env переменные в Render."}
        </div>
      </div>
    </div>
  );
}
