(function (global) {
  'use strict';

  const ROOT_FOLDER_NAME = 'SecondBrainOS';
  const FILES_FOLDER_NAME = 'files';
  const DB_FILE_NAME = 'second-brain-db.json';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const MULTIPART_LIMIT_BYTES = 4.5 * 1024 * 1024; // 4.5MB (Google multipart limit is 5MB)

  let cachedFolders = null; // { email, rootFolderId, filesFolderId }
  const folderPathCache = new Map(); // "email::a/b" -> folderId
  const blobUrlCache = new Map(); // fileId -> { url, mimeType, size }

  function createDriveError(message, status = 0, code = '') {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
  }

  async function parseApiError(res, fallbackMsg) {
    let data = null;
    try {
      data = await res.json();
    } catch (_) {}

    const rawMsg = data?.error?.message || '';
    const reason = data?.error?.errors?.[0]?.reason || '';

    if (res.status === 401) {
      return createDriveError(
        'Google Drive 연결 토큰이 만료되었습니다. 다시 로그인하여 연결해 주세요.',
        401,
        'AUTH_EXPIRED'
      );
    }
    if (
      res.status === 403 &&
      (reason === 'accessNotConfigured' ||
        /Drive API has not been used|is disabled/i.test(rawMsg))
    ) {
      return createDriveError(
        'Google Cloud 프로젝트에서 [Google Drive API]가 아직 활성화되지 않았습니다. Google 로그인 창의 설정 가이드를 참고해 Drive API를 켜주세요.',
        403,
        'API_DISABLED'
      );
    }
    if (res.status === 403 && (reason === 'insufficientPermissions' || /insufficient/i.test(rawMsg))) {
      return createDriveError(
        'Google Drive 접근 권한이 허용되지 않았습니다. 다시 로그인하면서 드라이브 권한을 체크해 주세요.',
        403,
        'INSUFFICIENT_SCOPE'
      );
    }
    return createDriveError(rawMsg || `${fallbackMsg} (HTTP ${res.status})`, res.status, reason || 'DRIVE_ERROR');
  }

  async function driveFetch(url, accessToken, options = {}) {
    if (!accessToken) {
      throw createDriveError('Google Drive 인증 토큰이 없습니다. Google 로그인을 진행해 주세요.', 401, 'NO_TOKEN');
    }
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {})
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      throw await parseApiError(res, 'Google Drive 요청 실패');
    }
    return res;
  }

  function escapeDriveQueryValue(str) {
    return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  async function findFileInFolder(accessToken, name, parentId = 'root', mimeType = '') {
    const parts = [
      `name = '${escapeDriveQueryValue(name)}'`,
      `'${escapeDriveQueryValue(parentId)}' in parents`,
      'trashed = false'
    ];
    if (mimeType) {
      parts.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`);
    }
    const q = encodeURIComponent(parts.join(' and '));
    const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,size,webViewLink)');
    const url = `${DRIVE_API}/files?q=${q}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=10&spaces=drive`;
    const res = await driveFetch(url, accessToken, { method: 'GET' });
    const data = await res.json();
    return Array.isArray(data.files) && data.files.length > 0 ? data.files[0] : null;
  }

  async function createFolder(accessToken, name, parentId = 'root') {
    const url = `${DRIVE_API}/files?fields=id,name,webViewLink`;
    const res = await driveFetch(url, accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    return res.json();
  }

  async function findRootAppFolder(accessToken) {
    // 1. 정확히 SecondBrainOS 우선 검색
    const exact = await findFileInFolder(
      accessToken,
      ROOT_FOLDER_NAME,
      'root',
      'application/vnd.google-apps.folder'
    );
    if (exact) return exact;

    // 2. 사용자가 직접 만든 SecondBrain / secondbrain / Second Brain OS 폴더도 대소문자 구분 없이 탐색
    const q = encodeURIComponent(
      `'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const fields = encodeURIComponent('files(id,name,modifiedTime)');
    const url = `${DRIVE_API}/files?q=${q}&fields=${fields}&pageSize=100&spaces=drive`;
    const res = await driveFetch(url, accessToken, { method: 'GET' });
    const data = await res.json();
    const candidates = (data.files || []).filter((f) => {
      const compact = String(f.name || '').toLowerCase().replace(/[\s_-]+/g, '');
      return compact === 'secondbrainos' || compact === 'secondbrain';
    });
    if (candidates.length > 0) {
      // SecondBrainOS가 있으면 최우선
      candidates.sort((a, b) => {
        const aExact = String(a.name || '').toLowerCase().replace(/[\s_-]+/g, '') === 'secondbrainos' ? 0 : 1;
        const bExact = String(b.name || '').toLowerCase().replace(/[\s_-]+/g, '') === 'secondbrainos' ? 0 : 1;
        return aExact - bExact;
      });
      return candidates[0];
    }
    return null;
  }

  async function ensureAppFolders(accessToken, userEmail = '') {
    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    if (
      cachedFolders &&
      cachedFolders.email === normalizedEmail &&
      cachedFolders.rootFolderId
    ) {
      return cachedFolders;
    }

    let rootFolder = await findRootAppFolder(accessToken);
    if (!rootFolder) {
      rootFolder = await createFolder(accessToken, ROOT_FOLDER_NAME, 'root');
    }

    // 기존 레거시 files 폴더가 이미 있으면 스캔 호환용으로 ID만 기록 (신규 생성 안 함)
    const legacyFilesFolder = await findFileInFolder(
      accessToken,
      FILES_FOLDER_NAME,
      rootFolder.id,
      'application/vnd.google-apps.folder'
    );

    cachedFolders = {
      email: normalizedEmail,
      rootFolderId: rootFolder.id,
      filesFolderId: legacyFilesFolder ? legacyFilesFolder.id : ''
    };
    return cachedFolders;
  }

  async function ensureFolderPath(accessToken, folderNames = [], userEmail = '') {
    const folders = await ensureAppFolders(accessToken, userEmail);
    const cleanSegments = (folderNames || [])
      .map((s) => String(s || '').trim())
      .filter((s) => Boolean(s));

    if (cleanSegments.length === 0) return folders.rootFolderId;

    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    const cacheKey = `${normalizedEmail}::${cleanSegments.join('/')}`;
    if (folderPathCache.has(cacheKey)) {
      return folderPathCache.get(cacheKey);
    }

    let parentId = folders.rootFolderId;
    let partial = '';
    for (const seg of cleanSegments) {
      partial = partial ? `${partial}/${seg}` : seg;
      const pKey = `${normalizedEmail}::${partial}`;
      if (folderPathCache.has(pKey)) {
        parentId = folderPathCache.get(pKey);
        continue;
      }
      let found = await findFileInFolder(accessToken, seg, parentId, 'application/vnd.google-apps.folder');
      if (!found) {
        found = await createFolder(accessToken, seg, parentId);
      }
      parentId = found.id;
      folderPathCache.set(pKey, parentId);
    }
    return parentId;
  }

  function clearCache() {
    cachedFolders = null;
    folderPathCache.clear();
    for (const entry of blobUrlCache.values()) {
      try {
        URL.revokeObjectURL(entry.url);
      } catch (_) {}
    }
    blobUrlCache.clear();
  }

  function getRootFolderUrl() {
    if (cachedFolders && cachedFolders.rootFolderId) {
      return `https://drive.google.com/drive/folders/${cachedFolders.rootFolderId}`;
    }
    return 'https://drive.google.com/drive/my-drive';
  }

  async function downloadDatabase(accessToken, userEmail = '') {
    const folders = await ensureAppFolders(accessToken, userEmail);
    const dbFile = await findFileInFolder(accessToken, DB_FILE_NAME, folders.rootFolderId);
    if (!dbFile) {
      return {
        exists: false,
        fileId: null,
        data: null,
        rootFolderId: folders.rootFolderId
      };
    }

    const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(dbFile.id)}?alt=media`, accessToken, {
      method: 'GET'
    });
    const data = await res.json();
    return {
      exists: true,
      fileId: dbFile.id,
      modifiedTime: dbFile.modifiedTime || '',
      data,
      rootFolderId: folders.rootFolderId
    };
  }

  async function uploadDatabase(accessToken, payload, existingFileId = '', userEmail = '') {
    const folders = await ensureAppFolders(accessToken, userEmail);
    let targetId = existingFileId;

    if (!targetId) {
      const existing = await findFileInFolder(accessToken, DB_FILE_NAME, folders.rootFolderId);
      if (existing) targetId = existing.id;
    }

    const jsonBlob = new Blob([JSON.stringify(payload)], { type: 'application/json; charset=utf-8' });

    if (targetId) {
      // 기존 second-brain-db.json 내용만 덮어쓰기 (중복 파일 방지)
      const url = `${UPLOAD_API}/files/${encodeURIComponent(targetId)}?uploadType=media&fields=id,name,modifiedTime`;
      try {
        const res = await driveFetch(url, accessToken, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: jsonBlob
        });
        const updated = await res.json();
        return {
          fileId: updated.id,
          modifiedTime: updated.modifiedTime || new Date().toISOString(),
          rootFolderId: folders.rootFolderId
        };
      } catch (err) {
        // 다른 계정/삭제된 파일 ID 등으로 404가 난 경우 새 파일 생성으로 자동 복구
        if (err.status !== 404) throw err;
        targetId = '';
      }
    }

    // 신규 생성 (multipart)
    const boundary = `sb_boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const metadata = {
      name: DB_FILE_NAME,
      parents: [folders.rootFolderId],
      mimeType: 'application/json'
    };
    const multipartBody = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      jsonBlob,
      `\r\n--${boundary}--`
    ]);

    const url = `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime`;
    const res = await driveFetch(url, accessToken, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody
    });
    const created = await res.json();
    return {
      fileId: created.id,
      modifiedTime: created.modifiedTime || new Date().toISOString(),
      rootFolderId: folders.rootFolderId
    };
  }

  function guessMimeType(file) {
    if (file && file.type) return file.type;
    const name = String(file?.name || '').toLowerCase();
    if (name.endsWith('.pdf')) return 'application/pdf';
    if (name.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (name.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
    if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (name.endsWith('.doc')) return 'application/msword';
    if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (name.endsWith('.xls')) return 'application/vnd.ms-excel';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.svg')) return 'image/svg+xml';
    if (name.endsWith('.bmp')) return 'image/bmp';
    if (name.endsWith('.mp4')) return 'video/mp4';
    if (name.endsWith('.mp3')) return 'audio/mpeg';
    if (name.endsWith('.wav')) return 'audio/wav';
    if (name.endsWith('.zip')) return 'application/zip';
    if (name.endsWith('.html') || name.endsWith('.htm')) return 'text/html';
    if (name.endsWith('.md')) return 'text/markdown';
    if (name.endsWith('.txt')) return 'text/plain';
    return 'application/octet-stream';
  }

  async function uploadFileMultipart(accessToken, file, filesFolderId, mimeType) {
    const boundary = `sb_file_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const metadata = {
      name: file.name,
      parents: [filesFolderId],
      mimeType
    };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`
    ]);

    const fields = encodeURIComponent('id,name,mimeType,size,webViewLink,modifiedTime');
    const url = `${UPLOAD_API}/files?uploadType=multipart&fields=${fields}`;
    const res = await driveFetch(url, accessToken, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    return res.json();
  }

  async function uploadFileResumable(accessToken, file, filesFolderId, mimeType) {
    const fields = encodeURIComponent('id,name,mimeType,size,webViewLink,modifiedTime');
    const initUrl = `${UPLOAD_API}/files?uploadType=resumable&fields=${fields}`;
    const initRes = await driveFetch(initUrl, accessToken, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(file.size)
      },
      body: JSON.stringify({
        name: file.name,
        parents: [filesFolderId],
        mimeType
      })
    });

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      throw createDriveError('대용량 파일 업로드 세션을 시작하지 못했습니다.', 500, 'NO_RESUMABLE_LOCATION');
    }

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType
      },
      body: file
    });
    if (!putRes.ok) {
      throw await parseApiError(putRes, '파일 업로드 실패');
    }
    return putRes.json();
  }

  async function uploadFile(accessToken, file, userEmail = '', folderPath = []) {
    const mimeType = guessMimeType(file);
    return upsertBinaryFile(accessToken, {
      fileId: '',
      name: file.name,
      blob: file,
      mimeType,
      folderPath,
      userEmail
    });
  }

  async function moveFile(accessToken, fileId, targetFolderPath = [], userEmail = '') {
    if (!fileId) return null;
    const targetParentId = await ensureFolderPath(accessToken, targetFolderPath, userEmail);
    const metaRes = await driveFetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,parents`,
      accessToken,
      { method: 'GET' }
    );
    const meta = await metaRes.json();
    const prevParents = Array.isArray(meta.parents) ? meta.parents : [];
    if (prevParents.length === 1 && prevParents[0] === targetParentId) return meta;

    const removeParam = prevParents.length > 0 ? `&removeParents=${encodeURIComponent(prevParents.join(','))}` : '';
    const moveRes = await driveFetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(targetParentId)}${removeParam}&fields=id,parents`,
      accessToken,
      { method: 'PATCH' }
    );
    return moveRes.json();
  }

  async function getFileBlobUrl(accessToken, fileId, fallbackMimeType = '') {
    if (!fileId) throw createDriveError('유효하지 않은 Drive 파일 ID입니다.', 400, 'INVALID_ID');
    const cached = blobUrlCache.get(fileId);
    if (cached) return cached;

    const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await driveFetch(url, accessToken, { method: 'GET' });
    const rawBlob = await res.blob();
    const mimeType = fallbackMimeType || rawBlob.type || 'application/octet-stream';
    const typedBlob = rawBlob.type === mimeType ? rawBlob : new Blob([rawBlob], { type: mimeType });
    const blobUrl = URL.createObjectURL(typedBlob);

    const entry = { url: blobUrl, mimeType, size: typedBlob.size };
    blobUrlCache.set(fileId, entry);
    return entry;
  }

  async function getFileBase64(accessToken, fileId) {
    if (!fileId) throw createDriveError('유효하지 않은 Drive 파일 ID입니다.', 400, 'INVALID_ID');
    const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await driveFetch(url, accessToken, { method: 'GET' });
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = () => reject(createDriveError('파일 데이터를 읽지 못했습니다.', 500, 'READ_ERROR'));
      reader.readAsDataURL(blob);
    });
  }

  function getPreviewEmbedUrl(fileId) {
    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
  }

  function getWebViewUrl(driveFile) {
    if (driveFile && driveFile.webViewLink) return driveFile.webViewLink;
    if (driveFile && driveFile.id) return `https://drive.google.com/file/d/${encodeURIComponent(driveFile.id)}/view`;
    return '';
  }

  function getFileCategory(driveFile) {
    if (!driveFile) return 'other';
    const mime = String(driveFile.mimeType || '').toLowerCase();
    const name = String(driveFile.name || '').toLowerCase();

    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(name)) return 'image';
    if (mime === 'application/pdf' || /\.pdf$/.test(name)) return 'pdf';
    if (
      mime.includes('presentation') ||
      mime.includes('powerpoint') ||
      /\.(pptx?|key|odp)$/.test(name)
    ) return 'ppt';
    if (
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      /\.(xlsx?|ods)$/.test(name)
    ) return 'excel';
    if (
      mime.includes('wordprocessing') ||
      mime.includes('msword') ||
      /\.(docx?|hwp|hwpx|odt)$/.test(name)
    ) return 'word';
    if (mime.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi)$/.test(name)) return 'video';
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/.test(name)) return 'audio';
    return 'other';
  }

  function formatFileSize(bytes) {
    const n = Number(bytes || 0);
    if (!n || n < 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async function upsertTextFile(accessToken, { fileId = '', name, content = '', mimeType = '', folderPath = [], userEmail = '' }) {
    const safeName = String(name || '새 메모.md').trim() || '새 메모.md';
    const resolvedMime = mimeType || guessMimeType({ name: safeName });
    const parentId = await ensureFolderPath(accessToken, folderPath, userEmail);
    const blob = new Blob([String(content || '')], { type: `${resolvedMime}; charset=utf-8` });

    let targetId = String(fileId || '').trim();
    if (!targetId) {
      const existing = await findFileInFolder(accessToken, safeName, parentId);
      if (existing && existing.mimeType !== 'application/vnd.google-apps.folder') {
        targetId = existing.id;
      }
    }

    const fields = encodeURIComponent('id,name,mimeType,size,webViewLink,modifiedTime');

    if (targetId) {
      const boundary = `sb_txt_patch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
        JSON.stringify({ name: safeName }),
        `\r\n--${boundary}\r\nContent-Type: ${resolvedMime}; charset=UTF-8\r\n\r\n`,
        blob,
        `\r\n--${boundary}--`
      ]);
      try {
        const res = await driveFetch(
          `${UPLOAD_API}/files/${encodeURIComponent(targetId)}?uploadType=multipart&fields=${fields}`,
          accessToken,
          {
            method: 'PATCH',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
          }
        );
        return res.json();
      } catch (err) {
        if (err.status !== 404) throw err;
        targetId = '';
      }
    }

    const boundary = `sb_txt_new_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify({ name: safeName, parents: [parentId], mimeType: resolvedMime }),
      `\r\n--${boundary}\r\nContent-Type: ${resolvedMime}; charset=UTF-8\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`
    ]);
    const res = await driveFetch(
      `${UPLOAD_API}/files?uploadType=multipart&fields=${fields}`,
      accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      }
    );
    return res.json();
  }

  async function renameFile(accessToken, fileId, newName) {
    if (!fileId || !newName) return null;
    const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime`;
    const res = await driveFetch(url, accessToken, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: String(newName).trim() })
    });
    return res.json();
  }

  async function downloadTextFile(accessToken, fileId) {
    const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await driveFetch(url, accessToken, { method: 'GET' });
    return res.text();
  }

  async function listChildrenInFolder(accessToken, folderId) {
    const results = [];
    let pageToken = '';
    do {
      const q = encodeURIComponent(`'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`);
      const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)');
      const url =
        `${DRIVE_API}/files?q=${q}&fields=${fields}&pageSize=100&spaces=drive` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const res = await driveFetch(url, accessToken, { method: 'GET' });
      const data = await res.json();
      if (Array.isArray(data.files)) results.push(...data.files);
      pageToken = data.nextPageToken || '';
    } while (pageToken && results.length < 500);
    return results;
  }

  async function scanAppFolder(accessToken, userEmail = '') {
    const folders = await ensureAppFolders(accessToken, userEmail);
    const foundFiles = [];
    const foundFolderPaths = [];

    async function walk(folderId, relPath, depth) {
      if (depth > 5) return;
      const children = await listChildrenInFolder(accessToken, folderId);
      for (const child of children) {
        if (child.mimeType === 'application/vnd.google-apps.folder') {
          // 레거시 files 폴더가 남아있으면 하위 파일만 루트로 스캔
          if (depth === 0 && folders.filesFolderId && child.id === folders.filesFolderId) {
            await walk(child.id, relPath, depth + 1);
          } else {
            const nextPath = [...relPath, child.name];
            foundFolderPaths.push(nextPath);
            await walk(child.id, nextPath, depth + 1);
          }
          continue;
        }
        // DB 메타파일 자체는 스캔 목록에서 제외
        if (depth === 0 && child.name === DB_FILE_NAME) continue;
        // Google Workspace 네이티브 문서(shortcut 등) 제외
        if (String(child.mimeType || '').startsWith('application/vnd.google-apps.')) continue;

        foundFiles.push({
          id: child.id,
          name: child.name,
          mimeType: child.mimeType || guessMimeType({ name: child.name }),
          size: Number(child.size || 0),
          modifiedTime: child.modifiedTime || '',
          webViewLink: child.webViewLink || `https://drive.google.com/file/d/${child.id}/view`,
          folderPath: relPath
        });
      }
    }

    await walk(folders.rootFolderId, [], 0);
    return {
      rootFolderId: folders.rootFolderId,
      folders: foundFolderPaths,
      files: foundFiles
    };
  }

  async function getFileArrayBuffer(accessToken, fileId) {
    if (!fileId) throw createDriveError('유효하지 않은 Drive 파일 ID입니다.', 400, 'INVALID_ID');
    const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await driveFetch(url, accessToken, { method: 'GET' });
    return res.arrayBuffer();
  }

  async function upsertBinaryFile(accessToken, { fileId = '', name, blob, mimeType = '', folderPath = [], userEmail = '' }) {
    const safeName = String(name || '새 스프레드시트.xlsx').trim() || '새 스프레드시트.xlsx';
    const resolvedMime = mimeType || guessMimeType({ name: safeName });
    const parentId = await ensureFolderPath(accessToken, folderPath, userEmail);
    const fields = encodeURIComponent('id,name,mimeType,size,webViewLink,modifiedTime');

    let targetId = String(fileId || '').trim();
    if (!targetId) {
      const existing = await findFileInFolder(accessToken, safeName, parentId);
      if (existing && existing.mimeType !== 'application/vnd.google-apps.folder') {
        targetId = existing.id;
      }
    }

    if (targetId) {
      try {
        const res = await driveFetch(
          `${UPLOAD_API}/files/${encodeURIComponent(targetId)}?uploadType=media&fields=${fields}`,
          accessToken,
          {
            method: 'PATCH',
            headers: { 'Content-Type': resolvedMime },
            body: blob
          }
        );
        const updated = await res.json();
        return {
          id: updated.id,
          name: updated.name || safeName,
          mimeType: updated.mimeType || resolvedMime,
          size: Number(updated.size || blob.size || 0),
          webViewLink: updated.webViewLink || `https://drive.google.com/file/d/${updated.id}/view`,
          uploadedAt: updated.modifiedTime || new Date().toISOString()
        };
      } catch (err) {
        if (err.status !== 404) throw err;
        targetId = '';
      }
    }

    const fileObj = new File([blob], safeName, { type: resolvedMime });
    const data = fileObj.size <= MULTIPART_LIMIT_BYTES
      ? await uploadFileMultipart(accessToken, fileObj, parentId, resolvedMime)
      : await uploadFileResumable(accessToken, fileObj, parentId, resolvedMime);

    return {
      id: data.id,
      name: data.name || safeName,
      mimeType: data.mimeType || resolvedMime,
      size: Number(data.size || fileObj.size || 0),
      webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
      uploadedAt: data.modifiedTime || new Date().toISOString()
    };
  }

  global.BrainDrive = {
    ROOT_FOLDER_NAME,
    FILES_FOLDER_NAME,
    DB_FILE_NAME,
    ensureAppFolders,
    ensureFolderPath,
    clearCache,
    getRootFolderUrl,
    downloadDatabase,
    uploadDatabase,
    uploadFile,
    moveFile,
    upsertTextFile,
    upsertBinaryFile,
    renameFile,
    downloadTextFile,
    scanAppFolder,
    getFileBlobUrl,
    getFileArrayBuffer,
    getFileBase64,
    getPreviewEmbedUrl,
    getWebViewUrl,
    getFileCategory,
    formatFileSize
  };
})(window);
