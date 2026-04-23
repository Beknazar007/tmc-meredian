import { useEffect, useMemo, useState } from "react";
import {
  loadCloudState,
  migrateLocalToCloud,
  saveAssets as saveAssetsCloud,
  saveCategories as saveCategoriesCloud,
  saveSession as saveSessionCloud,
  saveTransfers as saveTransfersCloud,
  saveUsers as saveUsersCloud,
  saveWarehouses as saveWarehousesCloud,
} from "../lib/repository";
import { getSupabaseSession, hasSupabaseConfig } from "../lib/supabase";

const storage = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore storage failures
    }
  },
};

async function runCloudWrite(fn, value, options = {}) {
  const { requiresAuth = true } = options;
  try {
    if (!hasSupabaseConfig) return;
    if (hasSupabaseConfig && requiresAuth) {
      const authSession = await getSupabaseSession();
      if (!authSession?.user) return;
    }
    await fn(value);
  } catch (error) {
    console.error(error);
    alert("Ошибка синхронизации с облаком. Данные остаются локально, проверьте настройки Supabase.");
  }
}

function createStateFromLocal(defaults) {
  return {
    users: storage.get("tmc_users", defaults.users),
    warehouses: storage.get("tmc_whs", defaults.warehouses),
    assets: storage.get("tmc_assets", []),
    transfers: storage.get("tmc_transfers", []),
    categories: storage.get("tmc_categories", defaults.categories),
    session: storage.get("tmc_session", null),
  };
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
    const local = createStateFromLocal(defaults);

    (async () => {
      let cloud = null;
      try {
        if (hasSupabaseConfig) {
          const authSession = await getSupabaseSession();
          if (authSession?.user) {
            await migrateLocalToCloud(local);
          }
        } else {
          await migrateLocalToCloud(local);
        }
      } catch (error) {
        console.warn("Local-to-cloud migration skipped:", error?.message || error);
      }

      try {
        cloud = await loadCloudState();
      } catch {
        // fallback to local below
      }

      if (!alive) return;
      if (cloud) {
        setUsers(cloud.users?.length ? cloud.users : local.users);
        setWarehouses(cloud.warehouses?.length ? cloud.warehouses : local.warehouses);
        setAssets(cloud.assets?.length ? cloud.assets : local.assets);
        setTransfers(cloud.transfers?.length ? cloud.transfers : local.transfers);
        setCategories(cloud.categories?.length ? cloud.categories : local.categories);
        setSession(cloud.session || local.session);
      } else {
        if (!alive) return;
        setUsers(local.users);
        setWarehouses(local.warehouses);
        setAssets(local.assets);
        setTransfers(local.transfers);
        setCategories(local.categories);
        setSession(local.session);
      }

      if (alive) setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, [defaults]);

  const saveUsers = (value) => {
    setUsers(value);
    storage.set("tmc_users", value);
    runCloudWrite(saveUsersCloud, value);
  };

  const saveWarehouses = (value) => {
    setWarehouses(value);
    storage.set("tmc_whs", value);
    runCloudWrite(saveWarehousesCloud, value);
  };

  const saveAssets = (value) => {
    setAssets(value);
    storage.set("tmc_assets", value);
    runCloudWrite(saveAssetsCloud, value);
  };

  const saveTransfers = (value) => {
    setTransfers(value);
    storage.set("tmc_transfers", value);
    runCloudWrite(saveTransfersCloud, value);
  };

  const saveCategories = (value) => {
    setCategories(value);
    storage.set("tmc_categories", value);
    runCloudWrite(saveCategoriesCloud, value);
  };

  const saveSession = (value) => {
    setSession(value);
    storage.set("tmc_session", value);
    runCloudWrite(saveSessionCloud, value, { requiresAuth: false });
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

    storage.set("tmc_users", nextUsers);
    storage.set("tmc_whs", nextWarehouses);
    storage.set("tmc_assets", nextAssets);
    storage.set("tmc_transfers", nextTransfers);
    storage.set("tmc_categories", nextCategories);
    storage.set("tmc_session", nextSession);
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
