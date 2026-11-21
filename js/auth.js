(function (global) {
  'use strict';

  const FIREBASE_SDK_VERSION = '10.14.1';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE_TOKEN_KEY = 'brainOS_drive_access_token';
  const DRIVE_TOKEN_EXP_KEY = 'brainOS_drive_access_exp';
  const DRIVE_TOKEN_EMAIL_KEY = 'brainOS_drive_access_email';
  const DRIVE_TOKEN_TTL_MS = 55 * 60 * 1000; // Google OAuth access token ~60m

  let sdkLoadPromise = null;
  let firebaseApp = null;
  let firebaseAuth = null;
  let unsubscribeAuth = null;
  let activeConfigKey = '';
  let currentUser = null;
  let stateChangeCallback = null;

  function saveDriveToken(token, email) {
    try {
      if (!token) return;
      sessionStorage.setItem(DRIVE_TOKEN_KEY, token);
      sessionStorage.setItem(DRIVE_TOKEN_EXP_KEY, String(Date.now() + DRIVE_TOKEN_TTL_MS));
      sessionStorage.setItem(DRIVE_TOKEN_EMAIL_KEY, String(email || '').trim().toLowerCase());
    } catch (_) {}
  }

  function clearDriveAccessToken() {
    try {
      sessionStorage.removeItem(DRIVE_TOKEN_KEY);
      sessionStorage.removeItem(DRIVE_TOKEN_EXP_KEY);
      sessionStorage.removeItem(DRIVE_TOKEN_EMAIL_KEY);
    } catch (_) {}
  }

  function getDriveAccessToken() {
    try {
      const token = sessionStorage.getItem(DRIVE_TOKEN_KEY);
      const exp = Number(sessionStorage.getItem(DRIVE_TOKEN_EXP_KEY) || 0);
      const tokenEmail = String(sessionStorage.getItem(DRIVE_TOKEN_EMAIL_KEY) || '').trim().toLowerCase();
      if (!token || !exp || Date.now() >= exp) {
        clearDriveAccessToken();
        return null;
      }
      const user = getUser();
      if (!user || (tokenEmail && user.email !== tokenEmail)) {
        clearDriveAccessToken();
        return null;
      }
      return token;
    } catch (_) {
      return null;
    }
  }

  function hasDriveAccess() {
    return Boolean(getDriveAccessToken());
  }

  function isFileProtocol() {
    return global.location && global.location.protocol === 'file:';
  }

  function normalizeConfig(cfg) {
    const c = cfg || {};
    const out = {
      apiKey: String(c.apiKey || '').trim(),
      authDomain: String(c.authDomain || '').trim(),
      projectId: String(c.projectId || '').trim()
    };
    if (c.storageBucket) out.storageBucket = String(c.storageBucket).trim();
    if (c.messagingSenderId) out.messagingSenderId = String(c.messagingSenderId).trim();
    if (c.appId) out.appId = String(c.appId).trim();
    return out;
  }

  function isConfigComplete(cfg) {
    const c = normalizeConfig(cfg);
    return Boolean(c.apiKey && c.authDomain && c.projectId);
  }

  // Firebase Console에서 복사한 const firebaseConfig = { ... } 전체 텍스트를 자동 파싱
  function parseFirebaseConfigText(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return null;

    const extract = (key) => {
      const re = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`);
      const m = text.match(re);
      return m ? m[1].trim() : '';
    };

    const parsed = {
      apiKey: extract('apiKey'),
      authDomain: extract('authDomain'),
      projectId: extract('projectId'),
      storageBucket: extract('storageBucket'),
      messagingSenderId: extract('messagingSenderId'),
      appId: extract('appId')
    };

    if (!parsed.apiKey && !parsed.authDomain && !parsed.projectId) {
      return null;
    }
    if (!parsed.authDomain && parsed.projectId) {
      parsed.authDomain = `${parsed.projectId}.firebaseapp.com`;
    }
    return parsed;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing && existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureFirebaseSdk() {
    if (global.firebase && global.firebase.auth) return;
    if (!sdkLoadPromise) {
      sdkLoadPromise = (async () => {
        await loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`);
        await loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth-compat.js`);
      })().catch((err) => {
        sdkLoadPromise = null;
        throw err;
      });
    }
    await sdkLoadPromise;
  }

  function formatFirebaseUser(fbUser) {
    if (!fbUser || !fbUser.email) return null;
    return {
      uid: fbUser.uid,
      email: String(fbUser.email).trim().toLowerCase(),
      name: fbUser.displayName || fbUser.email,
      picture: fbUser.photoURL || '',
      emailVerified: fbUser.emailVerified !== false
    };
  }

  async function init(firebaseConfig, onChange) {
    if (typeof onChange === 'function') {
      stateChangeCallback = onChange;
    }

    const cfg = normalizeConfig(firebaseConfig);
    if (!isConfigComplete(cfg) || isFileProtocol()) {
      currentUser = null;
      return false;
    }

    const nextKey = `${cfg.apiKey}|${cfg.authDomain}|${cfg.projectId}`;
    if (firebaseAuth && activeConfigKey === nextKey) {
      return true;
    }

    await ensureFirebaseSdk();

    if (unsubscribeAuth) {
      unsubscribeAuth();
      unsubscribeAuth = null;
    }

    if (firebaseApp) {
      try {
        await firebaseApp.delete();
      } catch (_) {}
      firebaseApp = null;
      firebaseAuth = null;
    }

    const appName = `sb-auth-${Date.now()}`;
    firebaseApp = global.firebase.initializeApp(cfg, appName);
    firebaseAuth = firebaseApp.auth();
    activeConfigKey = nextKey;

    try {
      await firebaseAuth.setPersistence(global.firebase.auth.Auth.Persistence.SESSION);
    } catch (_) {}

    currentUser = formatFirebaseUser(firebaseAuth.currentUser);

    unsubscribeAuth = firebaseAuth.onAuthStateChanged((fbUser) => {
      currentUser = formatFirebaseUser(fbUser);
      if (!currentUser) {
        clearDriveAccessToken();
      }
      if (typeof stateChangeCallback === 'function') {
        stateChangeCallback(currentUser);
      }
    });

    return true;
  }

  async function signInWithGoogle(firebaseConfig, options = {}) {
    if (isFileProtocol()) {
      throw new Error(
        'Firebase Google 로그인은 file://에서 동작하지 않습니다. local-bridge/로컬연결_실행.bat으로 http://localhost:4820을 열거나 GitHub Pages에서 접속해 주세요.'
      );
    }

    const cfg = normalizeConfig(firebaseConfig);
    if (!isConfigComplete(cfg)) {
      throw new Error('먼저 아래에 Firebase 설정(apiKey, authDomain, projectId)을 입력하고 저장해 주세요.');
    }

    await init(cfg, stateChangeCallback);

    const provider = new global.firebase.auth.GoogleAuthProvider();
    if (options.requestDrive !== false) {
      provider.addScope(DRIVE_SCOPE);
    }

    const customParams = {};
    if (options.loginHint) {
      customParams.login_hint = options.loginHint;
    } else {
      customParams.prompt = options.prompt || 'select_account';
    }
    if (options.forceConsent) {
      customParams.prompt = 'consent';
    }
    provider.setCustomParameters(customParams);

    try {
      const result = await firebaseAuth.signInWithPopup(provider);
      currentUser = formatFirebaseUser(result.user);
      const accessToken = result?.credential?.accessToken || '';
      if (accessToken && currentUser) {
        saveDriveToken(accessToken, currentUser.email);
      }
      return currentUser;
    } catch (err) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        throw new Error('Google 로그인 창이 닫혔습니다.');
      }
      if (code === 'auth/popup-blocked') {
        throw new Error('브라우저에서 로그인 팝업이 차단되었습니다. 팝업 차단을 해제하고 다시 시도해 주세요.');
      }
      if (code === 'auth/unauthorized-domain') {
        throw new Error(
          `현재 도메인(${global.location.hostname})이 Firebase 승인된 도메인에 없습니다. Firebase Console → Authentication → Settings → 승인된 도메인에 추가해 주세요.`
        );
      }
      if (code === 'auth/operation-not-allowed') {
        throw new Error(
          'Firebase Console → Authentication → Sign-in method에서 [Google] 로그인을 사용 설정(ON)해 주세요.'
        );
      }
      if (code === 'auth/invalid-api-key') {
        throw new Error('Firebase apiKey가 올바르지 않습니다. firebaseConfig 값을 다시 확인해 주세요.');
      }
      throw new Error(err?.message || 'Firebase Google 로그인에 실패했습니다.');
    }
  }

  async function reconnectDrive(firebaseConfig, forceConsent = false) {
    const user = getUser();
    return signInWithGoogle(firebaseConfig, {
      requestDrive: true,
      loginHint: user?.email || '',
      forceConsent
    });
  }

  async function signOut() {
    currentUser = null;
    clearDriveAccessToken();
    if (firebaseAuth) {
      try {
        await firebaseAuth.signOut();
      } catch (_) {}
    }
  }

  function getUser() {
    if (firebaseAuth && firebaseAuth.currentUser) {
      currentUser = formatFirebaseUser(firebaseAuth.currentUser);
    }
    return currentUser;
  }

  async function getToken(forceRefresh = false) {
    if (!firebaseAuth || !firebaseAuth.currentUser) return null;
    try {
      return await firebaseAuth.currentUser.getIdToken(forceRefresh);
    } catch (_) {
      return null;
    }
  }

  function isSignedIn() {
    return Boolean(getUser());
  }

  function isOwner(ownerEmail) {
    const user = getUser();
    const target = String(ownerEmail || '').trim().toLowerCase();
    if (!user || !target || !user.emailVerified) return false;
    return user.email === target;
  }

  global.BrainAuth = {
    DRIVE_SCOPE,
    isFileProtocol,
    isConfigComplete,
    parseFirebaseConfigText,
    init,
    signInWithGoogle,
    reconnectDrive,
    signOut,
    getUser,
    getToken,
    getDriveAccessToken,
    hasDriveAccess,
    clearDriveAccessToken,
    isSignedIn,
    isOwner
  };
})(window);
