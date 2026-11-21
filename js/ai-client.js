(function (global) {
  'use strict';

  const PROVIDERS = {
    gemini: {
      id: 'gemini',
      label: 'Gemini',
      displayName: '✨ Gemini (Google)',
      models: [
        { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (최신·추천)' },
        { id: 'gemini-4-neon', label: 'Gemini 4 Neon (고성능)' },
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (빠름)' },
        { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' }
      ]
    },
    openai: {
      id: 'openai',
      label: 'OpenAI',
      displayName: '🟢 OpenAI (GPT)',
      models: [
        { id: 'gpt-4o', label: 'GPT-4o' },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini (빠름)' },
        { id: 'o3-mini', label: 'o3-mini (추론)' }
      ]
    },
    anthropic: {
      id: 'anthropic',
      label: 'Claude',
      displayName: '🟠 Claude (Anthropic)',
      models: [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (빠름)' }
      ]
    },
    grok: {
      id: 'grok',
      label: 'Grok',
      displayName: '⚡ Grok (xAI)',
      models: [
        { id: 'grok-3', label: 'Grok 3' },
        { id: 'grok-3-mini', label: 'Grok 3 Mini (빠름)' },
        { id: 'grok-2-latest', label: 'Grok 2 Latest' }
      ]
    }
  };

  function buildSystemPrompt(contextDocs) {
    let base =
      '당신은 사용자의 개인 지식 관리 시스템(Second Brain OS)에 통합된 AI 어시스턴트입니다. ' +
      '명확하고 구조화된 한국어 마크다운으로 답변하세요.';

    const colorNames = {
      yellow: '노란 형광펜',
      green: '민트 형광펜',
      pink: '핑크 형광펜',
      blue: '블루 형광펜'
    };

    const docsWithMarkers = (contextDocs || []).filter((d) => Array.isArray(d.aiMarkers) && d.aiMarkers.length > 0);
    if (docsWithMarkers.length > 0) {
      base +=
        '\n\n[중요 지침 — AI 형광펜 마커]\n' +
        '사용자가 HTML/문서 뷰어에서 중요하거나 질문하고 싶은 구간에 형광펜 마커를 표시해 두었습니다. ' +
        '사용자가 "거기 마커 쳐놓은 거", "형광펜 표시한 부분", "마커 1번", "표시해 둔 곳 어떻게 생각해?" 등 마커를 언급하면 ' +
        '아래 [⭐ AI 마커 목록]을 최우선으로 참고하여 해당 부분을 중점적으로 분석·피드백하세요.\n';

      docsWithMarkers.forEach((doc) => {
        base += `\n=== [⭐ AI 마커 — 문서: ${doc.name}] ===\n`;
        doc.aiMarkers.forEach((m, idx) => {
          const num = m.number || (idx + 1);
          const colorLabel = colorNames[m.color] || m.color || '형광펜';
          base += `• [마커 #${num} / ${colorLabel}]\n`;
          base += `  - 표시한 원문: "${m.text}"\n`;
          if (m.note) base += `  - 사용자 메모: ${m.note}\n`;
          if (m.context && m.context !== m.text) base += `  - 주변 문맥: ${m.context}\n`;
        });
      });
    }

    if (contextDocs && contextDocs.length > 0) {
      base += '\n\n아래는 사용자가 현재 세컨드 브레인에서 첨부한 문서/메모 전체 컨텍스트입니다:\n';
      contextDocs.forEach((doc, idx) => {
        const rawSummary = String(doc.summary || '');
        // HTML 문서가 매우 길면 토큰 절약을 위해 적당히 잘라서 전달 (마커 원문은 위에서 이미 전문 제공됨)
        const trimmedSummary = rawSummary.length > 16000
          ? rawSummary.slice(0, 16000) + '\n... (이하 생략됨)'
          : rawSummary;
        base +=
          `\n--- [메모 ${idx + 1}] ---\n` +
          `제목: ${doc.name}\n` +
          (doc.tag ? `태그: ${doc.tag}\n` : '') +
          (doc.link ? `링크: ${doc.link}\n` : '') +
          `내용:\n${trimmedSummary || '(내용 없음)'}\n`;
      });
    }
    return base;
  }

  // 연속된 같은 role 메시지를 병합해 Anthropic / Gemini 규격에 맞게 정규화
  function normalizeConversation(messages) {
    const cleaned = [];
    for (const m of messages) {
      if (!m || !m.content) continue;
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const last = cleaned[cleaned.length - 1];
      if (last && last.role === m.role) {
        last.content += '\n\n' + m.content;
      } else {
        cleaned.push({ role: m.role, content: m.content });
      }
    }
    // 첫 메시지가 assistant라면 제거 (Anthropic/Gemini 요구사항)
    while (cleaned.length > 0 && cleaned[0].role !== 'user') {
      cleaned.shift();
    }
    return cleaned;
  }

  async function callOpenAICompatible(endpoint, apiKey, model, systemPrompt, messages) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content }))
        ]
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `HTTP ${res.status} 오류가 발생했습니다.`);
    }
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('응답 본문이 비어 있습니다.');
    return text;
  }

  async function callGemini(apiKey, model, systemPrompt, messages) {
    const rawModel = String(model || '').trim();
    const cleanModel = rawModel.replace(/^models\//i, '') || PROVIDERS.gemini.models[0].id;
    if (!/^[a-zA-Z0-9._-]+$/.test(cleanModel)) {
      throw new Error(
        `잘못된 Gemini 모델명입니다: "${rawModel}". ⚙️ API 설정의 [커스텀 모델명] 칸을 비우거나 영문 모델 ID(예: gemini-4-hydrogen)를 입력해 주세요.`
      );
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`[모델: ${cleanModel}] ${data?.error?.message || `Gemini HTTP ${res.status} 오류`}`);
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('');
    if (!text) throw new Error('Gemini 응답이 비어 있습니다. (안전 필터 또는 모델명 확인 필요)');
    return text;
  }

  async function callAnthropic(apiKey, model, systemPrompt, messages) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `Anthropic HTTP ${res.status} 오류`);
    }
    const text = (data?.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text) throw new Error('Claude 응답이 비어 있습니다.');
    return text;
  }

  async function sendChat({ provider, model, apiKey, messages, contextDocs }) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error(`${PROVIDERS[provider]?.label || provider} API 키가 설정되지 않았습니다. 우측 상단 [⚙️ API 설정]에서 키를 입력해 주세요.`);
    }

    const normalized = normalizeConversation(messages);
    if (normalized.length === 0) {
      throw new Error('전송할 메시지가 없습니다.');
    }

    const systemPrompt = buildSystemPrompt(contextDocs);
    const trimmedKey = apiKey.trim();

    switch (provider) {
      case 'gemini':
        return callGemini(trimmedKey, model, systemPrompt, normalized);
      case 'openai':
        return callOpenAICompatible('https://api.openai.com/v1/chat/completions', trimmedKey, model, systemPrompt, normalized);
      case 'anthropic':
        return callAnthropic(trimmedKey, model, systemPrompt, normalized);
      case 'grok':
        return callOpenAICompatible('https://api.x.ai/v1/chat/completions', trimmedKey, model, systemPrompt, normalized);
      default:
        throw new Error(`지원하지 않는 AI 제공자입니다: ${provider}`);
    }
  }

  global.BrainAI = {
    PROVIDERS,
    sendChat
  };
})(window);
