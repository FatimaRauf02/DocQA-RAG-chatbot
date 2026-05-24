'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '../components/Sidebar'
import ChatWindow, { ChatWindowHandle } from '../components/ChatWindow'
import AuthPage from '../components/AuthPage'

const API = 'http://localhost:8000'

export type ImageResult = {
  filename: string
  page: number
  description: string
  b64: string
  mime: string
}

export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  sources?: Source[]
  images?: ImageResult[]
  confidence?: number
  model_used?: string
  used_web?: boolean
  timestamp?: number
}

export type Source = {
  filename: string
  page: number
  doc_id: string
  snippet: string
  relevance?: number
  is_image?: boolean
}

export type Doc = {
  doc_id: string
  filename: string
  pages?: number
  chunks?: number
  images?: number
  file_type?: string
}

export type ChatSession = {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  pinned?: boolean
}

export type User = {
  username: string
}

export default function Home() {
  const [user, setUser]                       = useState<User | null>(null)
  const [docs, setDocs]                       = useState<Doc[]>([])
  const [sessions, setSessions]               = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loading, setLoading]                 = useState(false)
  const [model, setModel]                     = useState('llama-3.1-8b-instant')
  const [uploadOpen, setUploadOpen]           = useState(false)
  const [darkMode, setDarkMode]               = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem('docqa_dark')
    return stored === null ? true : stored === 'true'
  })
  const chatRef = useRef<ChatWindowHandle>(null)

  // ── Apply theme ─────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('docqa_dark', String(darkMode))
  }, [darkMode])

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem('docqa_user')
    if (stored) setUser(JSON.parse(stored))
  }, [])

  useEffect(() => {
    if (user) {
      const stored = localStorage.getItem(`docqa_sessions_${user.username}`)
      if (stored) {
        const parsed = JSON.parse(stored) as ChatSession[]
        setSessions(parsed)
        if (parsed.length > 0) setActiveSessionId(parsed[0].id)
      }
      fetchDocs()
    }
  }, [user])

  useEffect(() => {
    if (user && sessions.length >= 0) {
      localStorage.setItem(`docqa_sessions_${user.username}`, JSON.stringify(sessions))
    }
  }, [sessions, user])

  const handleLogin = (username: string) => {
    const u = { username }
    setUser(u)
    localStorage.setItem('docqa_user', JSON.stringify(u))
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem('docqa_user')
    setSessions([])
    setActiveSessionId(null)
  }

  // ── Sessions ────────────────────────────────────────────────────────────────
  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null
  const messages      = activeSession?.messages ?? []

  const createNewSession = useCallback(() => {
    const id = `s_${Date.now()}`
    const session: ChatSession = {
      id,
      title:     'New Chat',
      messages:  [],
      createdAt: Date.now(),
      pinned:    false,
    }
    setSessions(prev => [session, ...prev])
    setActiveSessionId(id)
    return id
  }, [])

  const deleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id))
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id)
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
    }
  }

  const renameSession = (id: string, title: string) =>
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s))

  const pinSession = (id: string) =>
    setSessions(prev => prev.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s))

  const addMessage = useCallback((msg: Message, sid?: string) => {
    const targetId = sid ?? activeSessionId
    setSessions(prev => prev.map(s => {
      if (s.id !== targetId) return s
      const newMsgs  = [...s.messages, msg]
      const firstUser = newMsgs.find(m => m.role === 'user')
      const title = firstUser
        ? firstUser.content.slice(0, 38) + (firstUser.content.length > 38 ? '…' : '')
        : s.title
      return { ...s, messages: newMsgs, title }
    }))
  }, [activeSessionId])

  // ── Docs ────────────────────────────────────────────────────────────────────
  const fetchDocs = useCallback(async () => {
    try {
      const r = await fetch(`${API}/documents`)
      const d = await r.json()
      setDocs(d.documents || [])
    } catch {}
  }, [])

  const handleUpload = async (files: File[]) => {
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    let sid = activeSessionId
    if (!sid) sid = createNewSession()
    try {
      const r = await fetch(`${API}/upload`, { method: 'POST', body: form })
      const d = await r.json()
      await fetchDocs()
      setUploadOpen(false)
      const fileWord = (d.uploaded?.length ?? 0) === 1 ? 'file' : 'files'
      addMessage({
        id:        Date.now().toString(),
        role:      'system',
        content:   `✅ Indexed ${d.uploaded?.length ?? 0} ${fileWord} successfully.`,
        timestamp: Date.now(),
      }, sid)
    } catch {
      addMessage({
        id:        Date.now().toString(),
        role:      'system',
        content:   '❌ Upload failed — make sure the backend is running on port 8000.',
        timestamp: Date.now(),
      }, sid)
    }
  }

  const handleDeleteDoc = async (doc_id: string) => {
    await fetch(`${API}/documents/${doc_id}`, { method: 'DELETE' })
    await fetchDocs()
  }

  // ── Chat ────────────────────────────────────────────────────────────────────
  const handleSend = async (question: string) => {
    let sid = activeSessionId
    if (!sid) sid = createNewSession()

    addMessage({
      id:        Date.now().toString(),
      role:      'user',
      content:   question,
      timestamp: Date.now(),
    }, sid)

    setLoading(true)
    try {
      const r = await fetch(`${API}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question, session_id: sid, model }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Error')
      addMessage({
        id:         (Date.now() + 1).toString(),
        role:       'assistant',
        content:    d.answer,
        sources:    d.sources,
        images:     d.images,
        confidence: d.confidence,
        model_used: d.model_used,
        used_web:   d.used_web,
        timestamp:  Date.now(),
      }, sid)
    } catch (e: any) {
      addMessage({
        id:        (Date.now() + 1).toString(),
        role:      'system',
        content:   `Error: ${e.message}`,
        timestamp: Date.now(),
      }, sid)
    }
    setLoading(false)
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const lines: string[] = [
      '='.repeat(60),
      'DocQA — Chat Export',
      `User: ${user?.username}`,
      `Session: ${activeSession?.title}`,
      `Exported: ${new Date().toLocaleString()}`,
      '='.repeat(60),
      '',
    ]
    messages.forEach(msg => {
      if (msg.role === 'user') {
        lines.push(`[You] ${msg.content}`)
        lines.push('')
      } else if (msg.role === 'assistant') {
        lines.push(`[DocQA] ${msg.content}`)
        if (msg.used_web) lines.push('(Answer from web search)')
        if (msg.sources?.length) {
          lines.push('Sources:')
          msg.sources.forEach((s, i) => lines.push(`  [${i + 1}] ${s.filename} — p.${s.page}`))
        }
        lines.push(`Confidence: ${Math.round((msg.confidence ?? 0) * 100)}% | Model: ${msg.model_used}`)
        lines.push('')
      } else {
        lines.push(`[System] ${msg.content}`)
        lines.push('')
      }
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `docqa-${activeSession?.title ?? 'chat'}-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Clear ───────────────────────────────────────────────────────────────────
  const handleClear = async () => {
    if (activeSessionId) {
      await fetch(`${API}/history/${activeSessionId}`, { method: 'DELETE' })
      setSessions(prev => prev.map(s =>
        s.id === activeSessionId
          ? { ...s, messages: [], title: 'New Chat' }
          : s
      ))
    }
  }

// ── Share ───────────────────────────────────────────────────────────────────
  const handleShareChat = () => {
    const text = messages
      .filter(m => m.role !== 'system')
      .map(m => m.role === 'user' ? `Q: ${m.content}` : `A: ${m.content}`)
      .join('\n\n')
    navigator.clipboard.writeText(text)
    return text
  }

  if (!user) return <AuthPage onLogin={handleLogin} />

  return (
    <div className="app">
      <Sidebar
        docs={docs}
        onDeleteDoc={handleDeleteDoc}
        onUploadClick={() => { if (!activeSessionId) createNewSession(); setUploadOpen(true) }}
        model={model}
        onModelChange={setModel}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onDeleteSession={deleteSession}
        onRenameSession={renameSession}
        onPinSession={pinSession}
        onNewChat={createNewSession}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(d => !d)}
        user={user}
        onLogout={handleLogout}
      />
      <div className="main">
        <ChatWindow
          ref={chatRef}
          messages={messages}
          loading={loading}
          onSend={handleSend}
          onExport={handleExport}
          onClear={handleClear}
          onShare={handleShareChat}
          onUploadClick={() => { if (!activeSessionId) createNewSession(); setUploadOpen(true) }}
          hasDocs={docs.length > 0}
          sessionTitle={activeSession?.title ?? 'New Conversation'}
        />
      </div>
      {uploadOpen && (
        <UploadModal
          onUpload={handleUpload}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </div>
  )
} 
// ── Upload Modal ───────────────────────────────────────────────────────────────
function UploadModal({
  onUpload,
  onClose,
}: {
  onUpload: (f: File[]) => void
  onClose: () => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [over, setOver]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const add = (incoming: FileList | null) => {
    if (!incoming) return
    const allowed = Array.from(incoming).filter(f =>
      f.name.toLowerCase().endsWith('.pdf') ||
      f.type.startsWith('image/')           ||
      f.name.toLowerCase().endsWith('.jpg') ||
      f.name.toLowerCase().endsWith('.jpeg')||
      f.name.toLowerCase().endsWith('.png') ||
      f.name.toLowerCase().endsWith('.webp')
    )
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...allowed.filter(f => !names.has(f.name))]
    })
  }

  const fmt = (b: number) =>
    b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'KB' : (b / 1048576).toFixed(1) + 'MB'

  const fileIcon = (f: File) => f.type.startsWith('image/') ? '🖼️' : '📄'

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">Upload Files</div>
        <div className="modal-sub">PDF or images (JPG, PNG, WebP) · multiple files · indexed locally</div>
        <div
          className={`modal-drop${over ? ' over' : ''}`}
          onDragOver={e  => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e      => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
        >
          <div className="modal-drop-icon">📂</div>
          <div className="modal-drop-text">Drag & drop files here</div>
          <div className="modal-drop-hint">PDF, JPG, PNG, WebP supported</div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,image/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => add(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <div className="file-list">
            {files.map((f, i) => (
              <div key={i} className="file-row">
                <span>{fileIcon(f)}</span>
                <span className="file-row-name">{f.name}</span>
                <span className="file-row-size">{fmt(f.size)}</span>
                <button
                  className="file-row-del"
                  onClick={() => setFiles(p => p.filter((_, j) => j !== i))}
                >✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={async () => { setBusy(true); await onUpload(files); setBusy(false) }}
            disabled={!files.length || busy}
          >
            {busy ? 'Indexing…' : `Upload${files.length ? ` (${files.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}