import { useState, useEffect, useRef, useCallback } from 'react';
import Markdown from 'react-markdown';
import { supabase } from './supabase.js';
import './App.css';

// ── Session ID — resets on tab close (for conversation memory only) ─────────
const SESSION_ID = (() => {
  const key = 'rag_session_id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
})();

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatBytes(b) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Auth Modal ───────────────────────────────────────────────────────────────
function AuthModal({ onClose }) {
  const [tab, setTab]         = useState('login');   // 'login' | 'signup'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [info, setInfo]       = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!email || !password) { setError('Email and password are required.'); return; }
    setLoading(true);
    try {
      if (tab === 'signup') {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setInfo('Check your email for a confirmation link, then log in.');
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (err) setError(err.message);
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="auth-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="auth-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22" style={{display:'inline',verticalAlign:'middle',marginRight:8,color:'var(--cyan)'}}>
            <rect x="3" y="8" width="18" height="12" rx="2"/>
            <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
            <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/>
            <path d="M9 18h6" strokeLinecap="round"/>
          </svg>
          AI Knowledge Assistant
        </h2>
        <p className="auth-subtitle">Sign in to keep your documents across devices</p>

        <div className="auth-tabs">
          <button className={`auth-tab${tab === 'login' ? ' active' : ''}`} onClick={() => { setTab('login'); setError(''); setInfo(''); }}>Log in</button>
          <button className={`auth-tab${tab === 'signup' ? ' active' : ''}`} onClick={() => { setTab('signup'); setError(''); setInfo(''); }}>Sign up</button>
        </div>

        <form onSubmit={submit} className="auth-form">
          <input className="auth-input" type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} disabled={loading} autoFocus />
          <input className="auth-input" type="password" placeholder="Password (min 6 chars)" value={password}
            onChange={e => setPassword(e.target.value)} disabled={loading} />
          {error && <p className="auth-error">{error}</p>}
          {info  && <p className="auth-info">{info}</p>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : tab === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        {/* Google OAuth — requires setup in Supabase Dashboard → Authentication → Providers → Google
        <div className="auth-divider"><span>or</span></div>
        <button className="auth-google" onClick={signInWithGoogle} disabled={loading}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>
        */}

        <p className="auth-skip">
          <button className="auth-skip-btn" onClick={onClose}>Continue without account →</button>
        </p>
      </div>
    </div>
  );
}

// ── Markdown renderer ────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="copy-btn" onClick={() => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    }} aria-label="Copy code">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function BotMessage({ text, streaming }) {
  return (
    <div className={`md-content${streaming ? ' streaming' : ''}`}>
      <Markdown
        components={{
          code({ inline, className, children }) {
            const lang = (className || '').replace('language-', '') || 'code';
            const code = String(children).replace(/\n$/, '');
            if (inline) return <code className="inline-code">{children}</code>;
            return (
              <div className="code-block-wrapper">
                <div className="code-block-header">
                  <span className="code-lang">{lang}</span>
                  <CopyButton text={code} />
                </div>
                <pre className="code-block"><code>{code}</code></pre>
              </div>
            );
          },
          a({ href, children }) {
            return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          }
        }}
      >
        {text}
      </Markdown>
      {streaming && <span className="stream-cursor" aria-hidden="true" />}
    </div>
  );
}

// ── Mode toggle ──────────────────────────────────────────────────────────────
const MODES = [
  {
    id: 'normal',
    label: 'Normal',
    tip: 'Clear, balanced answer',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    )
  },
  {
    id: 'beginner',
    label: 'Simple',
    tip: 'Plain language, step-by-step',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
        <path d="M12 22V12"/>
        <path d="M12 12C12 12 8 10 8 7a4 4 0 0 1 8 0c0 3-4 5-4 5z"/>
        <path d="M9 21h6"/>
      </svg>
    )
  },
  {
    id: 'detailed',
    label: 'Detailed',
    tip: 'In-depth explanation with examples',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="11" y1="8" x2="11" y2="14"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
    )
  },
];

function ModeToggle({ mode, onChange, disabled }) {
  return (
    <div className="mode-toggle" role="group" aria-label="Response mode">
      {MODES.map(m => (
        <button key={m.id}
          className={`mode-btn${mode === m.id ? ' active' : ''}`}
          onClick={() => onChange(m.id)}
          title={m.tip}
          aria-pressed={mode === m.id}
          disabled={disabled}
        >
          {m.icon}
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ── Source panel ─────────────────────────────────────────────────────────────
function SourcePanel({ sources }) {
  const [openIdx, setOpenIdx] = useState(null);
  if (!sources || sources.length === 0) return null;
  return (
    <div className="source-panel" role="list" aria-label="Answer sources">
      <p className="source-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{flexShrink:0}}>
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
        Based on these documents
      </p>
      {sources.slice(0, 3).map((src, i) => {
        const isOpen = openIdx === i;
        return (
          <div key={i} className={`source-card${isOpen ? ' open' : ''}`} role="listitem">
            <button className="source-header" onClick={() => setOpenIdx(isOpen ? null : i)} aria-expanded={isOpen}>
              <span className="source-num">[{src.sourceNumber}]</span>
              <span className="source-doc">{src.document}</span>
              <span className="source-relevance">{src.relevance}% match</span>
              <span className="source-chevron">{isOpen ? '▲ hide' : '▼ show'}</span>
            </button>
            <div className="relevance-track" aria-hidden="true">
              <div className="relevance-fill" style={{ width: `${Math.max(src.relevance, 8)}%` }} />
            </div>
            {isOpen && <p className="source-snippet">{src.snippet}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ── Upload zone ──────────────────────────────────────────────────────────────
function UploadZone({ onUploadComplete, userId, accessToken }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState(null);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = ['pdf','txt','md','mdx','json','csv','js','jsx','ts','tsx','mjs','py','go','rs','java','c','cpp','cs','rb','php','swift','kt','sh','sql','yaml','yml','toml'];
    if (!allowed.includes(ext)) {
      setStatus({ type: 'error', message: `".${ext}" not supported.` });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus({ type: 'error', message: 'File too large. Max 10 MB.' });
      return;
    }
    setUploading(true);
    setStatus({ type: 'progress', message: `Uploading "${file.name}"…` });
    try {
      const form = new FormData();
      form.append('file', file);
      // Send auth token if logged in, else send anonymous userId
      if (accessToken) {
        form.append('_authToken', accessToken); // picked up by middleware via Authorization header
      } else {
        form.append('userId', userId);
      }
      const headers = accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {};
      const res = await fetch('/api/rag/upload', { method: 'POST', body: form, headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setStatus({ type: 'progress', message: `Processing "${file.name}"…` });
      pollRef.current = setInterval(async () => {
        try {
          const poll = await fetch(`/api/rag/upload/${data.jobId}`);
          const job = await poll.json();
          if (job.status === 'done') {
            clearInterval(pollRef.current);
            setUploading(false);
            setStatus({ type: 'success', message: `"${file.name}" uploaded — ${job.chunksCreated} sections ready` });
            onUploadComplete();
          } else if (job.status === 'failed') {
            clearInterval(pollRef.current);
            setUploading(false);
            setStatus({ type: 'error', message: `Failed: ${job.error}` });
          }
        } catch { /* transient */ }
      }, 2000);
    } catch (err) {
      setUploading(false);
      setStatus({ type: 'error', message: err.message });
    }
  }, [onUploadComplete]);

  const onDrop = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); };

  return (
    <div
      className={`upload-zone${dragging ? ' drag-over' : ''}${uploading ? ' uploading' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !uploading && fileRef.current?.click()}
      role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && !uploading && fileRef.current?.click()}
    >
      <input ref={fileRef} type="file" style={{ display: 'none' }}
        accept=".pdf,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.mjs,.py,.go,.rs,.java,.c,.cpp,.cs,.rb,.php,.swift,.kt,.sh,.sql,.yaml,.yml,.toml"
        onChange={e => handleFile(e.target.files[0])} />
      {uploading
        ? <div className="upload-progress"><span className="upload-spinner" /><span>{status?.message}</span></div>
        : <>
            <span className="upload-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28" style={{color:'var(--text-muted)'}}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <polyline points="9 15 12 12 15 15"/>
              </svg>
            </span>
            <span className="upload-text">Drop a file or click to upload</span>
            <span className="upload-hint">PDF, TXT, MD, JSON · JS, TS, PY and more · Max 10 MB</span>
          </>
      }
      {status && !uploading && (
        <span className={`upload-feedback ${status.type}`}>{status.message}</span>
      )}
    </div>
  );
}

// ── Document library ─────────────────────────────────────────────────────────

// SVG file type icons — no emojis
function FileIcon({ type }) {
  const s = { width: 16, height: 16, flexShrink: 0 };
  if (type === 'pdf') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.5" {...s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <text x="6" y="19" fontSize="6" fill="#f87171" stroke="none" fontWeight="bold">PDF</text>
    </svg>
  );
  if (['js','jsx','mjs'].includes(type)) return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="1.5" {...s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <text x="6" y="19" fontSize="5.5" fill="#fbbf24" stroke="none" fontWeight="bold">JS</text>
    </svg>
  );
  if (['ts','tsx'].includes(type)) return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.5" {...s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <text x="6" y="19" fontSize="5.5" fill="#60a5fa" stroke="none" fontWeight="bold">TS</text>
    </svg>
  );
  if (type === 'py') return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.5" {...s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <text x="6" y="19" fontSize="5.5" fill="#34d399" stroke="none" fontWeight="bold">PY</text>
    </svg>
  );
  if (['md','mdx'].includes(type)) return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5" {...s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <text x="6" y="19" fontSize="5.5" fill="#a78bfa" stroke="none" fontWeight="bold">MD</text>
    </svg>
  );
  // default — generic file
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" {...s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

function fileIconType(doc) {
  const ext = (doc.source || doc.title || '').split('.').pop().toLowerCase();
  if (doc.metadata?.fileType === 'pdf' || ext === 'pdf') return 'pdf';
  return ext || 'default';
}

function DocumentLibrary({ selectedIds, onToggle, refreshTrigger, userId, accessToken }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const headers = accessToken
        ? { 'Authorization': `Bearer ${accessToken}` }
        : { 'X-User-Id': userId };
      const res = await fetch('/api/rag/documents', { headers });
      const data = await res.json();
      setDocs(data.documents || []);
    } catch { setDocs([]); }
    finally { setLoading(false); }
  }, [userId, accessToken]);

  useEffect(() => { fetchDocs(); }, [fetchDocs, refreshTrigger]);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this document and all its chunks?')) return;
    try {
      const headers = accessToken
        ? { 'Authorization': `Bearer ${accessToken}` }
        : { 'X-User-Id': userId };
      await fetch(`/api/rag/documents/${id}`, { method: 'DELETE', headers });
      fetchDocs();
    }
    catch { alert('Delete failed'); }
  };

  if (loading) return <div className="doc-loading">Loading…</div>;
  if (!docs.length) return (
    <div className="doc-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32" style={{color:'var(--text-muted)'}}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        <line x1="12" y1="11" x2="12" y2="17"/>
        <line x1="9" y1="14" x2="15" y2="14"/>
      </svg>
      <p>No documents yet.<br/>Upload a file above to get started.</p>
    </div>
  );

  const allSelected = docs.every(d => selectedIds.includes(d.id));

  return (
    <div className="doc-library">
      <div className="doc-library-header">
        <span className="doc-count">{docs.length} doc{docs.length !== 1 ? 's' : ''}</span>
        <button className="select-all-btn" onClick={() =>
          docs.forEach(d => { if (allSelected ? selectedIds.includes(d.id) : !selectedIds.includes(d.id)) onToggle(d.id); })
        }>{allSelected ? 'Deselect all' : 'Select all'}</button>
      </div>
      {docs.map(doc => {
        const sel = selectedIds.includes(doc.id);
        return (
          <div key={doc.id} className={`doc-card${sel ? ' selected' : ''}`}
            onClick={() => onToggle(doc.id)} role="checkbox" aria-checked={sel} tabIndex={0}
            onKeyDown={e => e.key === ' ' && onToggle(doc.id)}>
            <span className="doc-icon"><FileIcon type={fileIconType(doc)} /></span>
            <div className="doc-info">
              <span className="doc-title">{doc.title}</span>
              <span className="doc-meta">
                {doc.chunkCount > 0 ? `${doc.chunkCount} sections` : 'Processing…'}
                {doc.file_size ? ` · ${formatBytes(doc.file_size)}` : ''}
                {doc.created_at ? ` · ${formatDate(doc.created_at)}` : ''}
              </span>
            </div>
            <div className="doc-actions">
              <input type="checkbox" checked={sel} onChange={() => onToggle(doc.id)}
                onClick={e => e.stopPropagation()} aria-label={`Select ${doc.title}`} />
              <button className="doc-delete-btn" onClick={e => handleDelete(e, doc.id)} title="Delete document" aria-label="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            </div>
          </div>
        );
      })}
      {selectedIds.length > 0 && (
        <p className="filter-hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" style={{display:'inline',marginRight:4,verticalAlign:'middle'}}>
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Searching {selectedIds.length} selected doc{selectedIds.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

// Backend URL — uses relative path in production (same origin),
// direct localhost in development to bypass Vite proxy buffering for SSE.
const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:3000' : '';

// Build request headers — adds Authorization if user is logged in
function buildHeaders(accessToken, extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (accessToken) h['Authorization'] = `Bearer ${accessToken}`;
  return h;
}

function streamChat(body, accessToken, { onToken, onSources, onDone, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/rag/chat/stream`, {
        method: 'POST',
        headers: buildHeaders(accessToken),
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let doneEventReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'token')   onToken(event.token);
            if (event.type === 'sources') onSources(event.sources, event.metadata);
            if (event.type === 'error')   onError(new Error(event.message));
            if (event.type === 'done') { doneEventReceived = true; onDone(); }
          } catch { /* malformed line */ }
        }

        if (done) break;
      }

      if (!doneEventReceived) onDone();
    } catch (err) {
      if (err.name !== 'AbortError') onError(err);
    }
  })();

  return () => controller.abort();
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── Auth state ──────────────────────────────────────────────────────────
  const [session, setSession]     = useState(null);   // Supabase session
  const [authReady, setAuthReady] = useState(false);  // true once we know auth state
  const [showAuth, setShowAuth]   = useState(false);  // show login modal

  // Fallback anonymous ID — used when not logged in
  const anonId = (() => {
    const key = 'rag_user_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      localStorage.setItem(key, id);
    }
    return id;
  });

  // Resolved identity: auth user ID if logged in, else anonymous UUID
  const userId      = session?.user?.id || anonId();
  const accessToken = session?.access_token || null;
  const userEmail   = session?.user?.email || null;

  // Listen for auth state changes (login, logout, token refresh)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setAuthReady(true);
      if (session) {
        // Logged in — close modal and refresh document list for this user
        setShowAuth(false);
        setSelectedDocIds([]);
        setRefreshTrigger(t => t + 1);
      }
      if (event === 'SIGNED_OUT') {
        // Logged out — clear everything so the next user sees a clean slate
        setSelectedDocIds([]);
        setRefreshTrigger(t => t + 1);
        setMessages([{
          role: 'bot',
          text: "**Welcome to the AI Knowledge Assistant!**\n\nUpload your documents or code files using the panel on the left, then ask me anything about them.\n\nI can summarize, explain, answer questions, and find information from your files.",
          sources: [],
          streaming: false
        }]);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  const [messages, setMessages] = useState([{
    role: 'bot',
    text: "**Welcome to the AI Knowledge Assistant!**\n\nUpload your documents or code files using the panel on the left, then ask me anything about them.\n\nI can summarize, explain, answer questions, and find information from your files.",
    sources: [],
    streaming: false
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('normal');
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);   // holds the stream abort function

  // Auto-scroll — runs on every message update (including streaming tokens)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Clean up stream on unmount
  useEffect(() => () => abortRef.current?.(), []);

  const toggleDoc = useCallback((id) => {
    setSelectedDocIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setInput('');
    setLoading(true);

    // Add user message
    setMessages(prev => [...prev, { role: 'user', text, sources: [] }]);

    // Add empty bot message that will be filled by streaming
    const botMsgIdx = (msgs) => msgs.length; // index of the new bot message
    setMessages(prev => [...prev, { role: 'bot', text: '', sources: [], streaming: true }]);

    const body = {
      message: text,
      sessionId: SESSION_ID,
      // If logged in, backend gets userId from JWT — no need to send it in body.
      // If anonymous, send the localStorage UUID as before.
      ...(accessToken ? {} : { userId }),
      mode,
      ...(selectedDocIds.length > 0 && { documentIds: selectedDocIds })
    };

    abortRef.current = streamChat(body, accessToken, {
      onToken: (token) => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'bot') {
            updated[updated.length - 1] = { ...last, text: last.text + token };
          }
          return updated;
        });
      },
      onSources: (sources) => {
        // Attach sources to the streaming bot message as soon as retrieval completes
        // The user can already start reading sources while the answer streams in
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'bot') {
            updated[updated.length - 1] = { ...last, sources };
          }
          return updated;
        });
      },
      onDone: () => {
        // Mark streaming complete — removes the blinking cursor
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'bot') {
            updated[updated.length - 1] = { ...last, streaming: false };
          }
          return updated;
        });
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      },
      onError: (err) => {
        const msg = err.message?.includes('fetch')
          ? 'Could not reach the server. Make sure the backend is running.'
          : (err.message || 'Something went wrong.');
        setError(msg);
        // Replace the empty streaming message with an error message
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'bot' && last.streaming) {
            updated[updated.length - 1] = {
              ...last,
              text: last.text || 'Sorry, something went wrong. Please try again.',
              streaming: false,
              isError: !last.text
            };
          }
          return updated;
        });
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); }
  };

  const currentMode = MODES.find(m => m.id === mode);

  return (
    <div className="app">
      {/* Auth modal — shown on demand */}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      <div className={`layout${sidebarOpen ? ' sidebar-open' : ''}`}>

        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{display:'inline',verticalAlign:'middle',marginRight:6}}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              My Documents
            </span>
            <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close">✕</button>
          </div>
          <UploadZone onUploadComplete={() => setRefreshTrigger(t => t + 1)} userId={userId} accessToken={accessToken} />
          <DocumentLibrary selectedIds={selectedDocIds} onToggle={toggleDoc} refreshTrigger={refreshTrigger} userId={userId} accessToken={accessToken} />
        </aside>

        {/* ── Chat panel ── */}
        <div className="chat-panel">
          <div className="chat-window">

            <header className="chat-header">
              {!sidebarOpen && (
                <button className="sidebar-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open documents panel">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
              )}
              {/* AI bot icon — SVG instead of emoji */}
              <div className="header-avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
                  <rect x="3" y="8" width="18" height="12" rx="2"/>
                  <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
                  <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/>
                  <circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/>
                  <path d="M9 18h6" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="header-info">
                <span className="header-name">AI Knowledge Assistant</span>
                <span className="header-status">
                  <span className={`status-dot${loading ? ' pulsing' : ''}`} />
                  {loading ? 'Thinking…'
                    : selectedDocIds.length > 0 ? `Searching ${selectedDocIds.length} selected doc${selectedDocIds.length !== 1 ? 's' : ''}`
                    : 'Searching all documents'}
                </span>
              </div>
              {/* Auth controls */}
              <div className="header-auth">
                {session ? (
                  <>
                    <span className="header-user" title={userEmail}>
                      {userEmail?.split('@')[0]}
                    </span>
                    <button className="auth-action-btn" onClick={() => supabase.auth.signOut()} title="Sign out">
                      Sign out
                    </button>
                  </>
                ) : (
                  <button className="auth-action-btn" onClick={() => setShowAuth(true)}>
                    Sign in
                  </button>
                )}
              </div>
            </header>

            <div className="messages-area">
              {messages.map((msg, i) => (
                <div key={i} className={`message-group ${msg.role}`}>
                  <div className="message-row">
                    {msg.role === 'bot' && (
                      <div className="avatar bot-avatar" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14">
                          <rect x="3" y="8" width="18" height="12" rx="2"/>
                          <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
                          <circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none"/>
                          <circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none"/>
                          <path d="M9 18h6" strokeLinecap="round"/>
                        </svg>
                      </div>
                    )}
                    <div className={`bubble ${msg.role}${msg.isError ? ' error' : ''}`}>
                      {msg.role === 'bot'
                        ? <BotMessage text={msg.text} streaming={msg.streaming} />
                        : msg.text
                      }
                    </div>
                    {msg.role === 'user' && <div className="avatar user-avatar">You</div>}
                  </div>
                  {/* Sources appear as soon as retrieval completes, even while answer is still streaming */}
                  {msg.role === 'bot' && msg.sources?.length > 0 && (
                    <div className="source-panel-wrapper">
                      <SourcePanel sources={msg.sources} />
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {error && (
              <div className="error-banner" role="alert">
                ⚠️ {error}
                <button className="dismiss" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
              </div>
            )}

            <div className="input-section">
              <div className="input-toolbar">
                <ModeToggle mode={mode} onChange={setMode} disabled={loading} />
                <span className="mode-hint">{currentMode?.tip}</span>
              </div>
              <form className="input-area" onSubmit={sendMessage}>
                <textarea
                  ref={inputRef}
                  className="message-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question about your documents…"
                  disabled={loading}
                  rows={1}
                  aria-label="Message input"
                />
                <button type="submit" className="send-btn" disabled={loading || !input.trim()} aria-label="Send message">
                  {loading
                    ? <span className="spinner" />
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                  }
                </button>
              </form>
            </div>

          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="app-footer">
        <div className="footer-left">
          AI Knowledge Assistant · Powered by RAG
        </div>
        <div className="footer-right">
          <a className="footer-link" href="#">Help</a>
          <a className="footer-link" href="#">About</a>
        </div>
      </footer>
    </div>
  );
}


