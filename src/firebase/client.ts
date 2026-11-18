import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, type Firestore } from 'firebase/firestore';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import { remoteConfigDefaults, settingsFromRemote, DEFAULT_SETTINGS, type AppSettings } from '../config/settings';

export interface FirebaseEnv {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  recaptchaSiteKey: string;
  /** `true` asks the SDK to print a new debug token; a string reuses a registered one. */
  appCheckDebugToken: string | boolean | null;
}

type EnvSource = Record<string, string | boolean | undefined>;

/** Returns null when the web app config is missing, so the UI can explain the setup. */
export function readFirebaseEnv(env: EnvSource = import.meta.env): FirebaseEnv | null {
  const get = (key: string) => {
    const value = env[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const config = {
    apiKey: get('VITE_FIREBASE_API_KEY'),
    authDomain: get('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: get('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: get('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: get('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: get('VITE_FIREBASE_APP_ID'),
  };
  if (!config.apiKey || !config.projectId || !config.appId) return null;

  const isDev = env.DEV === true;
  const debugToken = get('VITE_APPCHECK_DEBUG_TOKEN');
  const appCheckDebugToken = debugToken || (isDev ? true : null);
  const recaptchaSiteKey = get('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY');
  if (!recaptchaSiteKey && !appCheckDebugToken) return null;

  return { ...config, recaptchaSiteKey, appCheckDebugToken };
}

export interface FirebaseServices {
  app: FirebaseApp;
  ai: AI;
  auth: Auth;
  db: Firestore;
  settings: AppSettings;
}

export async function connectFirebase(env: FirebaseEnv): Promise<FirebaseServices> {
  const app = initializeApp({
    apiKey: env.apiKey,
    authDomain: env.authDomain,
    projectId: env.projectId,
    storageBucket: env.storageBucket,
    messagingSenderId: env.messagingSenderId,
    appId: env.appId,
  });

  // App Check is enforced for Firebase AI Logic. Local development uses the
  // debug provider; the deployed site uses reCAPTCHA Enterprise.
  if (env.appCheckDebugToken) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.appCheckDebugToken;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.recaptchaSiteKey || 'debug-only'),
    isTokenAutoRefreshEnabled: true,
  });

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache() });

  let settings: AppSettings = DEFAULT_SETTINGS;
  try {
    const remoteConfig = getRemoteConfig(app);
    remoteConfig.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 3_600_000;
    remoteConfig.settings.fetchTimeoutMillis = 5_000;
    remoteConfig.defaultConfig = remoteConfigDefaults();
    await fetchAndActivate(remoteConfig).catch(() => false);
    settings = settingsFromRemote((key) => getValue(remoteConfig, key).asString());
  } catch {
    settings = DEFAULT_SETTINGS;
  }

  return { app, ai, auth, db, settings };
}

/** Anonymous sign-in gives each browser its own private library in Firestore. */
export async function ensureSignedIn(auth: Auth): Promise<string> {
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  const credential = await signInAnonymously(auth);
  return credential.user.uid;
}
