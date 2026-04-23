import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createUser as createUserCloud,
  deleteUser as deleteUserCloud,
  loadAssetsSlice,
  loadCategoriesSlice,
  loadCloudState,
  loadTransfersSlice,
  loadUsersSlice,
  loadWarehousesSlice,
  resetUserPassword as resetUserPasswordCloud,
  saveAssets as saveAssetsCloud,
  saveCategories as saveCategoriesCloud,
  saveTransfers as saveTransfersCloud,
  updateUser as updateUserCloud,
  updateUserRole as updateUserRoleCloud,
  saveUsers as saveUsersCloud,
  saveWarehouses as saveWarehousesCloud,
} from "../lib/repository";
import { getSupabaseSession, hasSupabaseConfig, supabase } from "../lib/supabase";

const AUTH_DEBUG =
  (typeof window !== "undefined" && window.__RUNTIME_CONFIG__?.AUTH_DEBUG === "1") ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_AUTH_DEBUG === "1");
const dlog = (...args) => {
  if (!AUTH_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log("[AUTH]", new Date().toISOString().slice(11, 23), ...args);
};

async function runCloudWrite(fn, options = {}) {
  const { requiresAuth = true } = options;
  try {
    if (!hasSupabaseConfig) {
      throw new Error("Supabase is not configured.");
    }
    if (requiresAuth) {
      const authSession = await getSupabaseSession();
      if (!authSession?.user) {
        throw new Error("Not authenticated in Supabase.");
      }
    }
    await fn();
    return true;
  } catch (error) {
    console.error(error);
    alert("Ошибка синхронизации с облаком. Операция не сохранена.");
    return false;
  }
}

export function useAppState(defaults) {
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [assets, setAssets] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [session, setSessionRaw] = useState(null);
  // authDecision tracks whether we have a *definitive* answer about auth:
  //   "pending"  -> unknown (show Splash, never Login)
  //   "loggedIn" -> session has a user
  //   "loggedOut"-> user is genuinely signed out (Login is OK to render)
  const [authDecision, setAuthDecision] = useState("pending");

  // setSession is wrapped so we always keep authDecision in lockstep with
  // session, AND we can't accidentally flash `null` when the user is actually
  // logged in (a transient null without a real SIGNED_OUT is ignored).
  const setSession = useCallback((value, reason = "unknown") => {
    dlog("setSession ->", value ? `user:${value.user?.login}` : "null", "reason:", reason);
    setSessionRaw(value);
    if (value?.user) {
      setAuthDecision("loggedIn");
    } else if (reason === "signed_out" || reason === "init_resolved_null" || reason === "no_supabase") {
      setAuthDecision("loggedOut");
    }
  }, []);

  const usersRef = useRef(users);
  const warehousesRef = useRef(warehouses);
  const assetsRef = useRef(assets);
  const transfersRef = useRef(transfers);
  const categoriesRef = useRef(categories);
  useEffect(() => {
    usersRef.current = users;
  }, [users]);
  useEffect(() => {
    warehousesRef.current = warehouses;
  }, [warehouses]);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  useEffect(() => {
    transfersRef.current = transfers;
  }, [transfers]);
  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  useEffect(() => {
    let alive = true;
    let cloudLoaded = false;
    let authResolved = false;
    let latestAuthSession = null;

    const resolveSessionFromAuth = () => {
      const pool = usersRef.current || [];
      if (!latestAuthSession?.user) return null;
      const authId = latestAuthSession.user.id;
      const authEmail = (latestAuthSession.user.email || "").toLowerCase();
      const matchedUser = pool.find(
        (user) =>
          user.authUserId === authId ||
          (user.login && user.login.toLowerCase() === authEmail)
      );
      return matchedUser ? { user: matchedUser } : null;
    };

    const maybeFinishLoading = () => {
      if (!alive || !cloudLoaded || !authResolved) return;
      const resolved = resolveSessionFromAuth();
      dlog("maybeFinishLoading: resolved =", resolved ? `user:${resolved.user?.login}` : "null");
      setSession(resolved, resolved ? "init_resolved_user" : "init_resolved_null");
      setReady(true);
    };

    if (!hasSupabaseConfig) {
      setUsers([]);
      setWarehouses([]);
      setAssets([]);
      setTransfers([]);
      setCategories(defaults.categories || []);
      setSession(null, "no_supabase");
      setReady(true);
      return () => {
        alive = false;
      };
    }

    (async () => {
      try {
        const cloud = await loadCloudState();
        if (!alive) return;
        const nextUsers = cloud.users || [];
        setUsers(nextUsers);
        usersRef.current = nextUsers;
        setWarehouses(cloud.warehouses || []);
        setAssets(cloud.assets || []);
        setTransfers(cloud.transfers || []);
        setCategories(cloud.categories?.length ? cloud.categories : defaults.categories || []);
      } catch (error) {
        console.warn("Cloud state load failed:", error?.message || error);
        if (!alive) return;
        setUsers([]);
        setWarehouses([]);
        setAssets([]);
        setTransfers([]);
        setCategories(defaults.categories || []);
      } finally {
        cloudLoaded = true;
        maybeFinishLoading();
      }
    })();

    // Auth resolution: use onAuthStateChange as the single source of truth.
    // Supabase fires an INITIAL_SESSION event once the client finishes
    // hydrating from localStorage (including any token refresh), so we rely
    // on it to know the definitive auth state before rendering.
    let authSubscription = null;
    let safetyTimer = null;
    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange((event, authSession) => {
        if (!alive) return;
        dlog(
          "onAuthStateChange:",
          event,
          authSession?.user ? `user:${authSession.user.email}` : "no-user",
          "authResolved:",
          authResolved,
          "cloudLoaded:",
          cloudLoaded
        );
        latestAuthSession = authSession;

        if (!authResolved) {
          authResolved = true;
          maybeFinishLoading();
          return;
        }

        if (event === "SIGNED_OUT") {
          setSession(null, "signed_out");
          return;
        }
        if (
          (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") &&
          authSession?.user
        ) {
          const next = resolveSessionFromAuth();
          if (next) setSession(next, `event:${event}`);
        }
      });
      authSubscription = data?.subscription;

      // Safety net: if onAuthStateChange does not deliver an initial event
      // within 3s (unexpected), fall back to getSession() so we never hang.
      safetyTimer = setTimeout(async () => {
        if (!alive || authResolved) return;
        try {
          latestAuthSession = await getSupabaseSession();
        } catch {
          latestAuthSession = null;
        }
        if (!alive || authResolved) return;
        authResolved = true;
        maybeFinishLoading();
      }, 1500);
    } else {
      authResolved = true;
      maybeFinishLoading();
    }

    return () => {
      alive = false;
      if (safetyTimer) clearTimeout(safetyTimer);
      authSubscription?.unsubscribe?.();
    };
  }, [defaults]);

  const saveUsers = useCallback(async (value) => {
    const prev = usersRef.current;
    const ok = await runCloudWrite(() => saveUsersCloud(value, prev));
    if (ok) setUsers(value);
    return ok;
  }, []);

  const createUser = useCallback(async (user) => {
    try {
      if (!hasSupabaseConfig) throw new Error("Supabase is not configured.");
      const authSession = await getSupabaseSession();
      if (!authSession?.user) throw new Error("Not authenticated in Supabase.");
      const createdUser = await createUserCloud(user);
      setUsers((prev) => [...prev, createdUser]);
      return true;
    } catch (error) {
      console.error(error);
      alert("Ошибка синхронизации с облаком. Операция не сохранена.");
      return false;
    }
  }, []);

  const updateUser = useCallback(async (userId, patch) => {
    try {
      if (!hasSupabaseConfig) throw new Error("Supabase is not configured.");
      const authSession = await getSupabaseSession();
      if (!authSession?.user) throw new Error("Not authenticated in Supabase.");

      if (patch && patch.password) {
        await resetUserPasswordCloud(userId, patch.password);
      }
      if (patch && patch.role !== undefined) {
        await updateUserRoleCloud({
          userId,
          role: patch.role,
          warehouseId: patch.warehouseId,
          name: patch.name,
        });
        const { password: _pw1, role: _r, warehouseId: _w, name: _n, ...rest } = patch;
        if (Object.keys(rest).length > 0) {
          await updateUserCloud(userId, rest);
        }
      } else {
        const { password: _pw, ...rest } = patch || {};
        if (Object.keys(rest).length > 0) {
          await updateUserCloud(userId, rest);
        }
      }

      setUsers((prev) =>
        prev.map((item) =>
          item.id === userId ? { ...item, ...patch, password: patch?.password ? null : item.password } : item
        )
      );
      return true;
    } catch (error) {
      console.error(error);
      alert("Ошибка синхронизации с облаком. Операция не сохранена.");
      return false;
    }
  }, []);

  const resetUserPassword = useCallback(async (userId, password) => {
    try {
      if (!hasSupabaseConfig) throw new Error("Supabase is not configured.");
      const authSession = await getSupabaseSession();
      if (!authSession?.user) throw new Error("Not authenticated in Supabase.");
      await resetUserPasswordCloud(userId, password);
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, password: null } : u)));
      return true;
    } catch (error) {
      console.error(error);
      alert("Не удалось сбросить пароль.");
      return false;
    }
  }, []);

  const deleteUser = useCallback(async (userId) => {
    const ok = await runCloudWrite(() => deleteUserCloud(userId));
    if (ok) {
      setUsers((prev) => prev.filter((item) => item.id !== userId));
      return true;
    }
    return false;
  }, []);

  const saveWarehouses = useCallback(async (value) => {
    const prev = warehousesRef.current;
    const ok = await runCloudWrite(() => saveWarehousesCloud(value, prev));
    if (ok) setWarehouses(value);
    return ok;
  }, []);

  const saveAssets = useCallback(async (value) => {
    const prev = assetsRef.current;
    const ok = await runCloudWrite(() => saveAssetsCloud(value, prev));
    if (ok) setAssets(value);
    return ok;
  }, []);

  const saveTransfers = useCallback(async (value) => {
    const prev = transfersRef.current;
    const ok = await runCloudWrite(() => saveTransfersCloud(value, prev));
    if (ok) setTransfers(value);
    return ok;
  }, []);

  const saveCategories = useCallback(async (value) => {
    const prev = categoriesRef.current;
    const ok = await runCloudWrite(() => saveCategoriesCloud(value, prev));
    if (ok) setCategories(value);
    return ok;
  }, []);

  const saveSession = useCallback(async (value) => {
    setSession(value, value ? "save_user" : "save_null");
    return true;
  }, [setSession]);

  const clearSession = useCallback(async () => {
    setSession(null, "signed_out");
    return true;
  }, [setSession]);

  const hydrateFromCloud = useCallback((cloud) => {
    // NOTE: we intentionally do NOT touch session here. Session is owned by
    // Supabase Auth (onAuthStateChange) and must survive background refreshes.
    // Previously this function cleared session -> null on every refresh, which
    // caused Login to flash for a frame before the subsequent saveSession
    // restored it. Only hydrate the cloud data slices.
    if (cloud.users) setUsers(cloud.users);
    if (cloud.warehouses) setWarehouses(cloud.warehouses);
    if (cloud.assets) setAssets(cloud.assets);
    if (cloud.transfers) setTransfers(cloud.transfers);
    if (cloud.categories) setCategories(cloud.categories);
  }, []);

  const refreshSlice = useCallback(async (slice) => {
    if (!hasSupabaseConfig) return;
    try {
      switch (slice) {
        case "users": {
          const next = await loadUsersSlice();
          setUsers(next);
          break;
        }
        case "warehouses": {
          const next = await loadWarehousesSlice();
          setWarehouses(next);
          break;
        }
        case "assets": {
          const next = await loadAssetsSlice();
          setAssets(next);
          break;
        }
        case "transfers": {
          const next = await loadTransfersSlice();
          setTransfers(next);
          break;
        }
        case "categories": {
          const next = await loadCategoriesSlice();
          setCategories(next);
          break;
        }
        default:
          break;
      }
    } catch (error) {
      console.warn(`Failed to refresh slice ${slice}:`, error?.message || error);
    }
  }, []);

  return useMemo(
    () => ({
      ready,
      users,
      warehouses,
      assets,
      transfers,
      categories,
      session,
      authDecision,
      saveUsers,
      createUser,
      updateUser,
      resetUserPassword,
      deleteUser,
      saveWarehouses,
      saveAssets,
      saveTransfers,
      saveCategories,
      saveSession,
      clearSession,
      hydrateFromCloud,
      refreshSlice,
    }),
    [
      ready,
      users,
      warehouses,
      assets,
      transfers,
      categories,
      session,
      authDecision,
      saveSession,
      clearSession,
      hydrateFromCloud,
      refreshSlice,
    ]
  );
}
