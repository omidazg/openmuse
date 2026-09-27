import { useEffect, useState } from "react";
import { API_URL } from "./api";

export type ServerFeatures = { ttsEnabled?: boolean; visionEnabled?: boolean };

let pending: Promise<ServerFeatures> | undefined;

/** Optional server capabilities from /api/health, fetched once per app session. */
export function serverFeatures(): Promise<ServerFeatures> {
  pending ??= fetch(`${API_URL}/api/health`)
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => {
      pending = undefined;
      return {};
    });
  return pending;
}

export function useServerFeatures(): ServerFeatures | undefined {
  const [features, setFeatures] = useState<ServerFeatures>();
  useEffect(() => {
    let active = true;
    void serverFeatures().then((value) => {
      if (active) setFeatures(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return features;
}
