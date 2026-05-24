'use client'
import { useState, useRef } from 'react'
import { Doc, ChatSession, User } from '../app/page'

function SessionItem({ session, active, onSelect, onDelete, onRename, onPin }: {
  session: ChatSession; active: boolean
  onSelect: () => void; onDelete: () => void; onRename: (t: string) => void; onPin: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle]     = useState(session.title)
  const [menu, setMenu]       = useState(false)

  const confirm = () => { onRename(title.trim() || session.title); setEditing(false); setMenu(false) }

  return (
    <div className={`sb-item${active ? ' active' : ''}`} onClick={() => !editing && onSelect()}>
      {editing ? (
        <input className="sb-rename-input" value={title}
          onChange={e => setTitle(e.target.value)} onBlur={confirm} autoFocus
          onKeyDown={e => { if (e.key==='Enter') confirm(); if (e.key==='Escape') setEditing(false) }}
          onClick={e => e.stopPropagation()} />
      ) : (
        <span className="sb-item-label" onDoubleClick={e => { e.stopPropagation(); setEditing(true) }}>
          {session.pinned && <span className="sb-pin">📌 </span>}
          {session.title}
        </span>
      )}
      <div className="sb-menu-wrap" onClick={e => e.stopPropagation()}>
        <button className="sb-dots" onClick={() => setMenu(m => !m)}>···</button>
        {menu && (
          <div className="sb-menu">
            <button onClick={() => { onPin(); setMenu(false) }}>{session.pinned ? 'Unpin' : 'Pin'}</button>
            <button onClick={() => { setEditing(true); setMenu(false) }}>Rename</button>
            <button className="danger" onClick={() => { onDelete(); setMenu(false) }}>Delete</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Sidebar({
  docs, onDeleteDoc, onUploadClick, model, onModelChange,
  sessions, activeSessionId, onSelectSession, onDeleteSession,
  onRenameSession, onPinSession, onNewChat, darkMode, onToggleDark, user, onLogout
}: {
  docs: Doc[]; onDeleteDoc: (id: string) => void; onUploadClick: () => void
  model: string; onModelChange: (m: string) => void
  sessions: ChatSession[]; activeSessionId: string | null
  onSelectSession: (id: string) => void; onDeleteSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void; onPinSession: (id: string) => void
  onNewChat: () => void; darkMode: boolean; onToggleDark: () => void
  user: User; onLogout: () => void
}) {
  const [search, setSearch]     = useState('')
  const [showDocs, setShowDocs] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  // All sessions in one "Recent" group, sorted by pinned first then createdAt
  const filtered = (search
    ? sessions.filter(s => s.title.toLowerCase().includes(search.toLowerCase()))
    : sessions
  ).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.createdAt - a.createdAt
  })

  if (collapsed) return (
    <aside className="sidebar sidebar-collapsed">
      <button className="sb-collapse-btn" onClick={() => setCollapsed(false)} title="Expand sidebar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
        </svg>
      </button>
    </aside>
  )

  return (
    <aside className="sidebar">

      {/* Brand + collapse button */}
      <div className="sb-brand">
        <span className="sb-logo-icon">◈</span>
        <span className="sb-logo-text">DocQA</span>
        <button className="sb-collapse-btn sb-collapse-inline" onClick={() => setCollapsed(true)} title="Collapse sidebar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </button>
      </div>

      {/* New Chat + Search — like ChatGPT */}
      <div className="sb-top-actions">
        <button className="sb-new-chat" onClick={onNewChat}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Chat
        </button>
        <button className="sb-search-btn" onClick={() => document.getElementById('sb-search-input')?.focus()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          Search chats
        </button>
      </div>

      {/* Search input — hidden by default, shown on focus */}
      <div className="sb-search-wrap">
        <svg className="sb-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input id="sb-search-input" className="sb-search" placeholder="Search chats…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Scrollable body */}
      <div className="sb-scroll">

        {/* Recent — all chats in one scrollable list */}
        {filtered.length > 0 && (
          <div className="sb-group">
            <div className="sb-group-label">Recent Chats</div>
            {filtered.map(s => (
              <SessionItem key={s.id} session={s} active={s.id === activeSessionId}
                onSelect={() => onSelectSession(s.id)} onDelete={() => onDeleteSession(s.id)}
                onRename={t => onRenameSession(s.id, t)} onPin={() => onPinSession(s.id)} />
            ))}
          </div>
        )}
        {filtered.length === 0 && search && <div className="sb-empty">No results</div>}
        {sessions.length === 0 && !search && <div className="sb-empty">No chats yet — start a new one!</div>}

        {/* Documents — highlighted header */}
        <div className="sb-group">
          <button className="sb-group-label sb-docs-toggle" onClick={() => setShowDocs(d => !d)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            Documents
            {docs.length > 0 && <span className="sb-badge">{docs.length}</span>}
            <svg className="sb-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transform: showDocs ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', marginLeft: 'auto' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {showDocs && (
            <div className="sb-docs-list">
              {docs.length === 0 && <div className="sb-empty">No documents uploaded</div>}
              {docs.map(doc => (
                <div key={doc.doc_id} className="sb-doc-item">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="sb-doc-name" title={doc.filename}>{doc.filename}</span>
                  <button className="sb-doc-del" onClick={() => onDeleteDoc(doc.doc_id)}>×</button>
                </div>
              ))}
              <button className="sb-upload-btn" onClick={onUploadClick}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Upload file
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="sb-footer">
        <div className="sb-model-row">
          <span className="sb-footer-label">Model</span>
          <select className="sb-model-select" value={model} onChange={e => onModelChange(e.target.value)}>
            <option value="llama-3.1-8b-instant">Llama 3.1 · 8B</option>
            <option value="llama-3.3-70b-versatile">Llama 3.3 · 70B</option>
            <option value="mixtral-8x7b-32768">Mixtral · 8×7B</option>
          </select>
        </div>
        <div className="sb-divider" />
        <div className="sb-footer-user">
          <span className="sb-username">@{user.username}</span>
          <button className="sb-icon-action" onClick={onToggleDark}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            {darkMode
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
            }
          </button>
          <button className="sb-icon-action sb-icon-logout" onClick={onLogout} title="Log out">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}