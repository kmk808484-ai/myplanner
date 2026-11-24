(function (global) {
  'use strict';

  const IDB_NAME = 'SecondBrainOS_LocalFolderDB';
  const IDB_STORE = 'handles';
  const IDB_KEY = 'offlineRootDir';
  const PREF_KEY = 'brainOS_local_folder_prefs';
  const WORKSPACE_META_FILE = '.secondbrain-workspace.json';

  let dirHandle = null;          // Active FileSystemDirectoryHandle (granted)
  let savedHandle = null;        // Persisted handle from IndexedDB (may need permission prompt)
  let bridgeBaseUrl = '';        // Active local-bridge baseUrl if using bridge mode
  let bridgeFolderPath = '';     // Real Windows folder path when in bridge mode
  let bridgeFolderName = '';
  let activeMode = 'none';       // 'none' | 'fsa' | 'bridge'
  let lastSavedAt = 0;
  let lastSavedFile = '';
  let listeners = new Set();

  // Per-path write serialization queue to prevent createWritable() collisions
  const writeQueues = new Map();

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        autoDownload: Boolean(parsed.autoDownload),
        preferredMode: String(parsed.preferredMode || ''),
        bridgeFolderPath: String(parsed.bridgeFolderPath || '')
      };
    } catch (_) {
      return { autoDownload: false, preferredMode: '', bridgeFolderPath: '' };
    }
  }

  let prefs = loadPrefs();

  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch (_) {}
  }

  function notify() {
    const snap = getStatus();
    listeners.forEach((fn) => {
      try { fn(snap); } catch (_) {}
    });
  }

  function onStatusChange(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // ---- Safe Windows File/Folder Name Sanitizer ----
  function sanitizeName(name, fallback = 'untitled') {
    let clean = String(name || '').trim();
    clean = clean.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    clean = clean.replace(/[. ]+$/g, '');
    if (!clean || clean === '.' || clean === '..') clean = fallback;
    if (clean.length > 120) {
      const dot = clean.lastIndexOf('.');
      if (dot > 0 && clean.length - dot <= 12) {
        clean = clean.slice(0, 108) + clean.slice(dot);
      } else {
        clean = clean.slice(0, 120);
      }
    }
    return clean;
  }

  function sanitizeSegments(segments) {
    return (Array.isArray(segments) ? segments : [])
      .map((s) => sanitizeName(s, ''))
      .filter(Boolean);
  }

  // ---- IndexedDB Handle Persistence ----
  function openIdb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async function saveHandleToIdb(handle) {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (_) {}
  }

  async function loadHandleFromIdb() {
    try {
      const db = await openIdb();
      const handle = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return handle;
    } catch (_) {
      return null;
    }
  }

  async function clearHandleFromIdb() {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (_) {}
  }

  function isFsaSupported() {
    return typeof global.showDirectoryPicker === 'function';
  }

  function isConnected() {
    return (activeMode === 'fsa' && Boolean(dirHandle)) || (activeMode === 'bridge' && Boolean(bridgeBaseUrl));
  }

  function getStatus() {
    return {
      supported: isFsaSupported(),
      connected: isConnected(),
      mode: activeMode,
      folderName: activeMode === 'fsa'
        ? (dirHandle?.name || '')
        : (activeMode === 'bridge' ? (bridgeFolderName || 'offline-files') : ''),
      folderPath: activeMode === 'bridge' ? bridgeFolderPath : (dirHandle?.name || ''),
      hasSavedHandle: Boolean(savedHandle),
      savedFolderName: savedHandle?.name || '',
      autoDownload: Boolean(prefs.autoDownload),
      lastSavedAt,
      lastSavedFile
    };
  }

  function setAutoDownload(enabled) {
    prefs.autoDownload = Boolean(enabled);
    savePrefs();
    notify();
  }

  // ---- Init: Restore IndexedDB Handle or Bridge Folder ----
  async function init(options = {}) {
    const candidateBridgeUrl = String(options.bridgeUrl || '').trim().replace(/\/+$/, '');

    // 1. Try restoring previously picked FileSystemDirectoryHandle from IndexedDB
    if (isFsaSupported()) {
      const stored = await loadHandleFromIdb();
      if (stored && typeof stored.queryPermission === 'function') {
        savedHandle = stored;
        try {
          const perm = await stored.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            dirHandle = stored;
            activeMode = 'fsa';
          }
        } catch (_) {}
      }
    }

    // 2. If not connected via FSA and running on localhost / bridge requested, check bridge offline-fs
    if (!isConnected() && candidateBridgeUrl && options.checkBridge !== false) {
      await tryConnectBridgeFolder(candidateBridgeUrl, { silent: true });
    }

    notify();
    return getStatus();
  }

  // ---- Pick Folder via File System Access API ----
  async function pickFolderFSA() {
    if (!isFsaSupported()) {
      return { ok: false, reason: 'UNSUPPORTED', message: '이 브라우저는 직접 폴더 선택 API를 지원하지 않습니다.' };
    }
    try {
      const handle = await global.showDirectoryPicker({
        id: 'second-brain-offline-folder',
        mode: 'readwrite',
        startIn: 'documents'
      });
      dirHandle = handle;
      savedHandle = handle;
      activeMode = 'fsa';
      prefs.preferredMode = 'fsa';
      savePrefs();
      await saveHandleToIdb(handle);
      notify();
      return { ok: true, mode: 'fsa', folderName: handle.name };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, cancelled: true };
      }
      return {
        ok: false,
        reason: err?.name || 'ERROR',
        message: err?.message || '로컬 폴더를 열 수 없습니다.'
      };
    }
  }

  async function reconnectSavedFolder() {
    if (!savedHandle || typeof savedHandle.requestPermission !== 'function') {
      return pickFolderFSA();
    }
    try {
      const perm = await savedHandle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        dirHandle = savedHandle;
        activeMode = 'fsa';
        notify();
        return { ok: true, mode: 'fsa', folderName: dirHandle.name };
      }
      return { ok: false, cancelled: true, message: '폴더 쓰기 권한이 허용되지 않았습니다.' };
    } catch (err) {
      return { ok: false, reason: err?.name || 'ERROR', message: err?.message || '폴더 재연결 실패' };
    }
  }

  // ---- Bridge Offline-FS Mode (for localhost / local-bridge.ps1) ----
  async function getBridgeJsonHeaders(baseUrl) {
    const headers = { 'Content-Type': 'application/json' };
    if (global.BrainLocalBridge && typeof global.BrainLocalBridge.fetchBridgeSessionToken === 'function') {
      const tok = await global.BrainLocalBridge.fetchBridgeSessionToken(baseUrl || bridgeBaseUrl);
      if (tok) headers['X-Bridge-Token'] = tok;
    }
    return headers;
  }

  async function tryConnectBridgeFolder(baseUrl, opts = {}) {
    const cleanUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!cleanUrl) return { ok: false };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1400);
    try {
      const res = await fetch(`${cleanUrl}/offline-fs/status`, {
        method: 'GET',
        signal: controller.signal
      });
      if (!res.ok) return { ok: false };
      const data = await res.json().catch(() => null);
      if (!data || !data.ok) return { ok: false };

      bridgeBaseUrl = cleanUrl;
      bridgeFolderPath = data.folderPath || '';
      bridgeFolderName = data.folderName || 'offline-files';
      if (global.BrainLocalBridge && typeof global.BrainLocalBridge.fetchBridgeSessionToken === 'function') {
        global.BrainLocalBridge.fetchBridgeSessionToken(cleanUrl).catch(() => {});
      }
      if (!opts.probeOnly) {
        activeMode = 'bridge';
        prefs.preferredMode = 'bridge';
        prefs.bridgeFolderPath = bridgeFolderPath;
        savePrefs();
        notify();
      }
      return { ok: true, mode: 'bridge', folderName: bridgeFolderName, folderPath: bridgeFolderPath };
    } catch (_) {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  async function pickFolderViaBridge(baseUrl) {
    const cleanUrl = String(baseUrl || bridgeBaseUrl || '').trim().replace(/\/+$/, '');
    if (!cleanUrl) return { ok: false, message: '로컬 브릿지 주소가 없습니다.' };
    try {
      const headers = await getBridgeJsonHeaders(cleanUrl);
      const res = await fetch(`${cleanUrl}/offline-fs/pick-folder`, {
        method: 'POST',
        headers,
        body: '{}'
      });
      const data = await res.json().catch(() => ({}));
      if (data.cancelled) return { ok: false, cancelled: true };
      if (!res.ok || !data.ok) {
        return { ok: false, message: data.error || '로컬 폴더 선택에 실패했습니다.' };
      }
      bridgeBaseUrl = cleanUrl;
      bridgeFolderPath = data.folderPath || '';
      bridgeFolderName = data.folderName || 'offline-files';
      activeMode = 'bridge';
      prefs.preferredMode = 'bridge';
      prefs.bridgeFolderPath = bridgeFolderPath;
      savePrefs();
      notify();
      return { ok: true, mode: 'bridge', folderName: bridgeFolderName, folderPath: bridgeFolderPath };
    } catch (err) {
      return { ok: false, message: err?.message || '로컬 브릿지에 연결할 수 없습니다.' };
    }
  }

  async function disconnect() {
    dirHandle = null;
    savedHandle = null;
    activeMode = 'none';
    bridgeFolderPath = '';
    bridgeFolderName = '';
    prefs.preferredMode = '';
    savePrefs();
    await clearHandleFromIdb();
    notify();
  }

  // ---- Serialized Queue Helper ----
  function enqueueWrite(key, taskFn) {
    const prev = writeQueues.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(taskFn);
    writeQueues.set(key, next);
    next.finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    });
    return next;
  }

  // ---- Low-level FSA Directory & File Helpers ----
  async function getFsaDir(segments, create = true) {
    if (!dirHandle) throw new Error('로컬 폴더가 연결되어 있지 않습니다.');
    let curr = dirHandle;
    for (const seg of sanitizeSegments(segments)) {
      curr = await curr.getDirectoryHandle(seg, { create });
    }
    return curr;
  }

  async function blobToBase64(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  async function ensureSubfolder(segments) {
    const segs = sanitizeSegments(segments);
    if (segs.length === 0 || !isConnected()) return false;

    if (activeMode === 'fsa') {
      try {
        await getFsaDir(segs, true);
        return true;
      } catch (err) {
        handleFsaWriteError(err);
        return false;
      }
    }

    if (activeMode === 'bridge') {
      try {
        const headers = await getBridgeJsonHeaders(bridgeBaseUrl);
        const res = await fetch(`${bridgeBaseUrl}/offline-fs/mkdir`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ folderPath: segs })
        });
        return res.ok;
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  function handleFsaWriteError(err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      dirHandle = null;
      activeMode = 'none';
      notify();
    }
    console.warn('[BrainLocalFolder] write error:', err);
  }

  async function entryExists(folderSegments, fileName) {
    const safeFile = sanitizeName(fileName);
    const segs = sanitizeSegments(folderSegments);
    if (activeMode === 'fsa' && dirHandle) {
      try {
        const d = await getFsaDir(segs, false);
        await d.getFileHandle(safeFile, { create: false });
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  async function writeTextFile(folderSegments, fileName, textContent, opts = {}) {
    if (!isConnected()) return { ok: false };
    const segs = sanitizeSegments(folderSegments);
    const safeFile = sanitizeName(fileName, 'memo.md');
    const qKey = [...segs, safeFile].join('/');

    return enqueueWrite(qKey, async () => {
      if (opts.onlyIfMissing && await entryExists(segs, safeFile)) {
        return { ok: true, skipped: true };
      }

      if (activeMode === 'fsa') {
        try {
          const folder = await getFsaDir(segs, true);
          const fh = await folder.getFileHandle(safeFile, { create: true });
          const writable = await fh.createWritable();
          await writable.write(String(textContent ?? ''));
          await writable.close();
          if (!opts.silent) {
            lastSavedAt = Date.now();
            lastSavedFile = safeFile;
            notify();
          }
          return { ok: true, fileName: safeFile };
        } catch (err) {
          handleFsaWriteError(err);
          return { ok: false, error: err?.message };
        }
      }

      if (activeMode === 'bridge') {
        try {
          const headers = await getBridgeJsonHeaders(bridgeBaseUrl);
          const res = await fetch(`${bridgeBaseUrl}/offline-fs/write`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              folderPath: segs,
              fileName: safeFile,
              content: String(textContent ?? ''),
              isBase64: false,
              onlyIfMissing: Boolean(opts.onlyIfMissing)
            })
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok) {
            if (!opts.silent && !data.skipped) {
              lastSavedAt = Date.now();
              lastSavedFile = safeFile;
              notify();
            }
            return { ok: true, fileName: safeFile, path: data.path, skipped: Boolean(data.skipped) };
          }
          return { ok: false, error: data.error };
        } catch (err) {
          return { ok: false, error: err?.message };
        }
      }
      return { ok: false };
    });
  }

  async function writeBlobFile(folderSegments, fileName, blob, opts = {}) {
    if (!isConnected() || !blob) return { ok: false };
    const segs = sanitizeSegments(folderSegments);
    const safeFile = sanitizeName(fileName, 'file.bin');
    const qKey = [...segs, safeFile].join('/');

    return enqueueWrite(qKey, async () => {
      if (opts.onlyIfMissing && await entryExists(segs, safeFile)) {
        return { ok: true, skipped: true };
      }

      if (activeMode === 'fsa') {
        try {
          const folder = await getFsaDir(segs, true);
          const fh = await folder.getFileHandle(safeFile, { create: true });
          const writable = await fh.createWritable();
          await writable.write(blob);
          await writable.close();
          if (!opts.silent) {
            lastSavedAt = Date.now();
            lastSavedFile = safeFile;
            notify();
          }
          return { ok: true, fileName: safeFile };
        } catch (err) {
          handleFsaWriteError(err);
          return { ok: false, error: err?.message };
        }
      }

      if (activeMode === 'bridge') {
        try {
          const base64 = await blobToBase64(blob);
          const headers = await getBridgeJsonHeaders(bridgeBaseUrl);
          const res = await fetch(`${bridgeBaseUrl}/offline-fs/write`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              folderPath: segs,
              fileName: safeFile,
              content: base64,
              isBase64: true,
              onlyIfMissing: Boolean(opts.onlyIfMissing)
            })
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok) {
            if (!opts.silent && !data.skipped) {
              lastSavedAt = Date.now();
              lastSavedFile = safeFile;
              notify();
            }
            return { ok: true, fileName: safeFile, path: data.path, skipped: Boolean(data.skipped) };
          }
          return { ok: false, error: data.error };
        } catch (err) {
          return { ok: false, error: err?.message };
        }
      }
      return { ok: false };
    });
  }

  async function removeEntry(folderSegments, entryName) {
    if (!isConnected() || !entryName) return { ok: false };
    const segs = sanitizeSegments(folderSegments);
    const safeName = sanitizeName(entryName, '');
    if (!safeName) return { ok: false };

    if (activeMode === 'fsa') {
      try {
        const folder = await getFsaDir(segs, false);
        await folder.removeEntry(safeName, { recursive: true });
        return { ok: true };
      } catch (err) {
        if (err && err.name === 'NotFoundError') return { ok: true };
        handleFsaWriteError(err);
        return { ok: false, error: err?.message };
      }
    }

    if (activeMode === 'bridge') {
      try {
        const headers = await getBridgeJsonHeaders(bridgeBaseUrl);
        const res = await fetch(`${bridgeBaseUrl}/offline-fs/delete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ folderPath: segs, name: safeName })
        });
        return { ok: res.ok };
      } catch (err) {
        return { ok: false, error: err?.message };
      }
    }
    return { ok: false };
  }

  async function renameEntry(oldFolderSegments, oldName, newFolderSegments, newName) {
    if (!isConnected() || !oldName || !newName) return { ok: false };
    const oldSegs = sanitizeSegments(oldFolderSegments);
    const newSegs = sanitizeSegments(newFolderSegments);
    const safeOld = sanitizeName(oldName, '');
    const safeNew = sanitizeName(newName, '');
    if (!safeOld || !safeNew) return { ok: false };
    if (oldSegs.join('/') === newSegs.join('/') && safeOld === safeNew) return { ok: true };

    if (activeMode === 'bridge') {
      try {
        const headers = await getBridgeJsonHeaders(bridgeBaseUrl);
        const res = await fetch(`${bridgeBaseUrl}/offline-fs/rename`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            oldFolderPath: oldSegs,
            oldName: safeOld,
            newFolderPath: newSegs,
            newName: safeNew
          })
        });
        return { ok: res.ok };
      } catch (err) {
        return { ok: false, error: err?.message };
      }
    }

    // For FSA: caller writes the updated node/subtree and removes old entry
    return removeEntry(oldSegs, safeOld);
  }

  async function copyFile(srcFolderSegments, srcName, destFolderSegments, destName) {
    if (!isConnected() || !srcName || !destName) return { ok: false };
    const srcSegs = sanitizeSegments(srcFolderSegments);
    const dstSegs = sanitizeSegments(destFolderSegments);
    const safeSrc = sanitizeName(srcName, '');
    const safeDst = sanitizeName(destName, '');
    if (!safeSrc || !safeDst) return { ok: false };

    if (activeMode === 'fsa' && dirHandle) {
      try {
        const srcDir = await getFsaDir(srcSegs, false);
        const srcFh = await srcDir.getFileHandle(safeSrc, { create: false });
        const file = await srcFh.getFile();
        return writeBlobFile(dstSegs, safeDst, file, { silent: true });
      } catch (err) {
        return { ok: false, error: err?.message };
      }
    }

    if (activeMode === 'bridge') {
      try {
        const headers = await getBridgeJsonHeaders(bridgeBaseUrl);
        const res = await fetch(`${bridgeBaseUrl}/offline-fs/copy`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            srcFolderPath: srcSegs,
            srcName: safeSrc,
            destFolderPath: dstSegs,
            destName: safeDst
          })
        });
        const data = await res.json().catch(() => ({}));
        return { ok: Boolean(res.ok && data.ok), path: data.path, error: data.error };
      } catch (err) {
        return { ok: false, error: err?.message };
      }
    }
    return { ok: false };
  }

  async function saveWorkspaceMeta(fileSystem) {
    if (!isConnected() || !fileSystem) return { ok: false };
    const payload = JSON.stringify({
      version: '7.0-offline',
      savedAt: new Date().toISOString(),
      fileSystem
    }, null, 2);
    return writeTextFile([], WORKSPACE_META_FILE, payload, { silent: true });
  }

  // ---- Scan Connected Local Folder for Importing Existing Files ----
  async function scanFolderFiles() {
    if (!isConnected()) return { ok: false, folders: [], files: [] };

    if (activeMode === 'fsa' && dirHandle) {
      const folders = [];
      const files = [];

      async function walk(handle, pathSegs) {
        for await (const [name, entry] of handle.entries()) {
          if (!name || name.startsWith('.')) continue;
          if (pathSegs.length === 0 && name === 'SB') continue;
          if (entry.kind === 'directory') {
            const nextPath = [...pathSegs, name];
            folders.push(nextPath);
            await walk(entry, nextPath);
          } else if (entry.kind === 'file') {
            try {
              const file = await entry.getFile();
              files.push({
                name,
                folderPath: pathSegs,
                size: file.size,
                lastModified: file.lastModified,
                file
              });
            } catch (_) {}
          }
        }
      }

      try {
        await walk(dirHandle, []);
        return { ok: true, folders, files };
      } catch (err) {
        handleFsaWriteError(err);
        return { ok: false, folders: [], files: [], error: err?.message };
      }
    }

    if (activeMode === 'bridge') {
      try {
        const headers = await getBridgeJsonHeaders(bridgeBaseUrl);
        const res = await fetch(`${bridgeBaseUrl}/offline-fs/list`, { method: 'GET', headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) return { ok: false, folders: [], files: [] };
        return {
          ok: true,
          folders: Array.isArray(data.folders) ? data.folders : [],
          files: Array.isArray(data.files) ? data.files : []
        };
      } catch (err) {
        return { ok: false, folders: [], files: [], error: err?.message };
      }
    }

    return { ok: false, folders: [], files: [] };
  }

  // ---- Direct PC File Download Fallback (works 100% on file:// without .bat) ----
  function downloadBlobToPC(blob, fileName) {
    const safeName = sanitizeName(fileName, 'file.txt');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 3000);
    lastSavedAt = Date.now();
    lastSavedFile = safeName;
    notify();
  }

  function downloadTextToPC(textContent, fileName, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([String(textContent ?? '')], { type: mimeType });
    downloadBlobToPC(blob, fileName);
  }

  global.BrainLocalFolder = {
    WORKSPACE_META_FILE,
    sanitizeName,
    sanitizeSegments,
    isFsaSupported,
    isConnected,
    getStatus,
    setAutoDownload,
    onStatusChange,
    init,
    pickFolderFSA,
    reconnectSavedFolder,
    tryConnectBridgeFolder,
    pickFolderViaBridge,
    disconnect,
    ensureSubfolder,
    writeTextFile,
    writeBlobFile,
    removeEntry,
    renameEntry,
    copyFile,
    saveWorkspaceMeta,
    scanFolderFiles,
    downloadBlobToPC,
    downloadTextToPC
  };
})(window);
