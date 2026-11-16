// Sign-in state for the app (027). OAuth 2.1 authorization code + PKCE against the server's own authorization server
// (built-in public client "duniya-mobile", redirect duniya://oauth or Expo Go's exp://…/--/oauth), tokens for the
// resource <server>/api kept in the secure store (Keychain / Android Keystore), optional biometric unlock.
import * as AuthSession from 'expo-auth-session';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { createClient, discover, exchangeCode, revoke, ApiError, SCOPE, type ApiClient, type Session, type Tokens } from './api-core';
import { demoApi } from './demo';
import { normalizeServer } from './server-url';
import type { User } from './types';
import { clearCache } from './cache';

WebBrowser.maybeCompleteAuthSession(); // web only: closes the sign-in popup

const KEY = 'duniya.session';
const BIO = 'duniya.biometric';
const LOCK_AFTER_MS = 2 * 60_000;
const DEMO_BUILD = process.env.EXPO_PUBLIC_DEMO === '1';

// Secure store on phones; the web build (screenshots / demo only) keeps nothing.
const store = {
  get: (k: string) => (Platform.OS === 'web' ? Promise.resolve(null) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === 'web' ? Promise.resolve() : SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })),
  del: (k: string) => (Platform.OS === 'web' ? Promise.resolve() : SecureStore.deleteItemAsync(k)),
};
const fetchFn = (url: string, init?: RequestInit) => fetch(url, init);
// expo/fetch exposes a readable response body, so streamed answers (#66) arrive as they are written.
const streamFetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => expoFetch(url, init);
// The signed-in session (one per app). Kept outside React so the API client always reads the latest tokens.
const holder: { current: Session | null } = { current: null };
async function saveTokens(t: Tokens) {
  if (!holder.current) return;
  holder.current = { ...holder.current, ...t };
  await store.set(KEY, JSON.stringify(holder.current));
}

type AuthState = 'loading' | 'signedOut' | 'locked' | 'ready';
interface Ctx {
  state: AuthState;
  api: ApiClient | null;
  server: string;
  user: User | null;
  demo: boolean;
  notice: string;
  biometric: boolean;
  signIn: (address: string) => Promise<boolean>;
  startDemo: () => void;
  signOut: (reason?: string) => Promise<void>;
  unlock: () => Promise<void>;
  setBiometric: (on: boolean) => Promise<void>;
  setUser: (u: User) => void;
}
const AuthContext = createContext<Ctx | null>(null);
export const useAuth = () => {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
};
/** Role gate in the app mirrors the server's (the server still decides). */
export const can = (user: User | null, role: 'admin' | 'owner') => !!user && ({ viewer: 1, admin: 2, owner: 3 }[user.role] >= { admin: 2, owner: 3 }[role]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [demo, setDemo] = useState(false);
  const [notice, setNotice] = useState('');
  const [biometric, setBio] = useState(false);
  const [server, setServer] = useState('');

  const signOut = useCallback(async (reason = '') => {
    const s = holder.current;
    holder.current = null;
    if (s) revoke(s.server, s.refreshToken, fetchFn);
    await store.del(KEY);
    clearCache();
    setDemo(false); setUser(null); setNotice(reason); setState('signedOut');
  }, []);

  const api = useMemo<ApiClient | null>(() => {
    if (demo) return demoApi;
    if (state !== 'ready') return null;
    return createClient({
      getSession: () => holder.current,
      saveTokens,
      onSignedOut: (r) => { signOut(r); },
      fetchFn,
      streamFetchFn,
    });
  }, [demo, state, signOut]);

  // Restore a saved sign-in.
  useEffect(() => {
    (async () => {
      const [raw, bio] = await Promise.all([store.get(KEY), store.get(BIO)]);
      setBio(bio === '1');
      if (raw) {
        try {
          holder.current = JSON.parse(raw) as Session;
          setServer(holder.current.server);
          setState(bio === '1' ? 'locked' : 'ready');
          return;
        } catch { await store.del(KEY); }
      }
      if (DEMO_BUILD) { setDemo(true); setServer('demo'); setState('ready'); return; }
      setState('signedOut');
    })();
  }, []);

  // Who am I (role gates in the UI; the server enforces them anyway).
  useEffect(() => { api?.get<{ user: User | null }>('/api/session').then((s) => { if (s.user) setUser(s.user); }).catch(() => {}); }, [api]);

  // Lock again after the app was in the background for a while.
  useEffect(() => {
    let leftAt = 0;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') leftAt = Date.now();
      if (s === 'active' && leftAt && biometric && holder.current && Date.now() - leftAt > LOCK_AFTER_MS) setState('locked');
    });
    return () => sub.remove();
  }, [biometric]);

  const signIn = useCallback(async (address: string) => {
    const srv = normalizeServer(address);
    if (!srv) throw new ApiError('Enter the address of your Duniya panel, for example duniya.example.com', 400);
    const ep = await discover(srv, fetchFn);
    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'duniya', path: 'oauth' });
    const req = new AuthSession.AuthRequest({ clientId: ep.clientId, redirectUri, scopes: [SCOPE], usePKCE: true, extraParams: { resource: ep.resource } });
    const res = await req.promptAsync({ authorizationEndpoint: ep.authorization });
    if (res.type === 'error') throw new ApiError(res.params?.error_description || res.error?.message || 'Sign-in was refused', 401);
    if (res.type !== 'success') return false; // cancelled or dismissed
    const tokens = await exchangeCode(srv, { code: res.params.code, codeVerifier: req.codeVerifier || '', redirectUri, clientId: ep.clientId }, fetchFn);
    holder.current = { server: srv, ...tokens };
    await store.set(KEY, JSON.stringify(holder.current));
    setServer(srv); setNotice(''); setDemo(false); setState('ready');
    return true;
  }, []);

  const unlock = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Duniya', fallbackLabel: 'Use passcode' });
    if (r.success) setState('ready');
  }, []);

  const setBiometric = useCallback(async (on: boolean) => {
    if (on) {
      if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) {
        throw new ApiError('Set up Face ID, Touch ID or a fingerprint on this phone first.', 400);
      }
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Turn on unlock with biometrics' });
      if (!r.success) return;
    }
    await store.set(BIO, on ? '1' : '0');
    setBio(on);
  }, []);

  const startDemo = useCallback(() => { setDemo(true); setServer('demo'); setNotice(''); setState('ready'); }, []);

  const value = useMemo<Ctx>(() => ({ state, api, server, user, demo, notice, biometric, signIn, startDemo, signOut, unlock, setBiometric, setUser }),
    [state, api, server, user, demo, notice, biometric, signIn, startDemo, signOut, unlock, setBiometric]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
