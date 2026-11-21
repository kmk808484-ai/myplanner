(function (global) {
  'use strict';

  const DEFAULT_URL = 'http://127.0.0.1:4820';

  function getCleanBaseUrl(baseUrl) {
    return String(baseUrl || DEFAULT_URL).trim().replace(/\/+$/, '') || DEFAULT_URL;
  }

  function isWebUrl(value) {
    if (!value) return false;
    return /^https?:\/\//i.test(String(value).trim());
  }

  function isLocalPath(value) {
    if (!value) return false;
    const trimmed = String(value).trim();
    if (!trimmed) return false;
    return !isWebUrl(trimmed);
  }

  function isLocalProtectedItem(item) {
    if (!item) return false;
    return Boolean(item.isLocalPrivate) || isLocalPath(item.link);
  }

  function guessIconForPath(filePath) {
    const lower = String(filePath || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (!lower) return '📄';
    if (/\.(xlsx|xls|csv)$/.test(lower)) return '📊';
    if (/\.pdf$/.test(lower)) return '📕';
    if (/\.(docx?|hwp|hwpx)$/.test(lower)) return '📘';
    if (/\.(pptx?|key)$/.test(lower)) return '📙';
    if (/\.(exe|bat|cmd|lnk|msi)$/.test(lower)) return '🚀';
    if (/\.(html?|js|ts|py|ps1|json|css|c|cpp|java)$/.test(lower)) return '💻';
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(lower)) return '🖼️';
    if (/\.(mp4|mov|mkv|avi|mp3|wav)$/.test(lower)) return '🎬';
    if (/\.(zip|7z|rar|tar|gz)$/.test(lower)) return '🗜️';
    if (/\.(md|txt)$/.test(lower)) return '📝';
    if (!/\.[a-z0-9]{1,6}$/.test(lower)) return '📂';
    return '📄';
  }

  async function checkHealth(baseUrl) {
    const url = `${getCleanBaseUrl(baseUrl)}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!res.ok) return { ok: false };
      const data = await res.json().catch(() => ({}));
      return data && data.ok ? data : { ok: false };
    } catch (_) {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  function buildAuthHeaders(idToken) {
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    return headers;
  }

  async function openLocal(targetPath, mode = 'open', baseUrl, idToken) {
    if (!idToken) {
      throw new Error('내 구글 계정으로 로그인해야 로컬 프로그램을 실행할 수 있습니다.');
    }
    const url = `${getCleanBaseUrl(baseUrl)}/open`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: buildAuthHeaders(idToken),
        body: JSON.stringify({ path: targetPath, mode })
      });
    } catch (_) {
      throw new Error(
        '로컬 연결 도우미가 실행 중이 아닙니다. local-bridge 폴더의 [로컬연결_실행.bat]을 먼저 실행해 주세요.'
      );
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `로컬 실행 실패 (HTTP ${res.status})`);
    }
    return data;
  }

  async function openContentLocal(fileName, content, baseUrl, idToken) {
    if (!idToken) {
      throw new Error('내 구글 계정으로 로그인해야 PC 연결 프로그램으로 열 수 있습니다.');
    }
    const url = `${getCleanBaseUrl(baseUrl)}/open-content`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: buildAuthHeaders(idToken),
        body: JSON.stringify({ fileName, content })
      });
    } catch (_) {
      throw new Error(
        '로컬 연결 도우미가 실행 중이 아닙니다. local-bridge 폴더의 [로컬연결_실행.bat]을 먼저 실행해 주세요.'
      );
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `로컬 앱 열기 실패 (HTTP ${res.status})`);
    }
    return data;
  }

  async function pickLocalFile(baseUrl, idToken) {
    if (!idToken) {
      throw new Error('내 구글 계정으로 로그인해야 로컬 파일을 선택할 수 있습니다.');
    }
    const url = `${getCleanBaseUrl(baseUrl)}/pick-file`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: buildAuthHeaders(idToken)
      });
    } catch (_) {
      throw new Error(
        '로컬 연결 도우미가 실행 중이 아닙니다. local-bridge 폴더의 [로컬연결_실행.bat]을 먼저 실행해 주세요.'
      );
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `파일 선택 실패 (HTTP ${res.status})`);
    }
    return data;
  }

  global.BrainLocalBridge = {
    DEFAULT_URL,
    isWebUrl,
    isLocalPath,
    isLocalProtectedItem,
    guessIconForPath,
    checkHealth,
    openLocal,
    openContentLocal,
    pickLocalFile
  };
})(window);
