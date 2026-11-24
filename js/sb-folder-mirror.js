(function (global) {
  'use strict';

  const SB_ROOT = 'SB';
  const MANIFEST_FILE = '.sb-mirror-manifest.json';

  let syncTimer = null;
  let syncInFlight = false;
  let syncQueued = false;

  function getManifestStorageKey() {
    const email = global.BrainStore?.getActiveUserEmail?.() || 'guest';
    return `brainOS_sb_mirror_manifest_${encodeURIComponent(String(email).toLowerCase())}`;
  }

  function loadManifest() {
    try {
      const raw = localStorage.getItem(getManifestStorageKey());
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
      };
    } catch (_) {
      return { folders: [], entries: {} };
    }
  }

  function saveManifestLocal(manifest) {
    try {
      localStorage.setItem(getManifestStorageKey(), JSON.stringify(manifest));
    } catch (_) {}
  }

  function buildMirroredFileName(paraEntity, doc, originalFileName) {
    const Store = global.BrainStore;
    const code = Store.getParaCode(paraEntity); // e.g. P-01, R-02, A-01
    const role = Store.getCardRole(doc);        // T | S | R
    const baseClean = Store.stripSbPrefix(originalFileName || doc.name || 'file.md');
    return `${code}-${role}-${baseClean}`;
  }

  function base64ToBlob(b64, mimeType = 'application/octet-stream') {
    const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  function computeDesiredMirrorPlan(hooks) {
    const Store = global.BrainStore;
    if (!Store) return { folders: [], entries: {} };
    Store.ensureParaNumbers();

    const entities = (Store.state.paraEntities || []).filter((e) =>
      e && ['project', 'area', 'resource'].includes(e.paraType)
    );

    const folderSet = new Set();
    const entityById = new Map();
    entities.forEach((ent) => {
      Store.normalizeParaEntityFields(ent);
      const folderName = Store.getSbFolderName(ent);
      folderSet.add(folderName);
      entityById.set(ent.id, { ent, folderName });
    });

    const entries = {}; // key: `${folderName}/${fileName}` -> { docId, entityId, folderName, fileName, role, updatedAt }
    const allDocs = Store.collectAllNodes(Store.state.fileSystem)
      .filter((n) => n && n.type === 'doc' && (!hooks?.isItemVisible || hooks.isItemVisible(n)));

    allDocs.forEach((doc) => {
      const linkedParaIds = new Set();
      (Store.state.relations || []).forEach((r) => {
        if (!['project', 'area', 'resource'].includes(r.type)) return;
        if (r.sourceId === doc.id && entityById.has(r.targetId)) linkedParaIds.add(r.targetId);
        if (r.targetId === doc.id && entityById.has(r.sourceId)) linkedParaIds.add(r.sourceId);
      });
      if (linkedParaIds.size === 0) return;

      const origFileName = hooks?.getLocalFileNameForItem
        ? hooks.getLocalFileNameForItem(doc)
        : (doc.name || 'memo.md');
      const role = Store.getCardRole(doc);

      linkedParaIds.forEach((eid) => {
        const meta = entityById.get(eid);
        if (!meta) return;
        const mirroredName = buildMirroredFileName(meta.ent, doc, origFileName);
        const key = `${meta.folderName}/${mirroredName}`;
        entries[key] = {
          docId: doc.id,
          entityId: eid,
          folderName: meta.folderName,
          fileName: mirroredName,
          origFileName,
          role,
          updatedAt: Number(doc.updatedAt || doc.createdAt || 0)
        };
      });
    });

    return {
      folders: Array.from(folderSet),
      entries
    };
  }

  async function writeDocMirrorCopy(doc, entry, hooks) {
    const LF = global.BrainLocalFolder;
    if (!LF || !LF.isConnected()) return false;
    const destSegs = [SB_ROOT, entry.folderName];

    // 1. Uploaded binary payload stored on node (e.g. Internal Completion deliverables)
    if (doc.uploadedBlobBase64) {
      const blob = base64ToBlob(doc.uploadedBlobBase64, doc.uploadedMime || 'application/octet-stream');
      const res = await LF.writeBlobFile(destSegs, entry.fileName, blob, { silent: true });
      return Boolean(res?.ok);
    }

    // 2. Standard serializable items (Markdown, HTML, CSV, XLSX workbook)
    if (hooks?.serializeItemForLocalFile) {
      const serialized = await hooks.serializeItemForLocalFile(doc);
      if (serialized) {
        if (serialized.type === 'blob') {
          const res = await LF.writeBlobFile(destSegs, entry.fileName, serialized.blob, { silent: true });
          return Boolean(res?.ok);
        }
        const res = await LF.writeTextFile(destSegs, entry.fileName, serialized.text, { silent: true });
        return Boolean(res?.ok);
      }
    }

    // 3. Fallback: direct physical copy from connected local folder (for arbitrary imported binary files like PDF/PNG/DOCX)
    if (hooks?.getRelativeFolderPathForItem) {
      const srcSegs = hooks.getRelativeFolderPathForItem(doc.id);
      const copyRes = await LF.copyFile(srcSegs, entry.origFileName, destSegs, entry.fileName);
      if (copyRes?.ok) return true;
    }

    return false;
  }

  async function syncAllSbMirrors(hooks, opts = {}) {
    const LF = global.BrainLocalFolder;
    const Store = global.BrainStore;
    if (!LF || !LF.isConnected() || !Store) return { ok: false, skipped: true };

    if (syncInFlight) {
      syncQueued = true;
      return { ok: true, queued: true };
    }
    syncInFlight = true;

    try {
      const prev = loadManifest();
      const desired = computeDesiredMirrorPlan(hooks);

      // 1. Ensure SB root & all PARA subfolders exist
      await LF.ensureSubfolder([SB_ROOT]);
      for (const folderName of desired.folders) {
        await LF.ensureSubfolder([SB_ROOT, folderName]);
      }

      // 2. Remove stale mirrored files (role changed, project unassigned, file renamed, or project renamed)
      let removedCount = 0;
      for (const [oldKey, oldEntry] of Object.entries(prev.entries || {})) {
        if (!desired.entries[oldKey]) {
          await LF.removeEntry([SB_ROOT, oldEntry.folderName], oldEntry.fileName).catch(() => {});
          removedCount++;
        }
      }

      // 3. Remove obsolete PARA folders that no longer exist or were renamed
      const desiredFolderSet = new Set(desired.folders);
      for (const oldFolder of prev.folders || []) {
        if (oldFolder && !desiredFolderSet.has(oldFolder)) {
          await LF.removeEntry([SB_ROOT], oldFolder).catch(() => {});
        }
      }

      // 4. Write new or updated mirrored files
      let copiedCount = 0;
      for (const [key, entry] of Object.entries(desired.entries)) {
        const prevEntry = prev.entries?.[key];
        const needsWrite = opts.force ||
          !prevEntry ||
          prevEntry.docId !== entry.docId ||
          prevEntry.role !== entry.role ||
          Number(prevEntry.updatedAt || 0) !== Number(entry.updatedAt || 0);

        if (!needsWrite) continue;
        const doc = Store.findNodeAndParent(entry.docId)?.node;
        if (!doc) continue;
        const ok = await writeDocMirrorCopy(doc, entry, hooks);
        if (ok) copiedCount++;
      }

      const nextManifest = {
        version: 1,
        updatedAt: Date.now(),
        folders: desired.folders,
        entries: desired.entries
      };
      saveManifestLocal(nextManifest);
      await LF.writeTextFile([SB_ROOT], MANIFEST_FILE, JSON.stringify(nextManifest, null, 2), { silent: true }).catch(() => {});

      return { ok: true, folders: desired.folders.length, files: Object.keys(desired.entries).length, copiedCount, removedCount };
    } finally {
      syncInFlight = false;
      if (syncQueued) {
        syncQueued = false;
        syncAllSbMirrors(hooks, {}).catch(() => {});
      }
    }
  }

  function scheduleSbMirrorSync(hooks, opts = {}) {
    const LF = global.BrainLocalFolder;
    if (!LF || !LF.isConnected()) return;
    if (syncTimer) clearTimeout(syncTimer);
    const delay = opts.immediate ? 60 : 450;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncAllSbMirrors(hooks, opts).catch(() => {});
    }, delay);
  }

  global.BrainSbMirror = {
    SB_ROOT,
    buildMirroredFileName,
    computeDesiredMirrorPlan,
    syncAllSbMirrors,
    scheduleSbMirrorSync
  };
})(window);
