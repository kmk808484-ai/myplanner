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

    if (contextDocs && contextDocs.length > 0) {
      base += '\n\n아래는 사용자가 현재 세컨드 브레인에서 첨부한 메모 컨텍스트입니다. 답변 시 이 내용을 우선 참고하세요:\n';
      contextDocs.forEach((doc, idx) => {
        base +=
          `\n--- [메모 ${idx + 1}] ---\n` +
          `제목: ${doc.name}\n` +
          (doc.tag ? `태그: ${doc.tag}\n` : '') +
          (doc.link ? `링크: ${doc.link}\n` : '') +
          `내용:\n${doc.summary || '(내용 없음)'}\n`;
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
