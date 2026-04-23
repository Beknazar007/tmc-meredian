import { useEffect, useMemo, useState } from "react";
import {
  createUser as createUserCloud,
  deleteUser as deleteUserCloud,
  loadCloudState,
  saveAssets as saveAssetsCloud,
  saveCategories as saveCategoriesCloud,
  saveSession as saveSessionCloud,
  saveTransfers as saveTransfersCloud,
  updateUser as updateUserCloud,
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
    const ok = await runCloudWrite(() => saveUsersCloud(value));
    if (ok) setUsers(value);
  };

  const createUser = async (user) => {
    const ok = await runCloudWrite(() => createUserCloud(user));
    if (ok) {
      setUsers((prev) => [...prev, user]);
      return true;
    }
    return false;
  };

  const updateUser = async (userId, patch) => {
    const ok = await runCloudWrite(() => updateUserCloud(userId, patch));
    if (ok) {
      setUsers((prev) => prev.map((item) => (item.id === userId ? { ...item, ...patch } : item)));
      return true;
    }
    return false;
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
    const ok = await runCloudWrite(() => saveWarehousesCloud(value));
    if (ok) setWarehouses(value);
  };

  const saveAssets = async (value) => {
    const ok = await runCloudWrite(() => saveAssetsCloud(value));
    if (ok) setAssets(value);
  };

  const saveTransfers = async (value) => {
    const ok = await runCloudWrite(() => saveTransfersCloud(value));
    if (ok) setTransfers(value);
  };

  const saveCategories = async (value) => {
    const ok = await runCloudWrite(() => saveCategoriesCloud(value));
    if (ok) setCategories(value);
  };

  const saveSession = async (value) => {
    setSession(value);
    await runCloudWrite(() => saveSessionCloud(value), { requiresAuth: false });
  };

  const hydrateFromCloud = (cloud) => {
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
  };

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
      deleteUser,
      saveWarehouses,
      saveAssets,
      saveTransfers,
      saveCategories,
      saveSession,
      hydrateFromCloud,
    }),
    [ready, users, warehouses, assets, transfers, categories, session]
  );
}
