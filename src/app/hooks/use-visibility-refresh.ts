import { useCallback, useEffect, useRef } from "react";

type VisibilityRefreshOptions = {
  enabled?: boolean;
  intervalMs?: number;
  refreshOnVisible?: boolean;
};

/**
 * Runs background refreshes only while the document is visible and coalesces
 * concurrent triggers into at most one trailing refresh.
 */
export function useVisibilityRefresh(
  refresh: () => void | Promise<void>,
  {
    enabled = true,
    intervalMs,
    refreshOnVisible = true,
  }: VisibilityRefreshOptions = {},
) {
  const refreshRef = useRef(refresh);
  const enabledRef = useRef(enabled);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const trailingRefreshRef = useRef(false);

  useEffect(() => {
    refreshRef.current = refresh;
    enabledRef.current = enabled;
  }, [enabled, refresh]);

  const refreshNow = useCallback(async () => {
    if (!enabledRef.current || document.visibilityState === "hidden") return;

    if (inFlightRef.current) {
      trailingRefreshRef.current = true;
      await inFlightRef.current;
      return;
    }

    const run = async () => {
      do {
        trailingRefreshRef.current = false;
        await refreshRef.current();
      } while (
        trailingRefreshRef.current &&
        enabledRef.current &&
        document.visibilityState !== "hidden"
      );
    };

    inFlightRef.current = run();
    try {
      await inFlightRef.current;
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (refreshOnVisible && document.visibilityState === "visible") {
        void refreshNow();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const interval = intervalMs && intervalMs > 0
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void refreshNow();
        }, intervalMs)
      : null;

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [enabled, intervalMs, refreshNow, refreshOnVisible]);

  return refreshNow;
}
