(function (global) {
  'use strict';

  // ================= 1. Unified SVG Icon Registry =================
  const SVG_PATHS = {
    brand: '<rect x="3" y="3" width="4.5" height="4.5" rx="1.2" fill="currentColor" stroke="none"/><rect x="8.5" y="3" width="4.5" height="4.5" rx="1.2" fill="currentColor" stroke="none"/><rect x="3" y="8.5" width="4.5" height="4.5" rx="1.2" fill="currentColor" stroke="none"/><rect x="8.5" y="8.5" width="4.5" height="4.5" rx="1.2" fill="currentColor" stroke="none"/>',
    home: '<path d="M2.5 7.5L8 2.8l5.5 4.7"/><path d="M4.2 6.8V13.2h7.6V6.8"/>',
    inbox: '<path d="M2.5 9.2l1.6-5.2h7.8l1.6 5.2v3.6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9.2z"/><path d="M2.5 9.2h3.1l1.1 1.8h2.6l1.1-1.8h3.1"/>',
    project: '<path d="M2.5 4.2h4l1.4 1.6h5.6v7.4H2.5V4.2z"/>',
    area: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.8v3.4l2.2 1.4"/>',
    resource: '<path d="M3.5 2.8h6.2L12.5 5.6v7.6h-9V2.8z"/><path d="M9.5 2.8v3h3"/>',
    archive: '<rect x="2.2" y="3" width="11.6" height="3" rx="0.8"/><path d="M3.4 6v7h9.2V6"/><line x1="6.4" y1="8.8" x2="9.6" y2="8.8"/>',
    review: '<path d="M4 2.8h8v10.8l-4-2.4-4 2.4V2.8z"/>',
    explorer: '<rect x="2.2" y="3" width="11.6" height="10" rx="1.5"/><line x1="6.2" y1="3" x2="6.2" y2="13"/>',
    apps: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
    search: '<circle cx="7.2" cy="7.2" r="4.6"/><line x1="10.7" y1="10.7" x2="13.8" y2="13.8"/>',
    clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.8v3.4l2.2 1.5"/>',
    calendar: '<rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.6"/><line x1="2.4" y1="6.8" x2="13.6" y2="6.8"/><line x1="5.4" y1="2" x2="5.4" y2="4.4"/><line x1="10.6" y1="2" x2="10.6" y2="4.4"/>',
    star: '<path d="M8 2.4l1.7 3.4 3.8.5-2.7 2.6.6 3.7L8 10.9l-3.4 1.7.6-3.7-2.7-2.6 3.8-.5L8 2.4z"/>',
    doc: '<path d="M3.6 2.5h5.8l3 3v8H3.6v-11z"/><path d="M9.4 2.5v3h3"/><line x1="5.8" y1="8.2" x2="10.2" y2="8.2"/><line x1="5.8" y1="10.6" x2="8.8" y2="10.6"/>',
    folder: '<path d="M2.2 4.2h4.2l1.4 1.6h6v7.4H2.2V4.2z"/>',
    plus: '<line x1="8" y1="3.2" x2="8" y2="12.8"/><line x1="3.2" y1="8" x2="12.8" y2="8"/>',
    more: '<circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none"/>',
    user: '<circle cx="8" cy="5.6" r="2.6"/><path d="M3 13.4c.7-2.5 2.6-3.8 5-3.8s4.3 1.3 5 3.8"/>',
    check: '<path d="M3.2 8.4l3 3 6.6-6.6"/>',
    arrowRight: '<line x1="3" y1="8" x2="12.6" y2="8"/><path d="M9.2 4.6L12.6 8l-3.4 3.4"/>',
    chevronDown: '<path d="M4.2 6.2L8 10l3.8-3.8"/>',
    chevronRight: '<path d="M6.2 4.2L10 8l-3.8 3.8"/>',
    settings: '<circle cx="8" cy="8" r="2.3"/><path d="M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M12.2 3.8l-1.1 1.1M4.9 11.1l-1.1 1.1"/>',
    moon: '<path d="M12.5 9.8A5.2 5.2 0 1 1 6.2 3.5a4.2 4.2 0 0 0 6.3 6.3z"/>',
    sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"/>',
    shield: '<path d="M8 2.2l5 2v3.7c0 3.1-2.1 5.2-5 6.1-2.9-.9-5-3-5-6.1V4.2l5-2z"/>',
    backup: '<path d="M3.2 8a4.8 4.8 0 1 1 1.4 3.4"/><path d="M3.2 11.6V8h3.6"/><path d="M8 5.4V8l2 1.2"/>',
    trash: '<path d="M3.2 4.5h9.6"/><path d="M6 4.5V3h4v1.5"/><path d="M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
    edit: '<path d="M10.8 2.8l2.4 2.4-7.2 7.2H3.6V10l7.2-7.2z"/>',
    link: '<path d="M6.4 9.6l3.2-3.2"/><path d="M5.4 6.6L3.8 8.2a2.5 2.5 0 0 0 3.5 3.5l1.6-1.6"/><path d="M10.6 9.4l1.6-1.6a2.5 2.5 0 0 0-3.5-3.5L7.1 5.9"/>',
    sparkle: '<path d="M8 2l1.2 4.2L13.4 7.4l-4.2 1.2L8 12.8l-1.2-4.2-4.2-1.2 4.2-1.2L8 2z"/>',
    close: '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>',
    undo: '<path d="M4.5 6.5H10a3.2 3.2 0 1 1 0 6.4H7"/><path d="M6.8 4L4.2 6.5L6.8 9"/>',
    sheet: '<rect x="2.2" y="2.5" width="11.6" height="11" rx="2"/><line x1="2.2" y1="6.2" x2="13.8" y2="6.2"/><line x1="2.2" y1="9.8" x2="13.8" y2="9.8"/><line x1="6.8" y1="6.2" x2="6.8" y2="13.5"/>',
    chart: '<path d="M2.6 12.6h10.8"/><path d="M4.2 10.6l2.8-3.4 2.4 2 3.2-4.6"/>',
    graph: '<circle cx="8" cy="8" r="1.8"/><circle cx="3.4" cy="4.2" r="1.3"/><circle cx="12.6" cy="4.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="3.8" cy="11.8" r="1.3"/><line x1="6.7" y1="6.8" x2="4.4" y2="5"/><line x1="9.4" y1="6.9" x2="11.6" y2="5.2"/><line x1="9.2" y1="9.2" x2="11" y2="11"/><line x1="6.7" y1="9.2" x2="4.7" y2="11"/>',
    alert: '<path d="M8 2.4l6 10.8H2L8 2.4z"/><line x1="8" y1="6.6" x2="8" y2="9.4"/><circle cx="8" cy="11.2" r="0.6" fill="currentColor" stroke="none"/>'
  };

  function svgIcon(name, size = 16, cls = '') {
    const inner = SVG_PATHS[name] || SVG_PATHS.doc;
    const extraCls = cls ? ` ${cls}` : '';
    return `<svg class="sb-svg-ico${extraCls}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  // ================= 2. Secure API Key Vault (Session-Only Default + Optional AES-GCM Encrypted Vault) =================
  const SESSION_KEYS_KEY = 'brainOS_session_api_keys_v1';
  const ENCRYPTED_VAULT_KEY = 'brainOS_encrypted_api_vault_v1';
  const KEY_STORAGE_MODE_KEY = 'brainOS_api_key_mode_v1'; // 'session' | 'vault'

  let unlockedMemoryKeys = { gemini: '', openai: '', anthropic: '', grok: '' };

  function getKeyStorageMode() {
    try {
      const m = localStorage.getItem(KEY_STORAGE_MODE_KEY);
      if (m === 'vault' || m === 'session') return m;
    } catch (_) {}
    return hasEncryptedVault() ? 'vault' : 'session';
  }

  function setKeyStorageMode(mode) {
    try {
      localStorage.setItem(KEY_STORAGE_MODE_KEY, mode === 'vault' ? 'vault' : 'session');
    } catch (_) {}
  }

  function hasEncryptedVault() {
    try {
      const raw = localStorage.getItem(ENCRYPTED_VAULT_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed && parsed.v === 1 && parsed.iv && parsed.salt && parsed.data);
    } catch (_) {
      return false;
    }
  }

  function isCryptoSubtleAvailable() {
    return Boolean(global.crypto && global.crypto.subtle && typeof global.crypto.getRandomValues === 'function');
  }

  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveAesKey(passphrase, saltBytes) {
    const enc = new TextEncoder();
    const baseKey = await global.crypto.subtle.importKey(
      'raw',
      enc.encode(String(passphrase || '')),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return global.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function loadSessionKeys() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEYS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        unlockedMemoryKeys = {
          gemini: String(parsed.gemini || ''),
          openai: String(parsed.openai || ''),
          anthropic: String(parsed.anthropic || ''),
          grok: String(parsed.grok || '')
        };
      }
    } catch (_) {}
    return { ...unlockedMemoryKeys };
  }

  function saveSessionKeys(keysObj) {
    unlockedMemoryKeys = {
      gemini: String(keysObj?.gemini || '').trim(),
      openai: String(keysObj?.openai || '').trim(),
      anthropic: String(keysObj?.anthropic || '').trim(),
      grok: String(keysObj?.grok || '').trim()
    };
    try {
      sessionStorage.setItem(SESSION_KEYS_KEY, JSON.stringify(unlockedMemoryKeys));
    } catch (_) {}
    return { ...unlockedMemoryKeys };
  }

  async function saveEncryptedVault(keysObj, passphrase) {
    const cleanPass = String(passphrase || '');
    if (cleanPass.length < 4) {
      throw new Error('암호화 비밀번호는 4자 이상 입력해 주세요.');
    }
    if (!isCryptoSubtleAvailable()) {
      throw new Error('현재 환경(file:// 등)에서는 Web Crypto API가 제한되어 세션 전용 저장만 가능합니다.');
    }
    const cleanKeys = saveSessionKeys(keysObj);
    const salt = global.crypto.getRandomValues(new Uint8Array(16));
    const iv = global.crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveAesKey(cleanPass, salt);
    const plainBytes = new TextEncoder().encode(JSON.stringify(cleanKeys));
    const cipherBuf = await global.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plainBytes);
    const payload = {
      v: 1,
      alg: 'AES-256-GCM',
      salt: bytesToB64(salt),
      iv: bytesToB64(iv),
      data: bytesToB64(new Uint8Array(cipherBuf)),
      updatedAt: Date.now()
    };
    localStorage.setItem(ENCRYPTED_VAULT_KEY, JSON.stringify(payload));
    setKeyStorageMode('vault');
    return cleanKeys;
  }

  async function unlockEncryptedVault(passphrase) {
    if (!hasEncryptedVault()) {
      throw new Error('저장된 암호화 금고가 없습니다.');
    }
    if (!isCryptoSubtleAvailable()) {
      throw new Error('현재 브라우저 환경에서 암호화 금고 해제가 지원되지 않습니다.');
    }
    const raw = JSON.parse(localStorage.getItem(ENCRYPTED_VAULT_KEY));
    const salt = b64ToBytes(raw.salt);
    const iv = b64ToBytes(raw.iv);
    const data = b64ToBytes(raw.data);
    const aesKey = await deriveAesKey(passphrase, salt);
    let plainBuf;
    try {
      plainBuf = await global.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, data);
    } catch (_) {
      throw new Error('암호화 비밀번호가 일치하지 않습니다.');
    }
    const decoded = JSON.parse(new TextDecoder().decode(plainBuf));
    return saveSessionKeys(decoded);
  }

  function clearEncryptedVault() {
    try {
      localStorage.removeItem(ENCRYPTED_VAULT_KEY);
    } catch (_) {}
    setKeyStorageMode('session');
  }

  function clearAllSessionKeys() {
    unlockedMemoryKeys = { gemini: '', openai: '', anthropic: '', grok: '' };
    try { sessionStorage.removeItem(SESSION_KEYS_KEY); } catch (_) {}
  }

  function isVaultLocked() {
    if (!hasEncryptedVault()) return false;
    const cur = loadSessionKeys();
    return !Object.values(cur).some((v) => Boolean(String(v || '').trim()));
  }

  // ================= 3. Automatic Backup & Pre-Import Snapshots (IndexedDB + localStorage fallback) =================
  const BACKUP_IDB_NAME = 'SecondBrainOS_BackupDB';
  const BACKUP_STORE = 'snapshots';
  const BACKUP_LS_FALLBACK_KEY = 'brainOS_backup_snapshots_v1';
  const MAX_AUTO_SNAPSHOTS = 6;
  const MAX_PRE_IMPORT_SNAPSHOTS = 4;

  function openBackupIdb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(BACKUP_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BACKUP_STORE)) {
          db.createObjectStore(BACKUP_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async function saveSnapshot({ kind = 'auto', label = '', userEmail = '', payload }) {
    if (!payload || !payload.fileSystem) return null;
    const record = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: kind === 'pre-import' ? 'pre-import' : (kind === 'manual' ? 'manual' : 'auto'),
      label: label || (kind === 'pre-import' ? '가져오기 직전 안전 스냅샷' : (kind === 'manual' ? '수동 스냅샷' : '자동 백업')),
      userEmail: String(userEmail || 'guest').toLowerCase(),
      createdAt: Date.now(),
      payload
    };

    try {
      const db = await openBackupIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, 'readwrite');
        tx.objectStore(BACKUP_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      await pruneSnapshots(record.userEmail);
      return record;
    } catch (_) {
      // Fallback to localStorage (compact: keep latest 3)
      try {
        const raw = localStorage.getItem(BACKUP_LS_FALLBACK_KEY);
        const list = raw ? JSON.parse(raw) : [];
        list.unshift(record);
        localStorage.setItem(BACKUP_LS_FALLBACK_KEY, JSON.stringify(list.slice(0, 3)));
      } catch (__) {}
      return record;
    }
  }

  async function listSnapshots(userEmail = '') {
    const targetEmail = String(userEmail || '').toLowerCase();
    try {
      const db = await openBackupIdb();
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, 'readonly');
        const req = tx.objectStore(BACKUP_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return all
        .filter((s) => !targetEmail || s.userEmail === targetEmail)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (_) {
      try {
        const raw = localStorage.getItem(BACKUP_LS_FALLBACK_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return list
          .filter((s) => !targetEmail || s.userEmail === targetEmail)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      } catch (__) {
        return [];
      }
    }
  }

  async function getSnapshot(snapId) {
    if (!snapId) return null;
    try {
      const db = await openBackupIdb();
      const item = await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, 'readonly');
        const req = tx.objectStore(BACKUP_STORE).get(snapId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return item;
    } catch (_) {
      try {
        const list = JSON.parse(localStorage.getItem(BACKUP_LS_FALLBACK_KEY) || '[]');
        return list.find((s) => s.id === snapId) || null;
      } catch (__) {
        return null;
      }
    }
  }

  async function deleteSnapshot(snapId) {
    try {
      const db = await openBackupIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, 'readwrite');
        tx.objectStore(BACKUP_STORE).delete(snapId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (_) {}
  }

  async function pruneSnapshots(userEmail = '') {
    const all = await listSnapshots(userEmail);
    const autoList = all.filter((s) => s.kind === 'auto');
    const preImportList = all.filter((s) => s.kind === 'pre-import');
    const toDelete = [
      ...autoList.slice(MAX_AUTO_SNAPSHOTS),
      ...preImportList.slice(MAX_PRE_IMPORT_SNAPSHOTS)
    ];
    for (const s of toDelete) {
      await deleteSnapshot(s.id);
    }
  }

  global.BrainIcons = {
    svg: svgIcon,
    PATHS: SVG_PATHS
  };

  global.BrainSecurity = {
    getKeyStorageMode,
    setKeyStorageMode,
    hasEncryptedVault,
    isCryptoSubtleAvailable,
    isVaultLocked,
    loadSessionKeys,
    saveSessionKeys,
    saveEncryptedVault,
    unlockEncryptedVault,
    clearEncryptedVault,
    clearAllSessionKeys
  };

  global.BrainBackup = {
    saveSnapshot,
    listSnapshots,
    getSnapshot,
    deleteSnapshot
  };
})(window);
