import { hasSupabaseConfig, supabase } from "./supabase";
import { CLOUD_TABLES } from "./repository";

const REALTIME_TABLES = [
  CLOUD_TABLES.users,
  CLOUD_TABLES.warehouses,
  CLOUD_TABLES.assets,
  CLOUD_TABLES.transfers,
  CLOUD_TABLES.categories,
  CLOUD_TABLES.purchaseRequests,
];

const TABLE_TO_SLICE = {
  [CLOUD_TABLES.users]: "users",
  [CLOUD_TABLES.warehouses]: "warehouses",
  [CLOUD_TABLES.assets]: "assets",
  [CLOUD_TABLES.transfers]: "transfers",
  [CLOUD_TABLES.categories]: "categories",
  [CLOUD_TABLES.purchaseRequests]: "purchaseRequests",
};

/**
 * Subscribes to Supabase Realtime changes for all core tables.
 * @param {(slice: string) => void} onSliceChange - called with slice name ("users", "assets", ...) on any insert/update/delete event.
 * @returns {() => void} unsubscribe function
 */
export function subscribeToCloudChanges(onSliceChange) {
  if (!hasSupabaseConfig || !supabase) return () => {};
  if (typeof onSliceChange !== "function") return () => {};

  const channel = supabase.channel("tmc_realtime_core");

  REALTIME_TABLES.forEach((table) => {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => {
        const slice = TABLE_TO_SLICE[payload.table] || TABLE_TO_SLICE[table];
        if (slice) {
          try {
            onSliceChange(slice);
          } catch (error) {
            console.warn("Realtime onSliceChange handler failed:", error?.message || error);
          }
        }
      }
    );
  });

  channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.warn("Supabase realtime channel status:", status);
    }
  });

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch (error) {
      console.warn("Failed to remove realtime channel:", error?.message || error);
    }
  };
}
