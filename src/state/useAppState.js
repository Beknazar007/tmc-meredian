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
import { getSupabaseSession, hasSupabaseConfig } from "../lib/supabase";

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
  const [session, setSession] = useState(null);

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

    (async () => {
      if (!hasSupabaseConfig) {
        if (!alive) return;
        setUsers([]);
        setWarehouses([]);
        setAssets([]);
        setTransfers([]);
        setCategories(defaults.categories || []);
        setSession(null);
        setReady(true);
        return;
      }

      try {
        const cloud = await loadCloudState();
        if (!alive) return;
        setUsers(cloud.users || []);
        setWarehouses(cloud.warehouses || []);
        setAssets(cloud.assets || []);
        setTransfers(cloud.transfers || []);
        setCategories(cloud.categories?.length ? cloud.categories : defaults.categories || []);
        setSession(cloud.session || null);
      } catch (error) {
        console.warn("Cloud state load failed:", error?.message || error);
        if (!alive) return;
        setUsers([]);
        setWarehouses([]);
        setAssets([]);
        setTransfers([]);
        setCategories(defaults.categories || []);
        setSession(null);
      }

      if (alive) setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, [defaults]);

  const saveUsers = async (value) => {
    const prev = usersRef.current;
    const ok = await runCloudWrite(() => saveUsersCloud(value, prev));
    if (ok) setUsers(value);
    return ok;
  };

  const createUser = async (user) => {
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
  };

  const updateUser = async (userId, patch) => {
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
  };

  const resetUserPassword = async (userId, password) => {
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
  };

  const deleteUser = async (userId) => {
    const ok = await runCloudWrite(() => deleteUserCloud(userId));
    if (ok) {
      setUsers((prev) => prev.filter((item) => item.id !== userId));
      return true;
    }
    return false;
  };

  const saveWarehouses = async (value) => {
    const prev = warehousesRef.current;
    const ok = await runCloudWrite(() => saveWarehousesCloud(value, prev));
    if (ok) setWarehouses(value);
    return ok;
  };

  const saveAssets = async (value) => {
    const prev = assetsRef.current;
    const ok = await runCloudWrite(() => saveAssetsCloud(value, prev));
    if (ok) setAssets(value);
    return ok;
  };

  const saveTransfers = async (value) => {
    const prev = transfersRef.current;
    const ok = await runCloudWrite(() => saveTransfersCloud(value, prev));
    if (ok) setTransfers(value);
    return ok;
  };

  const saveCategories = async (value) => {
    const prev = categoriesRef.current;
    const ok = await runCloudWrite(() => saveCategoriesCloud(value, prev));
    if (ok) setCategories(value);
    return ok;
  };

  const saveSession = async (value) => {
    setSession(value);
    void value;
    return true;
  };

  const hydrateFromCloud = useCallback((cloud) => {
    const nextUsers = cloud.users || [];
    const nextWarehouses = cloud.warehouses || [];
    const nextAssets = cloud.assets || [];
    const nextTransfers = cloud.transfers || [];
    const nextCategories = cloud.categories || [];
    const nextSession = cloud.session || null;

    setUsers(nextUsers);
    setWarehouses(nextWarehouses);
    setAssets(nextAssets);
    setTransfers(nextTransfers);
    setCategories(nextCategories);
    setSession(nextSession);
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
      hydrateFromCloud,
      refreshSlice,
    }),
    [ready, users, warehouses, assets, transfers, categories, session, hydrateFromCloud, refreshSlice]
  );
}
