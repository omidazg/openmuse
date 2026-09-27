import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { AdminSheet, type DailyUsage, type Limits } from "./admin";
import type { MuseApi } from "./api";

export type Me = {
  owner: string;
  role: "admin" | "user";
  user: { name: string; label?: string; phone?: string; plan: string } | null;
  usage: DailyUsage;
  limits: Limits;
};
type SessionValue = {
  me?: Me;
  refreshMe: () => void;
  logout: () => void;
  openAdmin: () => void;
};
const SessionContext = createContext<SessionValue | null>(null);

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("Session is unavailable");
  return context;
}

/** Who is signed in, logout, and the admin-only user manager. */
export function SessionProvider({
  api,
  logout,
  children,
}: {
  api: MuseApi;
  logout: () => void;
  children: ReactNode;
}) {
  const [me, setMe] = useState<Me>();
  const [admin, setAdmin] = useState(false);
  const refreshMe = useCallback(() => {
    // Older servers have no /api/me; the menu then simply hides admin and usage.
    void api
      .request<Me>("/api/me")
      .then(setMe)
      .catch(() => undefined);
  }, [api]);
  useEffect(refreshMe, [refreshMe]);
  const openAdmin = useCallback(() => setAdmin(true), []);
  return (
    <SessionContext.Provider value={{ me, refreshMe, logout, openAdmin }}>
      {children}
      {admin && me?.role === "admin" && (
        <AdminSheet api={api} me={me.owner} onClose={() => setAdmin(false)} />
      )}
    </SessionContext.Provider>
  );
}
