(function (global) {
  'use strict';

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const GCAL_COLORS = [
    '#1a73e8', // Google Blue (Peacock/Blueberry)
    '#0b8043', // Basil Green
    '#8e24aa', // Grape Purple
    '#e67c73', // Flamingo
    '#f4511e', // Tangerine
    '#039be5', // Peacock
    '#3f51b5', // Blueberry
    '#d50000'  // Tomato Red
  ];

  const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

  function ymdFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function parseYmd(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function addDays(dateObj, delta) {
    const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    d.setDate(d.getDate() + delta);
    return d;
  }

  function parseHHMMToMinutes(str) {
    const m = String(str || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Math.max(0, Math.min(23, Number(m[1])));
    const min = Math.max(0, Math.min(59, Number(m[2])));
    return h * 60 + min;
  }

  function formatHourLabel(hour) {
    if (hour === 0) return '';
    if (hour < 12) return `오전 ${hour}시`;
    if (hour === 12) return '오후 12시';
    return `오후 ${hour - 12}시`;
  }

  function createGoogleCalendar(hooks) {
    const Store = global.BrainStore;
    let viewMode = 'week'; // 'day' | 'week' | 'month'
    let cursorDate = new Date();
    let miniMonthDate = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
    const hiddenLayers = new Set(); // layer keys hidden by user checkboxes
    let quickAddState = null; // { date, endDate, startTime, endTime }
    let dragDocId = null;

    function diffDaysYmd(aYmd, bYmd) {
      const a = parseYmd(aYmd);
      const b = parseYmd(bYmd);
      return Math.round((b.getTime() - a.getTime()) / 86400000);
    }

    function minutesToHHMM(mins) {
      const clamped = Math.max(0, Math.min(23 * 60 + 55, Math.round(mins)));
      return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
    }

    function renderInboxDraggablePanelHtml() {
      const docs = typeof hooks.getAllVisibleDocs === 'function' ? hooks.getAllVisibleDocs() : [];
      const openTasks = docs
        .filter((d) => !d.completed && (Store.getCardRole(d) === 'T' || Store.getCardRole(d) === 'M' || !d.startDate))
        .sort((a, b) => (a.startDate ? 1 : 0) - (b.startDate ? 1 : 0))
        .slice(0, 14);
      return `
        <div class="gcal-inbox-drag">
          <div class="gcal-layers-title">📥 수신함 할일 <small style="font-weight:500; opacity:0.75;">(드래그 배치)</small></div>
          <div class="gcal-inbox-drag-list">
            ${openTasks.length === 0
              ? `<div class="sb-muted-sm" style="padding:4px;">배치할 미완료 할일이 없습니다.</div>`
              : openTasks.map((d) => `
                <div class="gcal-inbox-chip" draggable="true" data-gcal-drag-doc="${esc(d.id)}" title="캘린더의 날짜나 시간 칸으로 드래그해 일정을 바로 배치하세요">
                  <span class="gcal-inbox-chip-grip">⋮⋮</span>
                  <span class="gcal-inbox-chip-name">${esc(String(d.name || '').replace(/\.md$/i, ''))}</span>
                  ${d.startDate ? `<span class="gcal-inbox-chip-date">${esc(d.startDate.slice(5).replace('-', '/'))}</span>` : `<span class="gcal-inbox-chip-date is-unsched">미배정</span>`}
                </div>
              `).join('')}
          </div>
        </div>
      `;
    }

    function getProjectColor(projId, idxFallback = 0) {
      if (!projId) return '#1a73e8';
      const projs = Store.getParaEntities('project', { onlyActive: true });
      const idx = projs.findIndex((p) => p.id === projId);
      const ent = idx >= 0 ? projs[idx] : null;
      if (ent?.lifeGoalId) {
        const lg = Store.getLifeGoalById?.(ent.lifeGoalId);
        if (lg?.color) return lg.color;
      }
      return GCAL_COLORS[(idx >= 0 ? idx : idxFallback) % GCAL_COLORS.length];
    }

    // Collect unified events from Second Brain docs + life schedules
    function collectEventsForRange(rangeStartYmd, rangeEndYmd) {
      const todayYmd = hooks.getTodayYMD();
      const events = [];
      const docs = typeof hooks.getAllVisibleDocs === 'function' ? hooks.getAllVisibleDocs() : [];

      docs.forEach((doc) => {
        const s = doc.startDate || doc.endDate || '';
        const e = doc.endDate || doc.startDate || '';
        if (!s || !e) return;
        const startYmd = s <= e ? s : e;
        const endYmd = s <= e ? e : s;
        if (endYmd < rangeStartYmd || startYmd > rangeEndYmd) return;

        const role = Store.getCardRole(doc);
        const rels = Store.getRelationsForNode(doc.id);
        const primaryProj = (rels.projects || [])[0]?.node || null;
        const isOverdue = !doc.completed && endYmd < todayYmd;

        const layerKey = isOverdue
          ? 'layer:overdue'
          : (role === 'M'
            ? 'layer:milestone'
            : (primaryProj ? `proj:${primaryProj.id}` : 'layer:unassigned'));

        if (hiddenLayers.has(layerKey)) return;

        let color = '#1a73e8';
        if (doc.completed) color = '#64748b';
        else if (isOverdue) color = '#d93025'; // Google Calendar Tomato Red
        else if (role === 'M') color = '#e37400'; // Milestone Amber
        else if (primaryProj) color = getProjectColor(primaryProj.id);

        const startMin = parseHHMMToMinutes(doc.startTime || doc.coreTime || '');
        const endMinRaw = parseHHMMToMinutes(doc.endTime || '');
        const isTimed = startMin !== null && startYmd === endYmd;
        const endMin = isTimed
          ? (endMinRaw !== null && endMinRaw > startMin ? endMinRaw : Math.min(24 * 60, startMin + 60))
          : null;

        events.push({
          id: `doc:${doc.id}`,
          kind: 'doc',
          doc,
          title: (role === 'M' ? '◆ ' : (doc.completed ? '✓ ' : '')) + String(doc.name || '').replace(/\.md$/i, ''),
          startYmd,
          endYmd,
          isAllDay: !isTimed,
          startMin,
          endMin,
          color,
          isOverdue,
          completed: Boolean(doc.completed),
          projLabel: primaryProj ? `${Store.getParaCode(primaryProj)} ${primaryProj.name}` : ''
        });
      });

      // Also include life schedules (dfp.schedules)
      if (!hiddenLayers.has('layer:life')) {
        const dfp = hooks.loadDfpState?.() || {};
        const schedules = Array.isArray(dfp.schedules) ? dfp.schedules : [];
        const startObj = parseYmd(rangeStartYmd);
        const endObj = parseYmd(rangeEndYmd);
        for (let d = new Date(startObj); d <= endObj; d = addDays(d, 1)) {
          const dYmd = ymdFromDate(d);
          const wd = d.getDay();
          schedules.forEach((sc) => {
            const match = sc.type === 'recurring'
              ? Array.isArray(sc.weekdays) && sc.weekdays.includes(wd)
              : sc.date === dYmd;
            if (!match) return;
            const tMin = parseHHMMToMinutes(sc.time || '09:00');
            if (tMin === null) return;
            events.push({
              id: `sched:${sc.id}:${dYmd}`,
              kind: 'schedule',
              sched: sc,
              title: `🚦 ${sc.title || '일정'}`,
              startYmd: dYmd,
              endYmd: dYmd,
              isAllDay: false,
              startMin: tMin,
              endMin: Math.min(24 * 60, tMin + 60),
              color: '#0b8043',
              isOverdue: false,
              completed: false,
              projLabel: '생활 일정'
            });
          });
        }
      }

      return events;
    }

    function renderMiniCalendarHtml(todayYmd) {
      const y = miniMonthDate.getFullYear();
      const m = miniMonthDate.getMonth();
      const firstDay = new Date(y, m, 1);
      const startDow = firstDay.getDay();
      const gridStart = addDays(firstDay, -startDow);
      const cursorYmd = ymdFromDate(cursorDate);

      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = addDays(gridStart, i);
        const ymd = ymdFromDate(d);
        const isOther = d.getMonth() !== m;
        const isToday = ymd === todayYmd;
        const isSel = ymd === cursorYmd;
        cells.push(`
          <button type="button" class="gcal-mini-cell${isOther ? ' is-other' : ''}${isToday ? ' is-today' : ''}${isSel && !isToday ? ' is-selected' : ''}" data-gcal-jump="${ymd}">
            ${d.getDate()}
          </button>
        `);
      }

      return `
        <div class="gcal-mini">
          <div class="gcal-mini-head">
            <span class="gcal-mini-title">${y}년 ${m + 1}월</span>
            <div class="gcal-mini-nav">
              <button type="button" class="gcal-icon-btn-sm" data-gcal-mini="-1" title="이전 달">‹</button>
              <button type="button" class="gcal-icon-btn-sm" data-gcal-mini="1" title="다음 달">›</button>
            </div>
          </div>
          <div class="gcal-mini-dows">${DAY_KO.map((w) => `<span>${w}</span>`).join('')}</div>
          <div class="gcal-mini-grid">${cells.join('')}</div>
        </div>
      `;
    }

    function renderLayersHtml() {
      const projects = Store.getParaEntities('project', { onlyActive: true });
      const items = [
        { key: 'layer:unassigned', label: '수신함 · 일반 할일', color: '#1a73e8' },
        { key: 'layer:overdue', label: '⚠️ 기간지남 미완료', color: '#d93025' },
        { key: 'layer:milestone', label: '◆ 마일스톤', color: '#e37400' },
        { key: 'layer:life', label: '🚦 생활 일정 (신호등)', color: '#0b8043' },
        ...projects.map((p, idx) => ({
          key: `proj:${p.id}`,
          label: `${Store.getParaCode(p)} ${p.name}`,
          color: getProjectColor(p.id, idx)
        }))
      ];

      return `
        <div class="gcal-layers">
          <div class="gcal-layers-title">내 캘린더</div>
          ${items.map((it) => {
            const checked = !hiddenLayers.has(it.key);
            return `
              <label class="gcal-layer-row">
                <input type="checkbox" class="gcal-layer-chk" data-gcal-layer="${esc(it.key)}" ${checked ? 'checked' : ''} style="accent-color:${esc(it.color)};">
                <span class="gcal-layer-name">${esc(it.label)}</span>
              </label>
            `;
          }).join('')}
        </div>
      `;
    }

    // ---- Month View (Google Calendar 7-Col Block Grid with Multi-Day Spanning Pills) ----
    function renderMonthViewHtml(todayYmd) {
      const y = cursorDate.getFullYear();
      const m = cursorDate.getMonth();
      const firstOfMonth = new Date(y, m, 1);
      const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
      const gridEnd = addDays(gridStart, 41);
      const events = collectEventsForRange(ymdFromDate(gridStart), ymdFromDate(gridEnd));

      const weeksHtml = [];
      for (let w = 0; w < 6; w++) {
        const weekDays = [];
        for (let d = 0; d < 7; d++) weekDays.push(addDays(gridStart, w * 7 + d));
        const wStartYmd = ymdFromDate(weekDays[0]);
        const wEndYmd = ymdFromDate(weekDays[6]);

        // Filter events touching this week & pack into rows (Google Calendar style multi-day bars!)
        const weekEvs = events
          .filter((ev) => ev.endYmd >= wStartYmd && ev.startYmd <= wEndYmd)
          .map((ev) => {
            const cStart = ev.startYmd < wStartYmd ? wStartYmd : ev.startYmd;
            const cEnd = ev.endYmd > wEndYmd ? wEndYmd : ev.endYmd;
            const colStart = weekDays.findIndex((dd) => ymdFromDate(dd) === cStart);
            const colEnd = weekDays.findIndex((dd) => ymdFromDate(dd) === cEnd);
            return { ...ev, colStart: Math.max(0, colStart), colEnd: Math.max(0, colEnd), span: Math.max(1, colEnd - colStart + 1) };
          })
          .sort((a, b) => (b.span - a.span) || (a.colStart - b.colStart) || ((a.startMin ?? -1) - (b.startMin ?? -1)));

        const tracks = []; // Array of boolean[7]
        const placed = [];
        weekEvs.forEach((ev) => {
          let trackIdx = -1;
          for (let t = 0; t < tracks.length; t++) {
            let free = true;
            for (let c = ev.colStart; c <= ev.colEnd; c++) {
              if (tracks[t][c]) { free = false; break; }
            }
            if (free) { trackIdx = t; break; }
          }
          if (trackIdx === -1) {
            trackIdx = tracks.length;
            tracks.push(Array(7).fill(false));
          }
          for (let c = ev.colStart; c <= ev.colEnd; c++) tracks[trackIdx][c] = true;
          placed.push({ ...ev, trackIdx });
        });

        const maxVisibleTracks = 4;
        const barsHtml = placed
          .filter((ev) => ev.trackIdx < maxVisibleTracks)
          .map((ev) => {
            const leftPct = (ev.colStart / 7) * 100;
            const widthPct = (ev.span / 7) * 100;
            const topPx = 28 + ev.trackIdx * 23;
            const timePrefix = !ev.isAllDay && ev.startMin !== null
              ? `${String(Math.floor(ev.startMin / 60)).padStart(2, '0')}:${String(ev.startMin % 60).padStart(2, '0')} `
              : '';
            return `
              <button type="button" class="gcal-m-bar${ev.completed ? ' is-done' : ''}${ev.isAllDay ? ' is-solid' : ' is-timed'}"
                ${ev.kind === 'doc' ? `draggable="true" data-gcal-drag-doc="${esc(ev.doc.id)}"` : ''}
                data-gcal-ev="${esc(ev.id)}"
                style="left:calc(${leftPct}% + 2px); width:calc(${widthPct}% - 5px); top:${topPx}px; --ev-color:${esc(ev.color)};"
                title="${esc(ev.title)}${ev.projLabel ? ` (${ev.projLabel})` : ''} — 드래그하여 날짜 이동">
                ${!ev.isAllDay ? `<span class="gcal-dot" style="background:${esc(ev.color)};"></span>` : ''}
                <span class="gcal-bar-txt">${esc(timePrefix + ev.title)}</span>
              </button>
            `;
          }).join('');

        const overflowByCol = Array(7).fill(0);
        placed.filter((ev) => ev.trackIdx >= maxVisibleTracks).forEach((ev) => {
          for (let c = ev.colStart; c <= ev.colEnd; c++) overflowByCol[c]++;
        });

        weeksHtml.push(`
          <div class="gcal-m-week">
            <div class="gcal-m-cells">
              ${weekDays.map((d, ci) => {
                const ymd = ymdFromDate(d);
                const isToday = ymd === todayYmd;
                const isOther = d.getMonth() !== m;
                const dayLabel = d.getDate() === 1 ? `${d.getMonth() + 1}월 1일` : `${d.getDate()}`;
                return `
                  <div class="gcal-m-cell${isOther ? ' is-other' : ''}" data-gcal-slot-date="${ymd}">
                    <div class="gcal-m-dayhead">
                      <span class="gcal-m-daynum${isToday ? ' is-today' : ''}">${dayLabel}</span>
                    </div>
                    ${overflowByCol[ci] > 0 ? `<div class="gcal-m-more">+${overflowByCol[ci]}개 더보기</div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
            <div class="gcal-m-bars-layer">${barsHtml}</div>
          </div>
        `);
      }

      return `
        <div class="gcal-month-wrap">
          <div class="gcal-m-dow-row">${DAY_KO.map((w, idx) => `<div class="gcal-m-dow${idx === 0 ? ' is-sun' : (idx === 6 ? ' is-sat' : '')}">${w}</div>`).join('')}</div>
          <div class="gcal-m-body">${weeksHtml.join('')}</div>
        </div>
      `;
    }

    // ---- Week & Day Views (Google Calendar Hourly Time Grid + All-Day Spanning Strip + Red Now Line) ----
    function renderTimeGridHtml(days, todayYmd) {
      const colCount = days.length;
      const startYmd = ymdFromDate(days[0]);
      const endYmd = ymdFromDate(days[colCount - 1]);
      const events = collectEventsForRange(startYmd, endYmd);

      const allDayEvs = events
        .filter((ev) => ev.isAllDay)
        .map((ev) => {
          const cStart = ev.startYmd < startYmd ? startYmd : ev.startYmd;
          const cEnd = ev.endYmd > endYmd ? endYmd : ev.endYmd;
          const colStart = days.findIndex((dd) => ymdFromDate(dd) === cStart);
          const colEnd = days.findIndex((dd) => ymdFromDate(dd) === cEnd);
          return { ...ev, colStart: Math.max(0, colStart), colEnd: Math.max(0, colEnd), span: Math.max(1, colEnd - colStart + 1) };
        })
        .sort((a, b) => (b.span - a.span) || (a.colStart - b.colStart));

      // Pack all-day multi-day bars into tracks
      const adTracks = [];
      const adPlaced = [];
      allDayEvs.forEach((ev) => {
        let tIdx = -1;
        for (let t = 0; t < adTracks.length; t++) {
          let ok = true;
          for (let c = ev.colStart; c <= ev.colEnd; c++) if (adTracks[t][c]) { ok = false; break; }
          if (ok) { tIdx = t; break; }
        }
        if (tIdx === -1) { tIdx = adTracks.length; adTracks.push(Array(colCount).fill(false)); }
        for (let c = ev.colStart; c <= ev.colEnd; c++) adTracks[tIdx][c] = true;
        adPlaced.push({ ...ev, tIdx });
      });

      const adHeight = Math.max(30, adTracks.length * 24 + 8);
      const adBarsHtml = adPlaced.map((ev) => {
        const leftPct = (ev.colStart / colCount) * 100;
        const widthPct = (ev.span / colCount) * 100;
        const topPx = 4 + ev.tIdx * 24;
        return `
          <button type="button" class="gcal-ad-bar${ev.completed ? ' is-done' : ''}"
            ${ev.kind === 'doc' ? `draggable="true" data-gcal-drag-doc="${esc(ev.doc.id)}"` : ''}
            data-gcal-ev="${esc(ev.id)}"
            style="left:calc(${leftPct}% + 2px); width:calc(${widthPct}% - 5px); top:${topPx}px; background:${esc(ev.color)};"
            title="${esc(ev.title)}${ev.projLabel ? ` (${ev.projLabel})` : ''} — 드래그하여 일정 이동">
            ${esc(ev.title)}
          </button>
        `;
      }).join('');

      const hourHeight = 48; // 48px per hour
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const nowTopPx = (nowMinutes / 60) * hourHeight;

      const hoursGutterHtml = Array.from({ length: 24 }, (_, h) => `
        <div class="gcal-t-gutter-slot" style="height:${hourHeight}px;">
          <span>${formatHourLabel(h)}</span>
        </div>
      `).join('');

      const dayColsHtml = days.map((d) => {
        const dYmd = ymdFromDate(d);
        const isToday = dYmd === todayYmd;
        const dayTimed = events
          .filter((ev) => !ev.isAllDay && ev.startYmd === dYmd)
          .sort((a, b) => (a.startMin - b.startMin) || ((b.endMin - b.startMin) - (a.endMin - a.startMin)));

        // Simple overlap column packing
        const lanes = [];
        const laidOut = dayTimed.map((ev) => {
          let lane = lanes.findIndex((endM) => endM <= ev.startMin);
          if (lane === -1) { lane = lanes.length; lanes.push(ev.endMin); }
          else lanes[lane] = ev.endMin;
          return { ...ev, lane };
        });
        const totalLanes = Math.max(1, lanes.length);

        const blocksHtml = laidOut.map((ev) => {
          const top = (ev.startMin / 60) * hourHeight;
          const height = Math.max(22, ((ev.endMin - ev.startMin) / 60) * hourHeight - 2);
          const wPct = 100 / totalLanes;
          const lPct = ev.lane * wPct;
          const sH = `${String(Math.floor(ev.startMin / 60)).padStart(2, '0')}:${String(ev.startMin % 60).padStart(2, '0')}`;
          const eH = `${String(Math.floor(ev.endMin / 60)).padStart(2, '0')}:${String(ev.endMin % 60).padStart(2, '0')}`;
          return `
            <div class="gcal-t-block${ev.completed ? ' is-done' : ''}"
              ${ev.kind === 'doc' ? `draggable="true" data-gcal-drag-doc="${esc(ev.doc.id)}"` : ''}
              data-gcal-ev="${esc(ev.id)}"
              data-start-min="${ev.startMin}"
              data-end-min="${ev.endMin}"
              style="top:${top}px; height:${height}px; left:calc(${lPct}% + 2px); width:calc(${wPct}% - 5px); background:${esc(ev.color)};"
              title="${esc(ev.title)} (${sH}~${eH}) — 드래그하여 이동 · 하단 경계 드래그로 시간 늘리기">
              <div class="gcal-t-block-title">${esc(ev.title)}</div>
              <div class="gcal-t-block-time">${sH} – ${eH}</div>
              ${ev.kind === 'doc' ? `<div class="gcal-t-resize-handle" data-gcal-resize-doc="${esc(ev.doc.id)}" title="아래·위로 드래그해 시간 블록 늘리기/줄이기"></div>` : ''}
            </div>
          `;
        }).join('');

        const slotsHtml = Array.from({ length: 24 }, (_, h) => {
          const hh = `${String(h).padStart(2, '0')}:00`;
          return `<div class="gcal-t-hour-cell" style="height:${hourHeight}px;" data-gcal-slot-date="${dYmd}" data-gcal-slot-time="${hh}"></div>`;
        }).join('');

        return `
          <div class="gcal-t-col${isToday ? ' is-today' : ''}">
            ${slotsHtml}
            <div class="gcal-t-events-layer">${blocksHtml}</div>
            ${isToday ? `<div class="gcal-now-line" style="top:${nowTopPx}px;"><span class="gcal-now-dot"></span></div>` : ''}
          </div>
        `;
      }).join('');

      return `
        <div class="gcal-timegrid-wrap">
          <div class="gcal-tg-header" id="gcal-tg-header">
            <div class="gcal-tg-tz">GMT+09</div>
            <div class="gcal-tg-days-head" style="grid-template-columns:repeat(${colCount}, minmax(0, 1fr));">
              ${days.map((d) => {
                const ymd = ymdFromDate(d);
                const isToday = ymd === todayYmd;
                return `
                  <div class="gcal-tg-dayhead${isToday ? ' is-today' : ''}">
                    <span class="gcal-tg-dow">${DAY_KO[d.getDay()]}</span>
                    <button type="button" class="gcal-tg-datecircle${isToday ? ' is-today' : ''}" data-gcal-day-focus="${ymd}">${d.getDate()}</button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <div class="gcal-tg-allday-row" id="gcal-tg-allday-row">
            <div class="gcal-tg-ad-lbl">종일</div>
            <div class="gcal-tg-ad-grid" style="min-height:${adHeight}px; grid-template-columns:repeat(${colCount}, minmax(0, 1fr));">
              ${days.map((d) => `<div class="gcal-tg-ad-cell" data-gcal-slot-date="${ymdFromDate(d)}" data-gcal-allday="1"></div>`).join('')}
              <div class="gcal-tg-ad-bars">${adBarsHtml}</div>
            </div>
          </div>

          <div class="gcal-tg-scroll" id="gcal-tg-scroll">
            <div class="gcal-tg-body">
              <div class="gcal-t-gutter">${hoursGutterHtml}</div>
              <div class="gcal-t-cols" style="grid-template-columns:repeat(${colCount}, minmax(0, 1fr));">${dayColsHtml}</div>
            </div>
          </div>
        </div>
      `;
    }

    function renderQuickAddPopoverHtml() {
      if (!quickAddState) return '';
      const projects = Store.getParaEntities('project', { onlyActive: true });
      return `
        <div class="gcal-qadd-backdrop" id="gcal-qadd-backdrop">
          <form class="gcal-qadd-card" id="gcal-qadd-form">
            <div class="gcal-qadd-head">
              <span>📅 새 할일 · 일정 추가</span>
              <button type="button" class="gcal-icon-btn-sm" id="gcal-qadd-close">✕</button>
            </div>
            <input type="text" id="gcal-qa-title" class="gcal-qa-title-inp" placeholder="제목 및 시간 추가" required autofocus>
            <div class="gcal-qa-row">
              <label>시작일 <input type="date" id="gcal-qa-start" value="${esc(quickAddState.date)}"></label>
              <label>종료일 <input type="date" id="gcal-qa-end" value="${esc(quickAddState.endDate || quickAddState.date)}"></label>
            </div>
            <div class="gcal-qa-row">
              <label>시작 시간 <input type="time" id="gcal-qa-stime" value="${esc(quickAddState.startTime || '')}"></label>
              <label>종료 시간 <input type="time" id="gcal-qa-etime" value="${esc(quickAddState.endTime || '')}"></label>
            </div>
            <div class="gcal-qa-row">
              <label>유형
                <select id="gcal-qa-role">
                  <option value="T" selected>T 할일</option>
                  <option value="M">◆ M 마일스톤</option>
                  <option value="S">S 자료</option>
                </select>
              </label>
              <label>소속 프로젝트
                <select id="gcal-qa-proj">
                  <option value="">미지정 (수신함)</option>
                  ${projects.map((p) => `<option value="${esc(p.id)}">${esc(Store.getParaCode(p))} ${esc(p.name)}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="gcal-qa-row" style="gap:14px;">
              <label class="sb-check-inline" style="font-size:0.78rem;">
                <input type="checkbox" id="gcal-qa-core">
                <span>⭐ 오늘의 핵심에 표시</span>
              </label>
              <label class="sb-check-inline" style="font-size:0.78rem;">
                <input type="checkbox" id="gcal-qa-schedule" ${quickAddState.startTime ? 'checked' : ''}>
                <span>📅 일정(스케줄) 태그 (신호등 연동)</span>
              </label>
            </div>
            <div class="gcal-qadd-foot">
              <button type="button" class="sb-btn-subtle" id="gcal-qadd-cancel">취소</button>
              <button type="submit" class="gcal-save-btn">저장</button>
            </div>
          </form>
        </div>
      `;
    }

    function getHeaderDateTitle() {
      const y = cursorDate.getFullYear();
      const m = cursorDate.getMonth() + 1;
      const d = cursorDate.getDate();
      if (viewMode === 'month') return `${y}년 ${m}월`;
      if (viewMode === 'day') return `${y}년 ${m}월 ${d}일 (${DAY_KO[cursorDate.getDay()]})`;
      const weekStart = addDays(cursorDate, -cursorDate.getDay());
      const weekEnd = addDays(weekStart, 6);
      if (weekStart.getMonth() === weekEnd.getMonth()) {
        return `${weekStart.getFullYear()}년 ${weekStart.getMonth() + 1}월 ${weekStart.getDate()}일 – ${weekEnd.getDate()}일`;
      }
      return `${weekStart.getFullYear()}년 ${weekStart.getMonth() + 1}월 ${weekStart.getDate()}일 – ${weekEnd.getMonth() + 1}월 ${weekEnd.getDate()}일`;
    }

    function renderCalendarView(canvas) {
      if (!canvas) return;
      const todayYmd = hooks.getTodayYMD();

      let mainGridHtml = '';
      if (viewMode === 'month') {
        mainGridHtml = renderMonthViewHtml(todayYmd);
      } else if (viewMode === 'day') {
        mainGridHtml = renderTimeGridHtml([cursorDate], todayYmd);
      } else {
        const weekStart = addDays(cursorDate, -cursorDate.getDay());
        const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
        mainGridHtml = renderTimeGridHtml(days, todayYmd);
      }

      canvas.innerHTML = `
        <div class="gcal-shell">
          <header class="gcal-topbar">
            <div class="gcal-topbar-left">
              <span class="gcal-brand-badge">📅</span>
              <span class="gcal-brand-txt">캘린더</span>
              <button type="button" class="gcal-today-btn" id="gcal-btn-today">오늘</button>
              <div class="gcal-nav-arrows">
                <button type="button" class="gcal-icon-btn" id="gcal-btn-prev" title="이전">‹</button>
                <button type="button" class="gcal-icon-btn" id="gcal-btn-next" title="다음">›</button>
              </div>
              <h2 class="gcal-date-title">${esc(getHeaderDateTitle())}</h2>
            </div>
            <div class="gcal-topbar-right">
              <div class="gcal-view-switch">
                <button type="button" class="gcal-vbtn${viewMode === 'day' ? ' active' : ''}" data-gcal-mode="day">일</button>
                <button type="button" class="gcal-vbtn${viewMode === 'week' ? ' active' : ''}" data-gcal-mode="week">주</button>
                <button type="button" class="gcal-vbtn${viewMode === 'month' ? ' active' : ''}" data-gcal-mode="month">월</button>
              </div>
              <button type="button" class="gcal-create-pill" id="gcal-btn-create">＋ 일정 만들기</button>
            </div>
          </header>

          <div class="gcal-body-split">
            <aside class="gcal-sidebar">
              ${renderMiniCalendarHtml(todayYmd)}
              ${renderInboxDraggablePanelHtml()}
              ${renderLayersHtml()}
            </aside>
            <div class="gcal-main-area">
              ${mainGridHtml}
            </div>
          </div>
          ${renderQuickAddPopoverHtml()}
        </div>
      `;

      // Exact 0px Alignment Fix: match Day Header & All-Day Row right padding to Time-Grid vertical scrollbar width!
      const tgScroll = canvas.querySelector('#gcal-tg-scroll');
      if (tgScroll) {
        tgScroll.scrollTop = 8 * 48 - 16;
        requestAnimationFrame(() => {
          const sbW = Math.max(0, tgScroll.offsetWidth - tgScroll.clientWidth);
          const hd = canvas.querySelector('#gcal-tg-header');
          const ad = canvas.querySelector('#gcal-tg-allday-row');
          if (hd) hd.style.paddingRight = `${sbW}px`;
          if (ad) ad.style.paddingRight = `${sbW}px`;
        });
      }

      // Drag-and-Drop: Inbox tasks & existing Calendar blocks -> drop onto any Date / All-day / Hourly slot!
      let suppressNextSlotClick = false;
      const HOUR_PX = 48;

      canvas.querySelectorAll('[data-gcal-drag-doc]').forEach((el) => {
        el.addEventListener('dragstart', (e) => {
          if (e.target.closest('.gcal-t-resize-handle')) {
            e.preventDefault();
            return;
          }
          dragDocId = el.dataset.gcalDragDoc;
          el.classList.add('is-dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', dragDocId); } catch (_) {}
        });
        el.addEventListener('dragend', () => {
          dragDocId = null;
          canvas.querySelectorAll('.is-dragging, .is-drop-over').forEach((n) => n.classList.remove('is-dragging', 'is-drop-over'));
        });
      });

      // Bottom-edge drag resize on existing time blocks (15-min snap)
      canvas.querySelectorAll('[data-gcal-resize-doc]').forEach((handle) => {
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const docId = handle.dataset.gcalResizeDoc;
          const blockEl = handle.closest('.gcal-t-block');
          const doc = Store.findNodeAndParent(docId)?.node;
          if (!blockEl || !doc) return;

          const startMin = Number(blockEl.dataset.startMin || 0);
          const origEndMin = Number(blockEl.dataset.endMin || (startMin + 60));
          const startY = e.clientY;
          let latestEndMin = origEndMin;
          const timeLbl = blockEl.querySelector('.gcal-t-block-time');
          const prevDraggable = blockEl.getAttribute('draggable');
          blockEl.setAttribute('draggable', 'false');
          blockEl.classList.add('is-resizing');

          const onMove = (mv) => {
            const deltaPx = mv.clientY - startY;
            const deltaQuarters = Math.round((deltaPx / HOUR_PX) * 4);
            latestEndMin = Math.max(startMin + 15, Math.min(24 * 60, origEndMin + deltaQuarters * 15));
            const newH = Math.max(20, ((latestEndMin - startMin) / 60) * HOUR_PX - 2);
            blockEl.style.height = `${newH}px`;
            if (timeLbl) {
              const sH = minutesToHHMM(startMin);
              const eH = latestEndMin >= 24 * 60 ? '24:00' : minutesToHHMM(latestEndMin);
              timeLbl.textContent = `${sH} – ${eH}`;
            }
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (prevDraggable !== null) blockEl.setAttribute('draggable', prevDraggable);
            blockEl.classList.remove('is-resizing');
            suppressNextSlotClick = true;
            setTimeout(() => { suppressNextSlotClick = false; }, 120);

            if (latestEndMin !== origEndMin) {
              const endStr = latestEndMin >= 24 * 60 ? '23:59' : minutesToHHMM(latestEndMin);
              doc.startTime = minutesToHHMM(startMin);
              doc.endTime = endStr;
              doc.coreTime = doc.startTime;
              Store.touchNode(doc);
              hooks.syncDocAfterSave?.(doc);
              hooks.saveAndRender();
              hooks.showToast?.(`⏱️ "${String(doc.name || '').replace(/\.md$/i, '')}" 시간 조정: ${doc.startTime} – ${endStr}`);
              renderCalendarView(canvas);
            }
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });

      // Drag on empty time-grid column to stretch & create a new time block!
      canvas.querySelectorAll('.gcal-t-col').forEach((colEl) => {
        colEl.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          if (e.target.closest('.gcal-t-block, .gcal-t-resize-handle')) return;
          const cell = e.target.closest('.gcal-t-hour-cell');
          if (!cell) return;
          const date = cell.dataset.gcalSlotDate;
          if (!date) return;

          const colRect = colEl.getBoundingClientRect();
          const relStartY = Math.max(0, e.clientY - colRect.top);
          const anchorMin = Math.floor((relStartY / HOUR_PX) * 2) * 30; // 30-min grid start
          const startClientY = e.clientY;
          let dragged = false;
          let previewEl = null;
          let curStartM = anchorMin;
          let curEndM = Math.min(24 * 60, anchorMin + 60);

          const onMove = (mv) => {
            if (!dragged && Math.abs(mv.clientY - startClientY) < 12) return;
            dragged = true;
            const relCurY = Math.max(0, Math.min(24 * HOUR_PX, mv.clientY - colRect.top));
            const curMin = Math.round((relCurY / HOUR_PX) * 4) * 15;
            curStartM = Math.max(0, Math.min(anchorMin, curMin));
            curEndM = Math.min(24 * 60, Math.max(anchorMin + 30, curMin));
            if (curEndM - curStartM < 15) curEndM = Math.min(24 * 60, curStartM + 30);

            if (!previewEl) {
              previewEl = document.createElement('div');
              previewEl.className = 'gcal-t-drag-preview';
              colEl.appendChild(previewEl);
            }
            const topPx = (curStartM / 60) * HOUR_PX;
            const hPx = Math.max(22, ((curEndM - curStartM) / 60) * HOUR_PX - 2);
            previewEl.style.top = `${topPx}px`;
            previewEl.style.height = `${hPx}px`;
            const eStr = curEndM >= 24 * 60 ? '23:59' : minutesToHHMM(curEndM);
            previewEl.innerHTML = `<div class="gcal-t-block-title">새 일정</div><div class="gcal-t-block-time">${minutesToHHMM(curStartM)} – ${eStr}</div>`;
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (previewEl) previewEl.remove();
            if (dragged) {
              suppressNextSlotClick = true;
              setTimeout(() => { suppressNextSlotClick = false; }, 120);
              const eStr = curEndM >= 24 * 60 ? '23:59' : minutesToHHMM(curEndM);
              quickAddState = {
                date,
                endDate: date,
                startTime: minutesToHHMM(curStartM),
                endTime: eStr
              };
              renderCalendarView(canvas);
            }
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });

      canvas.querySelectorAll('[data-gcal-slot-date]').forEach((cell) => {
        cell.addEventListener('dragover', (e) => {
          if (!dragDocId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          cell.classList.add('is-drop-over');
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('is-drop-over'));
        cell.addEventListener('drop', (e) => {
          if (!dragDocId) return;
          e.preventDefault();
          cell.classList.remove('is-drop-over');
          const doc = Store.findNodeAndParent(dragDocId)?.node;
          dragDocId = null;
          if (!doc) return;

          const dropDate = cell.dataset.gcalSlotDate;
          const dropTime = cell.dataset.gcalSlotTime || '';
          const isAllDayDrop = cell.dataset.gcalAllday === '1';

          if (dropTime) {
            const oldStartM = parseHHMMToMinutes(doc.startTime || doc.coreTime || '');
            const oldEndM = parseHHMMToMinutes(doc.endTime || '');
            const durMin = (oldStartM !== null && oldEndM !== null && oldEndM > oldStartM) ? (oldEndM - oldStartM) : 60;
            const newStartM = parseHHMMToMinutes(dropTime) ?? 540;
            Store.updateCardSchedule(doc, { startDate: dropDate, endDate: dropDate });
            doc.startTime = minutesToHHMM(newStartM);
            doc.endTime = minutesToHHMM(newStartM + durMin);
            doc.coreTime = doc.startTime;
          } else {
            const spanDays = (doc.startDate && doc.endDate && doc.endDate >= doc.startDate)
              ? diffDaysYmd(doc.startDate, doc.endDate)
              : 0;
            const nextEnd = ymdFromDate(addDays(parseYmd(dropDate), spanDays));
            Store.updateCardSchedule(doc, { startDate: dropDate, endDate: nextEnd });
            if (isAllDayDrop) {
              doc.startTime = '';
              doc.endTime = '';
            }
          }

          Store.touchNode(doc);
          hooks.syncDocAfterSave?.(doc);
          hooks.saveAndRender();
          hooks.showToast?.(`📅 "${String(doc.name || '').replace(/\.md$/i, '')}" → ${dropDate}${dropTime ? ` ${dropTime}` : ''}로 일정 배치됨`);
          renderCalendarView(canvas);
        });
      });

      // Navigation bindings
      canvas.querySelector('#gcal-btn-today')?.addEventListener('click', () => {
        cursorDate = new Date();
        miniMonthDate = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
        renderCalendarView(canvas);
      });

      canvas.querySelector('#gcal-btn-prev')?.addEventListener('click', () => {
        if (viewMode === 'day') cursorDate = addDays(cursorDate, -1);
        else if (viewMode === 'week') cursorDate = addDays(cursorDate, -7);
        else cursorDate = new Date(cursorDate.getFullYear(), cursorDate.getMonth() - 1, 1);
        miniMonthDate = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
        renderCalendarView(canvas);
      });

      canvas.querySelector('#gcal-btn-next')?.addEventListener('click', () => {
        if (viewMode === 'day') cursorDate = addDays(cursorDate, 1);
        else if (viewMode === 'week') cursorDate = addDays(cursorDate, 7);
        else cursorDate = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + 1, 1);
        miniMonthDate = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
        renderCalendarView(canvas);
      });

      canvas.querySelectorAll('[data-gcal-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          viewMode = btn.dataset.gcalMode || 'week';
          renderCalendarView(canvas);
        });
      });

      canvas.querySelector('#gcal-btn-create')?.addEventListener('click', () => {
        quickAddState = { date: ymdFromDate(cursorDate), endDate: ymdFromDate(cursorDate), startTime: '', endTime: '' };
        renderCalendarView(canvas);
      });

      // Mini calendar
      canvas.querySelectorAll('[data-gcal-mini]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const delta = Number(btn.dataset.gcalMini || 0);
          miniMonthDate = new Date(miniMonthDate.getFullYear(), miniMonthDate.getMonth() + delta, 1);
          renderCalendarView(canvas);
        });
      });

      canvas.querySelectorAll('[data-gcal-jump]').forEach((btn) => {
        btn.addEventListener('click', () => {
          cursorDate = parseYmd(btn.dataset.gcalJump);
          miniMonthDate = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
          renderCalendarView(canvas);
        });
      });

      canvas.querySelectorAll('[data-gcal-day-focus]').forEach((btn) => {
        btn.addEventListener('click', () => {
          cursorDate = parseYmd(btn.dataset.gcalDayFocus);
          viewMode = 'day';
          renderCalendarView(canvas);
        });
      });

      // Calendar layer checkboxes
      canvas.querySelectorAll('[data-gcal-layer]').forEach((chk) => {
        chk.addEventListener('change', () => {
          const k = chk.dataset.gcalLayer;
          if (chk.checked) hiddenLayers.delete(k);
          else hiddenLayers.add(k);
          renderCalendarView(canvas);
        });
      });

      // Click event block -> Card Properties Modal (or schedule modal for life schedules)
      canvas.querySelectorAll('[data-gcal-ev]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (suppressNextSlotClick || e.target.closest('.gcal-t-resize-handle')) return;
          e.stopPropagation();
          const evId = btn.dataset.gcalEv || '';
          if (evId.startsWith('doc:')) {
            const docId = evId.slice(4);
            const doc = Store.findNodeAndParent(docId)?.node;
            if (doc && typeof hooks.openCardProps === 'function') {
              hooks.openCardProps(doc);
            }
          } else if (evId.startsWith('sched:')) {
            hooks.openScheduleModal?.();
          }
        });
      });

      // Click empty date/time slot -> Quick Add Event prefilled with that date & hour!
      canvas.querySelectorAll('[data-gcal-slot-date]').forEach((cell) => {
        cell.addEventListener('click', (e) => {
          if (suppressNextSlotClick) return;
          if (e.target.closest('[data-gcal-ev]')) return;
          const date = cell.dataset.gcalSlotDate;
          const stTime = cell.dataset.gcalSlotTime || '';
          let enTime = '';
          if (stTime) {
            const h = Number(stTime.split(':')[0] || 0);
            enTime = `${String(Math.min(23, h + 1)).padStart(2, '0')}:00`;
          }
          quickAddState = { date, endDate: date, startTime: stTime, endTime: enTime };
          renderCalendarView(canvas);
        });
      });

      // Quick Add Modal bindings
      const closeQuickAdd = () => {
        quickAddState = null;
        renderCalendarView(canvas);
      };
      canvas.querySelector('#gcal-qadd-close')?.addEventListener('click', closeQuickAdd);
      canvas.querySelector('#gcal-qadd-cancel')?.addEventListener('click', closeQuickAdd);
      canvas.querySelector('#gcal-qadd-backdrop')?.addEventListener('click', (e) => {
        if (e.target.id === 'gcal-qadd-backdrop') closeQuickAdd();
      });

      canvas.querySelector('#gcal-qadd-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = String(canvas.querySelector('#gcal-qa-title')?.value || '').trim();
        if (!title) return;
        const startDate = canvas.querySelector('#gcal-qa-start')?.value || todayYmd;
        const endDate = canvas.querySelector('#gcal-qa-end')?.value || startDate;
        const startTime = canvas.querySelector('#gcal-qa-stime')?.value || '';
        const endTime = canvas.querySelector('#gcal-qa-etime')?.value || '';
        const role = canvas.querySelector('#gcal-qa-role')?.value || 'T';
        const projId = canvas.querySelector('#gcal-qa-proj')?.value || '';
        const isCore = Boolean(canvas.querySelector('#gcal-qa-core')?.checked);
        const isSched = Boolean(canvas.querySelector('#gcal-qa-schedule')?.checked);

        const folder = hooks.getOrCreateDailyMemoFolder();
        const fileName = hooks.getUniqueNameInFolder(folder, title, '.md');
        const newDoc = Store.touchNode({
          id: Store.genId(),
          type: 'doc',
          name: fileName,
          icon: isSched ? '📅' : (role === 'M' ? '◆' : (role === 'T' ? '☑️' : '📄')),
          tag: isSched ? `#일정 #${startDate}` : `#${startDate}`,
          tags: isSched ? ['일정'] : [],
          isSchedule: isSched,
          travelMins: 30,
          bufferMins: 10,
          cardRole: role,
          isTodayCore: isCore,
          coreTime: startTime,
          startDate,
          endDate: endDate >= startDate ? endDate : startDate,
          startTime,
          endTime,
          completed: false,
          summary: `# ${title}\n\n`,
          link: '',
          dailyDate: startDate
        });
        folder.children.unshift(newDoc);
        if (projId && Store.findParaEntity(projId)) {
          Store.addRelation({ sourceId: newDoc.id, targetId: projId, type: 'project' });
        }
        hooks.syncDocAfterSave?.(newDoc);
        hooks.saveAndRender();
        quickAddState = null;
        hooks.showToast(`📅 "${title}" 일정이 캘린더에 추가되었습니다.`);
        renderCalendarView(canvas);
      });
    }

    // ---- Compact Live Google Calendar Widget for Dashboard Home ----
    let widgetDate = new Date();
    let widgetDaysMode = 1; // 1 = 오늘 시간표, 3 = 3일 시간표

    function renderDashboardCalendarWidget(container, { onOpenFullCalendar } = {}) {
      if (!container) return;
      const todayYmd = hooks.getTodayYMD();
      const days = Array.from({ length: widgetDaysMode }, (_, i) => addDays(widgetDate, i));
      const startYmd = ymdFromDate(days[0]);
      const endYmd = ymdFromDate(days[days.length - 1]);
      const events = collectEventsForRange(startYmd, endYmd);
      const allDayEvs = events.filter((e) => e.isAllDay);
      const timedEvs = events.filter((e) => !e.isAllDay);

      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const hourH = 34; // compact 34px/hour for dashboard widget
      const startHour = 7;
      const endHour = 23;
      const totalHours = endHour - startHour;
      const nowTop = ((nowMin - startHour * 60) / 60) * hourH;

      const dateTitle = widgetDaysMode === 1
        ? `${days[0].getMonth() + 1}월 ${days[0].getDate()}일 (${DAY_KO[days[0].getDay()]})`
        : `${days[0].getMonth() + 1}/${days[0].getDate()} – ${days[days.length - 1].getMonth() + 1}/${days[days.length - 1].getDate()}`;

      container.innerHTML = `
        <div class="gcal-widget-shell">
          <div class="gcal-w-toolbar">
            <div class="gcal-w-nav">
              <button type="button" class="sb-mini-ghost" data-gw-act="today">오늘</button>
              <button type="button" class="sb-mini-ghost" data-gw-act="prev">‹</button>
              <button type="button" class="sb-mini-ghost" data-gw-act="next">›</button>
              <strong class="gcal-w-title">${esc(dateTitle)}</strong>
            </div>
            <div class="gcal-w-right">
              <button type="button" class="sb-mini-ghost${widgetDaysMode === 1 ? ' is-active' : ''}" data-gw-days="1">일간</button>
              <button type="button" class="sb-mini-ghost${widgetDaysMode === 3 ? ' is-active' : ''}" data-gw-days="3">3일</button>
              <button type="button" class="sb-link-btn" data-gw-act="full">전체 캘린더 →</button>
            </div>
          </div>

          ${allDayEvs.length > 0 ? `
            <div class="gcal-w-allday">
              <span class="gcal-w-ad-lbl">종일</span>
              <div class="gcal-w-ad-chips">
                ${allDayEvs.slice(0, 6).map((ev) => `
                  <button type="button" class="gcal-w-ad-chip" data-gw-ev="${esc(ev.id)}" style="background:${esc(ev.color)};">${esc(ev.title)}</button>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <div class="gcal-w-timeline-scroll" id="gcal-w-scroll">
            <div class="gcal-w-timeline" style="height:${totalHours * hourH}px;">
              <div class="gcal-w-gutter">
                ${Array.from({ length: totalHours }, (_, i) => {
                  const h = startHour + i;
                  return `<div class="gcal-w-hlabel" style="height:${hourH}px;">${String(h).padStart(2, '0')}:00</div>`;
                }).join('')}
              </div>
              <div class="gcal-w-cols" style="grid-template-columns:repeat(${days.length}, minmax(0, 1fr));">
                ${days.map((d) => {
                  const dYmd = ymdFromDate(d);
                  const isToday = dYmd === todayYmd;
                  const dTimed = timedEvs.filter((ev) => ev.startYmd === dYmd).sort((a, b) => a.startMin - b.startMin);
                  return `
                    <div class="gcal-w-col${isToday ? ' is-today' : ''}">
                      ${widgetDaysMode > 1 ? `<div class="gcal-w-colhead${isToday ? ' is-today' : ''}">${d.getDate()} (${DAY_KO[d.getDay()]})</div>` : ''}
                      ${Array.from({ length: totalHours }, (_, i) => `<div class="gcal-w-hcell" style="height:${hourH}px;" data-gw-add-date="${dYmd}" data-gw-add-hour="${startHour + i}"></div>`).join('')}
                      ${dTimed.map((ev) => {
                        const clampedStart = Math.max(startHour * 60, ev.startMin);
                        const clampedEnd = Math.min(endHour * 60, Math.max(clampedStart + 20, ev.endMin));
                        const top = ((clampedStart - startHour * 60) / 60) * hourH;
                        const hPx = Math.max(20, ((clampedEnd - clampedStart) / 60) * hourH - 2);
                        const sH = minutesToHHMM(ev.startMin);
                        const eH = minutesToHHMM(ev.endMin);
                        return `
                          <button type="button" class="gcal-w-block${ev.completed ? ' is-done' : ''}"
                            data-gw-ev="${esc(ev.id)}"
                            style="top:${top}px; height:${hPx}px; background:${esc(ev.color)};"
                            title="${esc(ev.title)} (${sH}–${eH})">
                            <span class="gcal-w-btime">${sH}–${eH}</span>
                            <span class="gcal-w-btitle">${esc(ev.title)}</span>
                          </button>
                        `;
                      }).join('')}
                      ${isToday && nowTop >= 0 && nowTop <= totalHours * hourH ? `<div class="gcal-now-line" style="top:${nowTop}px;"><span class="gcal-now-dot"></span></div>` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>

          <div class="gcal-w-foot">
            <span>오늘 시간 일정 <b>${timedEvs.filter((e) => e.startYmd === todayYmd).length}건</b> · 종일 <b>${allDayEvs.length}건</b></span>
            <span class="sb-muted-sm">시간 칸 클릭 → 일정 추가 · 블록 클릭 → 속성 편집</span>
          </div>
        </div>
      `;

      const sc = container.querySelector('#gcal-w-scroll');
      if (sc) {
        const focusHour = Math.max(0, Math.min(totalHours - 4, now.getHours() - startHour - 1));
        sc.scrollTop = focusHour * hourH;
      }

      container.querySelector('[data-gw-act="today"]')?.addEventListener('click', () => {
        widgetDate = new Date();
        renderDashboardCalendarWidget(container, { onOpenFullCalendar });
      });
      container.querySelector('[data-gw-act="prev"]')?.addEventListener('click', () => {
        widgetDate = addDays(widgetDate, -widgetDaysMode);
        renderDashboardCalendarWidget(container, { onOpenFullCalendar });
      });
      container.querySelector('[data-gw-act="next"]')?.addEventListener('click', () => {
        widgetDate = addDays(widgetDate, widgetDaysMode);
        renderDashboardCalendarWidget(container, { onOpenFullCalendar });
      });
      container.querySelector('[data-gw-act="full"]')?.addEventListener('click', () => {
        if (typeof onOpenFullCalendar === 'function') onOpenFullCalendar();
      });
      container.querySelectorAll('[data-gw-days]').forEach((b) => {
        b.addEventListener('click', () => {
          widgetDaysMode = Number(b.dataset.gwDays || 1);
          renderDashboardCalendarWidget(container, { onOpenFullCalendar });
        });
      });
      container.querySelectorAll('[data-gw-ev]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const evId = btn.dataset.gwEv || '';
          if (evId.startsWith('doc:')) {
            const doc = Store.findNodeAndParent(evId.slice(4))?.node;
            if (doc && typeof hooks.openCardProps === 'function') hooks.openCardProps(doc);
          } else if (evId.startsWith('sched:')) {
            hooks.openScheduleModal?.();
          }
        });
      });
      container.querySelectorAll('[data-gw-add-date]').forEach((cell) => {
        cell.addEventListener('click', () => {
          const d = cell.dataset.gwAddDate;
          const h = Number(cell.dataset.gwAddHour || 9);
          cursorDate = parseYmd(d);
          quickAddState = {
            date: d,
            endDate: d,
            startTime: `${String(h).padStart(2, '0')}:00`,
            endTime: `${String(Math.min(23, h + 1)).padStart(2, '0')}:00`
          };
          if (typeof onOpenFullCalendar === 'function') onOpenFullCalendar();
        });
      });
    }

    return {
      renderCalendarView,
      renderDashboardCalendarWidget,
      setViewMode(m) { viewMode = m; }
    };
  }

  global.BrainGoogleCalendar = {
    createGoogleCalendar
  };
})(window);
