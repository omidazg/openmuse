import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { AdminSheet, type DailyUsage, type Limits } from "./admin";
import type { MuseApi } from "./api";
import { BillingSheet, readBillingReturn, type SubscriptionInfo } from "./billing";
import { useWorkspace } from "./workspace";

export type Me = {
  owner: string;
  role: "admin" | "user";
  user: {
    name: string;
    label?: string;
    phone?: string;
    plan: string;
    currentPeriodEnd?: string;
  } | null;
  usage: DailyUsage;
  limits: Limits;
  /** Online payments (Zarinpal) are configured on the server. */
  billingEnabled?: boolean;
  subscription?: SubscriptionInfo;
};
type SessionValue = {
  me?: Me;
  refreshMe: () => void;
  logout: () => void;
  openAdmin: () => void;
  /** Opens «اشتراک»; a no-op while billing is disabled. */
  openBilling: () => void;
};
const SessionContext = createContext<SessionValue | null>(null);

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("Session is unavailable");
  return context;
}

/** Who is signed in, logout, subscriptions and the admin-only user manager. */
export function SessionProvider({
  api,
  logout,
  children,
}: {
  api: MuseApi;
  logout: () => void;
  children: ReactNode;
}) {
  const { notify } = useWorkspace();
  const [me, setMe] = useState<Me>();
  const [admin, setAdmin] = useState(false);
  const [billing, setBilling] = useState(false);
  const refreshMe = useCallback(() => {
    // Older servers have no /api/me; the menu then simply hides admin and usage.
    void api
      .request<Me>("/api/me")
      .then(setMe)
      .catch(() => undefined);
  }, [api]);
  useEffect(refreshMe, [refreshMe]);
  // Back from the payment gateway: show the result once.
  useEffect(() => {
    const message = readBillingReturn();
    if (message) notify(message);
  }, [notify]);
  const openAdmin = useCallback(() => setAdmin(true), []);
  const openBilling = useCallback(() => setBilling(true), []);
  return (
    <SessionContext.Provider value={{ me, refreshMe, logout, openAdmin, openBilling }}>
      {children}
      {admin && me?.role === "admin" && (
        <AdminSheet api={api} me={me.owner} onClose={() => setAdmin(false)} />
      )}
      {billing && me?.billingEnabled && (
        <BillingSheet
          api={api}
          onClose={() => {
            setBilling(false);
            refreshMe();
          }}
        />
      )}
    </SessionContext.Provider>
  );
}
