'use client'
import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react'
import { Message, Source, ImageResult } from '../app/page'

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t) }, [onDone])
  return <div className="toast">{msg}</div>
}

function ConfBadge({ c }: { c: number }) {
  const pct = Math.round(c * 100)
  const cls = pct >= 70 ? 'high' : pct >= 40 ? 'mid' : 'low'
  return <span className={`badge ${cls}`}>confidence {pct}%</span>
}

function WebBadge() {
  return <span className="badge web-badge">🌐 web search</span>
}

function CopyBtn({ text, onToast }: { text: string; onToast: (m: string) => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    onToast('Answer copied!')
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button className="copy-btn" onClick={copy} title="Copy answer">
      {copied ? '✓' : '⎘'}
    </button>
  )
}

function Sources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false)
  if (!sources?.length) return null
  return (
    <div className="sources">
      <button className="sources-toggle" onClick={() => setOpen(o => !o)}>
        📄 {sources.length} source{sources.length > 1 ? 's' : ''} {open ? '▾' : '▸'}
      </button>
      {open && sources.map((s, i) => (
        <div key={i} className="source-chip">
          <span className="source-num">[{i+1}]</span>
          <div className="source-body">
            <span className="source-title">{s.filename} — p.{s.page}</span>
            <span className="source-snip">{s.snippet}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ImageResults({ images }: { images: ImageResult[] }) {
  const [expanded, setExpanded] = useState<number|null>(null)
  if (!images?.length) return null
  return (
    <div className="image-results">
      <div className="image-results-label">📎 Related Images</div>
      <div className="image-grid">
        {images.map((img, i) => (
          <div key={i} className="image-card" onClick={() => setExpanded(expanded===i ? null : i)}>
            <img src={`data:${img.mime};base64,${img.b64}`} alt={img.description} className="image-thumb"/>
            <div className="image-meta">
              <span className="image-file">{img.filename} — p.{img.page}</span>
              <p className="image-desc-short">
                {expanded===i ? img.description : img.description.slice(0, 80)+'…'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MsgContent({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div className="msg-text">
      {lines.map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p key={i} style={{margin:'2px 0', minHeight: line ? undefined : '8px'}}>
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j}>{part.slice(2,-2)}</strong>
                : <span key={j}>{part}</span>
            )}
          </p>
        )
      })}
    </div>
  )
}

function Msg({ msg, onToast }: { msg: Message; onToast: (m: string) => void }) {
  const timeStr = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    : ''

  if (msg.role === 'system') return (
    <div className="msg-row system">
      <div className="system-msg">{msg.content}</div>
    </div>
  )

  if (msg.role === 'user') return (
    <div className="msg-row user">
      
      <div className="msg-content user-content">
        <div className="msg-bubble user-bubble">{msg.content}</div>
        {timeStr && <div className="msg-time">{timeStr}</div>}
      </div>
    </div>
  )

  return (
    <div className="msg-row assistant">
      <div className="msg-avatar bot-avatar">◈</div>
      <div className="msg-content">
        <div className="msg-name">DocQA</div>
        <div className="msg-bubble bot-bubble">
          <MsgContent content={msg.content} />
          {msg.images && msg.images.length > 0 && <ImageResults images={msg.images} />}
          {!msg.used_web && msg.sources && <Sources sources={msg.sources} />}
        </div>
        <div className="msg-meta">
          {msg.confidence !== undefined && <ConfBadge c={msg.confidence} />}
          {msg.used_web && <WebBadge />}
          {msg.model_used && <span className="badge model-badge">{msg.model_used}</span>}
          {timeStr && <span className="msg-time-inline">{timeStr}</span>}
          <CopyBtn text={msg.content} onToast={onToast} />
        </div>
      </div>
    </div>
  )
}

export interface ChatWindowHandle {
  scrollToMessage: (id: string) => void
}

const ChatWindow = forwardRef<ChatWindowHandle, {
  messages: Message[]
  loading: boolean
  onSend: (q: string) => void
  onExport: () => void
  onClear: () => void
  onShare: () => string
  onUploadClick: () => void
  hasDocs: boolean
  sessionTitle: string
}>(function ChatWindow({ messages, loading, onSend, onExport, onClear, onShare, onUploadClick, hasDocs, sessionTitle }, ref) {
  const [input, setInput]     = useState('')
  const [toast, setToast]     = useState<string|null>(null)
  const bottomRef             = useRef<HTMLDivElement>(null)
  const textRef               = useRef<HTMLTextAreaElement>(null)
  const msgRefs               = useRef<Record<string, HTMLDivElement|null>>({})

  useImperativeHandle(ref, () => ({
    scrollToMessage(id: string) {
      msgRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (textRef.current) {
      textRef.current.style.height = 'auto'
      textRef.current.style.height = Math.min(textRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  const showToast = useCallback((msg: string) => setToast(msg), [])

  const submit = () => {
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    onSend(q)
  }

  const userCount = messages.filter(m => m.role === 'user').length

  return (
    <div className="chat-layout">
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}

      <div className="chat-topbar">
        <div className="chat-title">{sessionTitle}</div>
        <div className="chat-subtitle">
          {userCount > 0 ? `${userCount} message${userCount>1?'s':''}` : 'New conversation'}
        </div>
        {/* Share button removed */}
        {messages.length > 0 && (
          <div className="topbar-actions">
            <button className="action-btn" onClick={onExport}>Export</button>
            <button className="action-btn" onClick={onClear}>Clear</button>
          </div>
        )}
      </div>

      <div className="messages-area">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon-wrap">◈</div>
            <h2 className="empty-title">Ask DocQA anything</h2>
            <p className="empty-sub">
              {hasDocs
                ? 'Ask questions about your uploaded documents. I can also answer general questions.'
                : 'Ask any question — I can answer from your documents or search the web. Upload a PDF to get document-specific answers.'}
            </p>
            {!hasDocs && (
              <div className="upload-zone" onClick={onUploadClick}>
                <div className="upload-zone-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div className="upload-zone-text">Drag and Drop Or</div>
                <div className="upload-zone-link">Browse File To Upload Document</div>
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <div key={msg.id} ref={el => { msgRefs.current[msg.id] = el }}>
                <Msg msg={msg} onToast={showToast} />
              </div>
            ))}
            {loading && (
              <div className="msg-row assistant">
                <div className="msg-avatar bot-avatar">◈</div>
                <div className="msg-content">
                  <div className="msg-name">DocQA</div>
                  <div className="typing-indicator"><span/><span/><span/></div>
                  <div className="thinking-text">
                    {hasDocs ? 'Searching your documents…' : 'Searching the web…'}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef}/>
      </div>

      <div className="input-area">
        <div className="input-row">
          <textarea
            ref={textRef}
            className="input-box"
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            placeholder="Ask anything — documents or general knowledge…"
            disabled={loading}
          />
          <button className="send-btn" onClick={submit} disabled={loading || !input.trim()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div className="input-hint">shift+enter for newline</div>
      </div>
    </div>
  )
})

export default ChatWindow