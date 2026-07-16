/**
 * DecisionCard — 一張卡片對應一個 TriggerDecision
 *
 * 卡片頂部（最醒目）：
 *   1. CMS 看板文字   — 黃色大字區塊
 *   2. 指揮官引導文字 — 藍/紫色大字區塊，含 LLM/MOCK badge + 模型名稱
 *
 * 其餘區塊依序：判定依據 → 建議動作 → 疏散路徑 → ETE → 連動提示
 */

import React from 'react'

// ─── 顏色常數 ────────────────────────────────────────────────────
const SEVERITY_COLOR = {
  critical: '#ff4757',
  red:      '#ff6b81',
  yellow:   '#ffd32a',
  info:     '#70a1ff',
}
const CLAUSE_COLOR = {
  'SOP-1': '#4a9eff',
  'SOP-2': '#fd79a8',
  'SOP-5': '#fdcb6e',
}

// ─── Styles ──────────────────────────────────────────────────────
const s = {
  list: { display: 'flex', flexDirection: 'column', gap: '16px' },

  empty: {
    padding: '32px',
    textAlign: 'center',
    color: '#636e72',
    border: '2px dashed rgba(74,158,255,0.15)',
    borderRadius: '12px',
    background: 'rgba(14,21,37,0.4)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },

  card: (triggered, clause) => ({
    background: 'rgba(14, 21, 37, 0.70)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    border: `1px solid ${triggered
      ? (CLAUSE_COLOR[clause] || '#2e3141') + '66'
      : 'rgba(74,158,255,0.1)'}`,
    borderRadius: '14px',
    overflow: 'hidden',
    opacity: triggered ? 1 : 0.7,
  }),

  // ── 卡片 header ──
  header: (triggered, clause) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '13px 18px',
    background: triggered
      ? `${CLAUSE_COLOR[clause] || '#444'}18`
      : 'rgba(255,255,255,0.04)',
    borderBottom: `1px solid ${triggered
      ? (CLAUSE_COLOR[clause] || '#2e3141') + '33'
      : 'rgba(74,158,255,0.08)'}`,
  }),
  clauseBadge: (clause) => ({
    background: `${CLAUSE_COLOR[clause] || '#636e72'}22`,
    color: CLAUSE_COLOR[clause] || '#636e72',
    border: `1px solid ${CLAUSE_COLOR[clause] || '#636e72'}44`,
    borderRadius: '6px',
    padding: '3px 9px',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.5px',
  }),
  severityDot: (severity) => ({
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    background: SEVERITY_COLOR[severity] || '#636e72',
    flexShrink: 0,
    boxShadow: `0 0 6px ${SEVERITY_COLOR[severity] || '#636e72'}88`,
  }),
  clauseName: { fontWeight: 600, fontSize: '15px', flex: 1 },
  entityTag: {
    background: '#ffffff10',
    border: '1px solid #ffffff18',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '11px',
    color: '#8b90a7',
    fontFamily: 'monospace',
  },

  // ── 카드 body ──
  body: { padding: '0' },

  // ── 頂部醒目區塊的容器 ──
  highlightZone: {
    padding: '14px 18px 6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    background: 'rgba(0,0,0,0.15)',
    borderBottom: '1px solid rgba(74,158,255,0.08)',
  },

  // ── CMS 看板文字 ──
  cmsOuter: {
    background: 'linear-gradient(135deg, rgba(255,211,42,0.12), rgba(255,168,0,0.08))',
    border: '1px solid rgba(255,211,42,0.35)',
    borderRadius: '10px',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  cmsLabel: {
    fontSize: '10px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: '#ffd32a',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  cmsText: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#ffe57f',
    lineHeight: 1.5,
    letterSpacing: '0.3px',
  },

  // ── 指揮官引導文字 ──
  guidanceOuter: (source) => ({
    background: source === 'llm'
      ? 'linear-gradient(135deg, rgba(74,158,255,0.14), rgba(108,92,231,0.10))'
      : 'linear-gradient(135deg, rgba(100,110,140,0.14), rgba(80,90,120,0.10))',
    border: `1px solid ${source === 'llm'
      ? 'rgba(74,158,255,0.40)'
      : 'rgba(140,148,170,0.30)'}`,
    borderRadius: '10px',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  }),
  guidanceLabelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    flexWrap: 'wrap',
  },
  guidanceLabel: {
    fontSize: '10px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: '#8b9fd4',
  },
  // source badge
  sourceBadge: (source) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    background: source === 'llm'
      ? 'linear-gradient(135deg, rgba(74,158,255,0.25), rgba(108,92,231,0.25))'
      : 'rgba(100,110,140,0.25)',
    color: source === 'llm' ? '#7ecfff' : '#8b90a7',
    border: `1px solid ${source === 'llm' ? 'rgba(74,158,255,0.5)' : 'rgba(140,148,170,0.35)'}`,
    borderRadius: '5px',
    padding: '2px 8px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.4px',
  }),
  guidanceText: (source) => ({
    fontSize: '14px',
    fontWeight: 500,
    color: source === 'llm' ? '#c8dbf8' : '#9aa0bb',
    lineHeight: 1.65,
  }),

  // ── 其餘 body 내용 ──
  inner: { padding: '14px 18px' },
  section: { marginBottom: '14px' },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    color: '#8b90a7',
    marginBottom: '6px',
  },
  basis: { fontSize: '13px', color: '#c8cbda', lineHeight: 1.6 },

  actionList: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' },
  actionItem: {
    background: 'rgba(74,158,255,0.05)',
    borderRadius: '6px',
    padding: '7px 10px',
    fontSize: '12px',
    color: '#e0e3f0',
    borderLeft: '3px solid #4a9eff',
  },

  routeBox: (color) => ({
    background: `${color}12`,
    border: `1px solid ${color}33`,
    borderRadius: '8px',
    padding: '10px 14px',
    marginBottom: '8px',
  }),
  routeLabel: (color) => ({
    fontSize: '11px',
    fontWeight: 700,
    color: color,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px',
  }),
  routeId: { fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: '#e8eaf6' },

  eteBox: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    background: '#fd79a815',
    border: '1px solid #fd79a833',
    borderRadius: '8px',
    padding: '8px 14px',
  },
  eteValue: {
    fontSize: '22px',
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
    color: '#fd79a8',
  },
  eteUnit: { fontSize: '12px', color: '#8b90a7', fontWeight: 500 },

  cascadeList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  cascadeItem: {
    background: '#70a1ff12',
    border: '1px solid #70a1ff22',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '12px',
    color: '#a8b8f0',
    lineHeight: 1.5,
  },

  excludedList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  excludedItem: {
    display: 'flex', gap: '8px', alignItems: 'flex-start',
    padding: '5px 8px', borderRadius: '5px', background: '#ffffff05',
  },
  excludedId: { fontFamily: 'monospace', fontSize: '11px', color: '#636e72', flexShrink: 0, paddingTop: '1px' },
  excludedReason: { fontSize: '11px', color: '#636e72', lineHeight: 1.4 },
}

// ─── 頂部醒目區塊 ────────────────────────────────────────────────
function HighlightZone({ cmsText, guidanceText, guidanceSource, triggered }) {
  // 沒有任何要顯示的內容就不渲染
  if (!triggered || (!cmsText && !guidanceText)) return null

  const source = guidanceSource || 'mock'

  return (
    <div style={s.highlightZone}>
      {/* CMS 看板文字 */}
      {cmsText && (
        <div style={s.cmsOuter} role="note" aria-label="CMS 電子看板文字">
          <div style={s.cmsLabel}>
            {/* 小喇叭 icon */}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
            CMS 電子看板
          </div>
          <div style={s.cmsText}>{cmsText}</div>
        </div>
      )}

      {/* 指揮官引導文字 */}
      {guidanceText && (
        <div style={s.guidanceOuter(source)} aria-label="指揮官引導文字">
          <div style={s.guidanceLabelRow}>
            {/* 指揮官 icon */}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8b9fd4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span style={s.guidanceLabel}>指揮官引導</span>

            {/* LLM / MOCK badge */}
            <span style={s.sourceBadge(source)}>
              {source === 'llm' ? (
                <>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  LLM
                </>
              ) : (
                <>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                  </svg>
                  MOCK
                </>
              )}
            </span>
          </div>

          <div style={s.guidanceText(source)}>{guidanceText}</div>
        </div>
      )}
    </div>
  )
}

// ─── 疏散路徑子元件 ──────────────────────────────────────────────
function RouteInfo({ primaryRoute, secondaryRoutes, excludedRoutes }) {
  return (
    <div style={s.section}>
      <div style={s.sectionLabel}>疏散路徑規劃</div>
      {primaryRoute ? (
        <div style={s.routeBox('#2ed573')}>
          <div style={s.routeLabel('#2ed573')}>主疏散路徑</div>
          <div style={s.routeId}>{primaryRoute}</div>
        </div>
      ) : (
        <div style={{ ...s.routeBox('#636e72'), color: '#636e72', fontSize: '12px' }}>
          無符合條件的主疏散路徑
        </div>
      )}

      {secondaryRoutes && secondaryRoutes.length > 0 && (
        <div style={s.routeBox('#70a1ff')}>
          <div style={s.routeLabel('#70a1ff')}>次要疏散路徑（下游）</div>
          {secondaryRoutes.map(id => (
            <div key={id} style={s.routeId}>{id}</div>
          ))}
        </div>
      )}

      {excludedRoutes && excludedRoutes.length > 0 && (
        <div style={s.section}>
          <div style={{ ...s.sectionLabel, marginTop: '8px' }}>排除候選（{excludedRoutes.length} 條）</div>
          <div style={s.excludedList}>
            {excludedRoutes.map((r, i) => (
              <div key={i} style={s.excludedItem}>
                <span style={s.excludedId}>{r.segment_id}</span>
                <span style={s.excludedReason}>{r.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 單張卡片 ────────────────────────────────────────────────────
function SingleCard({ decision }) {
  const {
    triggered,
    sop_clause,
    clause_name,
    entity_id,
    entity_name,
    basis,
    actions,
    cascade_checks,
    severity,
    primary_route,
    secondary_routes,
    excluded_routes,
    ete_minutes,
    cms_text,
    guidance_text,
    guidance_source,
  } = decision

  return (
    <article
      style={s.card(triggered, sop_clause)}
      role="region"
      aria-label={`${clause_name || '無觸發條款'} 決策卡片`}
    >
      {/* ── Header ── */}
      <header style={s.header(triggered, sop_clause)}>
        <span style={s.severityDot(severity)} aria-hidden="true" />
        {triggered && sop_clause ? (
          <span style={s.clauseBadge(sop_clause)}>{sop_clause}</span>
        ) : (
          <span style={{ ...s.clauseBadge(null), background: '#ffffff10', color: '#636e72', borderColor: '#ffffff15' }}>
            未觸發
          </span>
        )}
        <span style={s.clauseName}>{clause_name || '無觸發條款'}</span>
        {entity_id && <span style={s.entityTag}>{entity_id}</span>}
        {entity_name && entity_name !== entity_id && (
          <span style={{ ...s.entityTag, fontFamily: 'inherit' }}>{entity_name}</span>
        )}
      </header>

      {/* ── 頂部醒目區塊：CMS + 指揮官引導 ── */}
      <HighlightZone
        cmsText={cms_text}
        guidanceText={guidance_text}
        guidanceSource={guidance_source}
        triggered={triggered}
      />

      {/* ── 其餘資訊 ── */}
      <div style={s.inner}>
        {/* 判定依據 */}
        <div style={s.section}>
          <div style={s.sectionLabel}>判定依據</div>
          <p style={s.basis}>{basis}</p>
        </div>

        {/* 建議動作 */}
        {triggered && actions && actions.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionLabel}>建議動作</div>
            <ul style={s.actionList}>
              {actions.map((a, i) => (
                <li key={i} style={s.actionItem}>{a}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 疏散路徑（SOP-2） */}
        {triggered && sop_clause === 'SOP-2' && (
          <RouteInfo
            primaryRoute={primary_route}
            secondaryRoutes={secondary_routes}
            excludedRoutes={excluded_routes}
          />
        )}

        {/* ETE */}
        {triggered && ete_minutes != null && (
          <div style={s.section}>
            <div style={s.sectionLabel}>預計恢復時間（ETE）</div>
            <div style={s.eteBox}>
              <span style={s.eteValue}>{ete_minutes}</span>
              <span style={s.eteUnit}>分鐘</span>
            </div>
          </div>
        )}

        {/* 連動提示 */}
        {cascade_checks && cascade_checks.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionLabel}>連動提示</div>
            <div style={s.cascadeList}>
              {cascade_checks.map((cc, i) => (
                <div key={i} style={s.cascadeItem}>{cc}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

// ─── Main export ─────────────────────────────────────────────────
export default function DecisionCard({ decisions }) {
  if (!decisions || decisions.length === 0) {
    return (
      <div style={s.empty} role="status" aria-live="polite">
        尚無決策資料。請從左側注入一筆突發事件。
      </div>
    )
  }

  return (
    <section style={s.list} aria-label="SOP 決策卡片清單">
      {decisions.map((d, i) => (
        <SingleCard key={d.sop_clause || `no-trigger-${i}`} decision={d} />
      ))}
    </section>
  )
}
