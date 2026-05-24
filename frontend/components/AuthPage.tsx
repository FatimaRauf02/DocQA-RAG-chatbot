'use client'
import { useState } from 'react'

const USERS_KEY = 'docqa_users'

function getUsers(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const stored = localStorage.getItem(USERS_KEY)
  return stored ? JSON.parse(stored) : {}
}

function saveUsers(users: Record<string, string>) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

export default function AuthPage({ onLogin }: { onLogin: (username: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [mode, setMode]         = useState<'login' | 'signup'>('login')
  const [usernameOk, setUsernameOk] = useState<null | boolean>(null)

  const checkUsername = (val: string) => {
    setUsername(val)
    if (val.length < 3) { setUsernameOk(null); return }
    const users = getUsers()
    if (mode === 'signup') setUsernameOk(!(val in users))
  }

  const handleSubmit = () => {
    setError('')
    if (!username.trim() || !password.trim()) { setError('Please fill in both fields.'); return }
    if (username.length < 3) { setError('Username must be at least 3 characters.'); return }
    const users = getUsers()

    if (mode === 'signup') {
      if (username in users) { setError('Username already taken. Choose another.'); return }
      if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
      users[username] = password
      saveUsers(users)
      onLogin(username)
    } else {
      if (!(username in users)) { setError('Username not found.'); return }
      if (users[username] !== password) { setError('Incorrect password.'); return }
      onLogin(username)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-icon">◈</div>
          <div className="auth-brand-name">DocQA</div>
        </div>
        <div className="auth-subtitle">Intelligent Document Analysis</div>

        <div className="auth-tabs">
          <button className={`auth-tab${mode==='login'?' active':''}`} onClick={()=>{setMode('login');setError('');setUsernameOk(null)}}>Login</button>
          <button className={`auth-tab${mode==='signup'?' active':''}`} onClick={()=>{setMode('signup');setError('');setUsernameOk(null)}}>Sign Up</button>
        </div>

        <div className="auth-form">
          <div className="auth-field">
            <label className="auth-label">Username</label>
            <div className="auth-input-wrap">
              <input
                className={`auth-input${usernameOk === true ? ' ok' : usernameOk === false ? ' err' : ''}`}
                placeholder="Enter unique username"
                value={username}
                onChange={e => checkUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
              {mode === 'signup' && usernameOk === true && <span className="auth-check">✓ Available</span>}
              {mode === 'signup' && usernameOk === false && <span className="auth-taken">✗ Taken</span>}
            </div>
          </div>

          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input
              className="auth-input"
              type="password"
              placeholder={mode === 'signup' ? 'Min 6 characters' : 'Enter password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-btn" onClick={handleSubmit}>
            {mode === 'login' ? 'Login' : 'Create Account'}
          </button>
        </div>

        <div className="auth-footer">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <span className="auth-link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setUsernameOk(null) }}>
            {mode === 'login' ? 'Sign up' : 'Login'}
          </span>
        </div>
      </div>
    </div>
  )
}