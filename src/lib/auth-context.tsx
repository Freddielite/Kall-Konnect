import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api } from './api';
import { getRefreshToken, clearStoredSession } from './session-store';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  timezone: string | null;
  /** False for Google-only accounts. Absent on PATCH responses. */
  hasPassword?: boolean;
}

/** The browser's IANA timezone (e.g. "Africa/Lagos"), so reminders arrive
 * at the user's own local time. Undefined if the browser won't say. */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Auth now lives in an httpOnly cookie we can't read from JS, so there's
 * no token payload to hold here anymore — `session` is just "are we
 * signed in", derived from whether /auth/me succeeds. Kept as its own
 * field (rather than just using `user`) so call sites that only care about
 * "is someone logged in" don't need to know about the profile shape. */
export interface Session {
  userId: string;
}

interface AuthContextValue {
  session: Session | null;
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  deleteAccount: (confirm: { password?: string; email?: string }) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  /** Re-fetches /auth/me — used after verify-email or resend-verification
   * so `user.emailVerified` updates without a full page reload. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      const profile = await api.get<UserProfile>('/auth/me');
      setUser(profile);
      setSession({ userId: profile.id });
      // Keep the stored timezone current: fills it in for accounts created
      // before it was recorded, and follows someone who moves or travels.
      // Best-effort; reminders fall back to the server default without it.
      const tz = browserTimeZone();
      if (tz && tz !== profile.timezone) {
        api.patch<UserProfile>('/auth/me', { timezone: tz })
          .then((updated) => setUser((prev) => (prev ? { ...prev, ...updated } : updated)))
          .catch(() => {});
      }
    } catch {
      setUser(null);
      setSession(null);
    }
  }, []);

  // On first load, the only way to know if we're signed in is to ask the
  // server — the cookie (if any) travels with this request automatically.
  useEffect(() => {
    fetchProfile().finally(() => setLoading(false));
  }, [fetchProfile]);

  const login = useCallback(async (email: string, password: string) => {
    await api.post('/auth/login', { email, password }, { auth: false });
    await fetchProfile();
  }, [fetchProfile]);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    await api.post('/auth/register', { email, password, displayName, timezone: browserTimeZone() }, { auth: false });
    await fetchProfile();
  }, [fetchProfile]);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    await api.post('/auth/google', { idToken, timezone: browserTimeZone() }, { auth: false });
    await fetchProfile();
  }, [fetchProfile]);

  const logout = useCallback(async () => {
    try {
      // Where we hold the refresh token ourselves (cookie-blocked
      // browsers) it has to be sent explicitly, or the server has nothing
      // to revoke and the token stays valid until it expires.
      const refreshToken = getRefreshToken();
      await api.post('/auth/logout', refreshToken ? { refreshToken } : undefined, { auth: false });
    } catch {
      // best-effort — clear local state either way
    }
    clearStoredSession();
    setUser(null);
    setSession(null);
  }, []);

  /** Ends every session on every device, this one included. */
  const logoutAll = useCallback(async () => {
    await api.post('/auth/logout-all');
    clearStoredSession();
    setUser(null);
    setSession(null);
  }, []);

  /** Permanently deletes the account (see DELETE /account), then signs
   * out locally. `confirm` is the password, or the email for accounts
   * without one. */
  const deleteAccount = useCallback(async (confirm: { password?: string; email?: string }) => {
    await api.delete('/account', confirm);
    clearStoredSession();
    setUser(null);
    setSession(null);
  }, []);

  const updateDisplayName = useCallback(async (displayName: string) => {
    const profile = await api.patch<UserProfile>('/auth/me', { displayName });
    // Merge: the PATCH response omits hasPassword.
    setUser((prev) => (prev ? { ...prev, ...profile } : profile));
  }, []);

  return (
    <AuthContext.Provider value={{
      session, user, loading, login, register, loginWithGoogle, logout, logoutAll, deleteAccount,
      updateDisplayName, refreshProfile: fetchProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
