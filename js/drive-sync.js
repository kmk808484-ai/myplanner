(function (global) {
  'use strict';

  const ROOT_FOLDER_NAME = 'SecondBrainOS';
  const FILES_FOLDER_NAME = 'files';
  const DB_FILE_NAME = 'second-brain-db.json';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const MULTIPART_LIMIT_BYTES = 4.5 * 1024 * 1024; // 4.5MB (Google multipart limit is 5MB)

  let cachedFolders = null; // { email, rootFolderId, filesFolderId }
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

  async function ensureAppFolders(accessToken, userEmail = '') {
    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    if (
      cachedFolders &&
      cachedFolders.email === normalizedEmail &&
      cachedFolders.rootFolderId &&
      cachedFolders.filesFolderId
    ) {
      return cachedFolders;
    }

    let rootFolder = await findFileInFolder(
      accessToken,
      ROOT_FOLDER_NAME,
      'root',
      'application/vnd.google-apps.folder'
    );
    if (!rootFolder) {
      rootFolder = await createFolder(accessToken, ROOT_FOLDER_NAME, 'root');
    }

    let filesFolder = await findFileInFolder(
      accessToken,
      FILES_FOLDER_NAME,
      rootFolder.id,
      'application/vnd.google-apps.folder'
    );
    if (!filesFolder) {
      filesFolder = await createFolder(accessToken, FILES_FOLDER_NAME, rootFolder.id);
    }

    cachedFolders = {
      email: normalizedEmail,
      rootFolderId: rootFolder.id,
      filesFolderId: filesFolder.id
    };
    return cachedFolders;
  }

  function clearCache() {
    cachedFolders = null;
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

  async function uploadFile(accessToken, file, userEmail = '') {
    const folders = await ensureAppFolders(accessToken, userEmail);
    const mimeType = guessMimeType(file);
    let data;

    if (file.size <= MULTIPART_LIMIT_BYTES) {
      data = await uploadFileMultipart(accessToken, file, folders.filesFolderId, mimeType);
    } else {
      data = await uploadFileResumable(accessToken, file, folders.filesFolderId, mimeType);
    }

    return {
      id: data.id,
      name: data.name || file.name,
      mimeType: data.mimeType || mimeType,
      size: Number(data.size || file.size || 0),
      webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
      uploadedAt: data.modifiedTime || new Date().toISOString()
    };
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

  global.BrainDrive = {
    ROOT_FOLDER_NAME,
    FILES_FOLDER_NAME,
    DB_FILE_NAME,
    ensureAppFolders,
    clearCache,
    getRootFolderUrl,
    downloadDatabase,
    uploadDatabase,
    uploadFile,
    getFileBlobUrl,
    getPreviewEmbedUrl,
    getWebViewUrl,
    getFileCategory,
    formatFileSize
  };
})(window);
