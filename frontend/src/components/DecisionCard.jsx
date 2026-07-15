/**
 * DecisionCard — 一張卡片對應一個 TriggerDecision
 *
 * 支援渲染 TriggerDecision 陣列（0 到多筆）：
 *   <DecisionCard decisions={decisions} />
 *
 * 卡片依 sop_clause 決定顯示哪些子區塊：
 *   - triggered=false → 灰階，只顯示 basis + cascade_checks
 *   - SOP-1 → 顯示 actions
 *   - SOP-2 → 顯示路徑規劃 + ETE + CMS
 *   - SOP-5 → 顯示 actions + ETE + CMS
 */

import React from 'react'

// ─── Severity → 顏色 ────────────────────────────────────────────
const SEVERITY_COLOR = {
  critical: '#ff4757',
  red:      '#ff6b81',
  yellow:   '#ffd32a',
  info:     '#70a1ff',
}

// ─── SOP clause → 主題色 ─────────────────────────────────────────
const CLAUSE_COLOR = {
  'SOP-1': '#4a9eff',
  'SOP-2': '#fd79a8',
  'SOP-5': '#fdcb6e',
}

const styles = {
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
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
    background: 'rgba(14, 21, 37, 0.65)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${triggered ? (CLAUSE_COLOR[clause] || '#2e3141') + '55' : 'rgba(74,158,255,0.1)'}`,
    borderRadius: '12px',
    overflow: 'hidden',
    opacity: triggered ? 1 : 0.7,
  }),
  header: (triggered, clause, severity) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 18px',
    background: triggered
      ? `${CLAUSE_COLOR[clause] || '#444'}15`
      : 'rgba(255,255,255,0.04)',
    borderBottom: `1px solid ${triggered ? (CLAUSE_COLOR[clause] || '#2e3141') + '33' : 'rgba(74,158,255,0.08)'}`,
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
  }),
  clauseName: {
    fontWeight: 600,
    fontSize: '15px',
    flex: 1,
  },
  entityTag: {
    background: '#ffffff10',
    border: '1px solid #ffffff18',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '11px',
    color: '#8b90a7',
    fontFamily: 'monospace',
  },
  body: { padding: '16px 18px' },
  section: { marginBottom: '14px' },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    color: '#8b90a7',
    marginBottom: '6px',
  },
  basis: {
    fontSize: '13px',
    color: '#c8cbda',
    lineHeight: 1.6,
  },
  actionList: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
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
  routeId: {
    fontFamily: 'monospace',
    fontSize: '13px',
    fontWeight: 600,
    color: '#e8eaf6',
  },
  eTeBox: {
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
  eteUnit: {
    fontSize: '12px',
    color: '#8b90a7',
    fontWeight: 500,
  },
  cmsBox: {
    background: '#ffffff07',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#ffd32a',
    lineHeight: 1.5,
    fontWeight: 500,
  },
  cascadeList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  cascadeItem: {
    background: '#70a1ff12',
    border: '1px solid #70a1ff22',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '12px',
    color: '#a8b8f0',
    lineHeight: 1.5,
  },
  excludedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  excludedItem: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    padding: '5px 8px',
    borderRadius: '5px',
    background: '#ffffff05',
  },
  excludedId: {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: '#636e72',
    flexShrink: 0,
    paddingTop: '1px',
  },
  excludedReason: {
    fontSize: '11px',
    color: '#636e72',
    lineHeight: 1.4,
  },
}

// ─── Sub-components ──────────────────────────────────────────────

function RouteInfo({ primaryRoute, secondaryRoutes, excludedRoutes }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionLabel}>疏散路徑規劃</div>
      {primaryRoute ? (
        <div style={styles.routeBox('#2ed573')}>
          <div style={styles.routeLabel('#2ed573')}>主疏散路徑</div>
          <div style={styles.routeId}>{primaryRoute}</div>
        </div>
      ) : (
        <div style={{ ...styles.routeBox('#636e72'), color: '#636e72', fontSize: '12px' }}>
          無符合條件的主疏散路徑
        </div>
      )}

      {secondaryRoutes && secondaryRoutes.length > 0 && (
        <div style={styles.routeBox('#70a1ff')}>
          <div style={styles.routeLabel('#70a1ff')}>次要疏散路徑（下游）</div>
          {secondaryRoutes.map(id => (
            <div key={id} style={styles.routeId}>{id}</div>
          ))}
        </div>
      )}

      {excludedRoutes && excludedRoutes.length > 0 && (
        <div style={styles.section}>
          <div style={{ ...styles.sectionLabel, marginTop: '8px' }}>排除候選（{excludedRoutes.length}條）</div>
          <div style={styles.excludedList}>
            {excludedRoutes.map((r, i) => (
              <div key={i} style={styles.excludedItem}>
                <span style={styles.excludedId}>{r.segment_id}</span>
                <span style={styles.excludedReason}>{r.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

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
  } = decision

  return (
    <article
      style={styles.card(triggered, sop_clause)}
      role="region"
      aria-label={`${clause_name || '無觸發條款'} 決策卡片`}
    >
      {/* Header */}
      <header style={styles.header(triggered, sop_clause, severity)}>
        <span style={styles.severityDot(severity)} aria-hidden="true" />
        {triggered && sop_clause && (
          <span style={styles.clauseBadge(sop_clause)}>{sop_clause}</span>
        )}
        {!triggered && (
          <span style={{ ...styles.clauseBadge(null), background: '#ffffff10', color: '#636e72', borderColor: '#ffffff15' }}>
            未觸發
          </span>
        )}
        <span style={styles.clauseName}>{clause_name || '無觸發條款'}</span>
        {entity_id && (
          <span style={styles.entityTag}>{entity_id}</span>
        )}
        {entity_name && entity_name !== entity_id && (
          <span style={{ ...styles.entityTag, fontFamily: 'inherit' }}>{entity_name}</span>
        )}
      </header>

      {/* Body */}
      <div style={styles.body}>
        {/* Basis */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>判定依據</div>
          <p style={styles.basis}>{basis}</p>
        </div>

        {/* Actions */}
        {triggered && actions && actions.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>建議動作</div>
            <ul style={styles.actionList}>
              {actions.map((a, i) => (
                <li key={i} style={styles.actionItem}>{a}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Route planning (SOP-2) */}
        {triggered && sop_clause === 'SOP-2' && (
          <RouteInfo
            primaryRoute={primary_route}
            secondaryRoutes={secondary_routes}
            excludedRoutes={excluded_routes}
          />
        )}

        {/* ETE (SOP-2 / SOP-5) */}
        {triggered && ete_minutes != null && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>預計恢復時間（ETE）</div>
            <div style={styles.eTeBox}>
              <span style={styles.eteValue}>{ete_minutes}</span>
              <span style={styles.eteUnit}>分鐘</span>
            </div>
          </div>
        )}

        {/* CMS text */}
        {triggered && cms_text && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>CMS 看板文字</div>
            <div style={styles.cmsBox} role="note">{cms_text}</div>
          </div>
        )}

        {/* Cascade checks */}
        {cascade_checks && cascade_checks.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>連動提示</div>
            <div style={styles.cascadeList}>
              {cascade_checks.map((cc, i) => (
                <div key={i} style={styles.cascadeItem}>{cc}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

// ─── Main export ─────────────────────────────────────────────────

/**
 * DecisionCard — 接收 TriggerDecision 陣列，逐一渲染卡片
 */
export default function DecisionCard({ decisions }) {
  if (!decisions || decisions.length === 0) {
    return (
      <div style={styles.empty} role="status" aria-live="polite">
        尚無決策資料。請從上方注入一筆突發事件。
      </div>
    )
  }

  return (
    <section style={styles.list} aria-label="SOP 決策卡片清單">
      {decisions.map((d, i) => (
        <SingleCard key={d.sop_clause || `no-trigger-${i}`} decision={d} />
      ))}
    </section>
  )
}
