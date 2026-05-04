import { useNavigate } from 'react-router-dom';
import './Landing.css';

// ── Reusable SVG icons ────────────────────────────────────────────────────────
const Icon = {
  upload: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  message: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  file: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  source: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  ),
};

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, description }) {
  return (
    <div className="feature-card">
      <div className="feature-icon">{icon}</div>
      <h3 className="feature-title">{title}</h3>
      <p className="feature-desc">{description}</p>
    </div>
  );
}

// ── Step card ─────────────────────────────────────────────────────────────────
function StepCard({ number, icon, title, description }) {
  return (
    <div className="step-card">
      <div className="step-number">{number}</div>
      <div className="step-icon">{icon}</div>
      <h3 className="step-title">{title}</h3>
      <p className="step-desc">{description}</p>
    </div>
  );
}

// ── Main Landing Page ─────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing">

      {/* ── Navbar ── */}
      <nav className="nav">
        <div className="nav-inner">
          <div className="nav-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="26" height="26" className="nav-logo-icon">
              <rect x="3" y="8" width="18" height="12" rx="2"/>
              <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
              <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/>
              <path d="M9 18h6" strokeLinecap="round"/>
            </svg>
            <span className="nav-brand">DocChat</span>
          </div>
          <div className="nav-links">
            <a href="#features" className="nav-link">Features</a>
            <a href="#how-it-works" className="nav-link">How it works</a>
            <a href="#pricing" className="nav-link">Pricing</a>
            <a href="https://github.com/Qaziaaaa/RAG-chatbot" target="_blank" rel="noopener noreferrer" className="nav-link nav-github">
              {Icon.github}
              GitHub
            </a>
          </div>
          <button className="nav-cta" onClick={() => navigate('/app')}>
            Get Started Free
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="hero">
        {/* Background glow orbs */}
        <div className="hero-orb hero-orb-1" aria-hidden="true"/>
        <div className="hero-orb hero-orb-2" aria-hidden="true"/>

        <div className="hero-inner">
          <div className="hero-badge">
            <span className="hero-badge-dot"/>
            AI-Powered Document Assistant
          </div>

          <h1 className="hero-title">
            Chat with your<br/>
            <span className="hero-title-accent">documents</span> using AI
          </h1>

          <p className="hero-subtitle">
            Upload any file — PDF, code, markdown, JSON. Ask questions in plain English.
            Get accurate answers with source citations, powered by semantic search.
          </p>

          <div className="hero-actions">
            <button className="btn-primary" onClick={() => navigate('/app')}>
              Start for free
              {Icon.arrow}
            </button>
            <a href="#how-it-works" className="btn-secondary">
              See how it works
            </a>
          </div>

          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-value">768-dim</span>
              <span className="hero-stat-label">Embeddings</span>
            </div>
            <div className="hero-stat-divider"/>
            <div className="hero-stat">
              <span className="hero-stat-value">&lt; 2s</span>
              <span className="hero-stat-label">First token</span>
            </div>
            <div className="hero-stat-divider"/>
            <div className="hero-stat">
              <span className="hero-stat-value">10+ formats</span>
              <span className="hero-stat-label">Supported</span>
            </div>
          </div>
        </div>

        {/* Hero visual — mock chat window */}
        <div className="hero-visual" aria-hidden="true">
          <div className="mock-window">
            <div className="mock-titlebar">
              <div className="mock-dot mock-dot-red"/>
              <div className="mock-dot mock-dot-yellow"/>
              <div className="mock-dot mock-dot-green"/>
              <span className="mock-title">DocChat</span>
            </div>
            <div className="mock-body">
              <div className="mock-msg mock-msg-user">
                What is the refund policy?
              </div>
              <div className="mock-msg mock-msg-bot">
                Full refunds are available within <strong>14 days</strong> of purchase. After that, no refunds are provided. [Source 1]
                <div className="mock-source">
                  <span className="mock-source-dot"/>
                  Refund Policy FAQ · 92% match
                </div>
              </div>
              <div className="mock-msg mock-msg-user">
                What about enterprise customers?
              </div>
              <div className="mock-msg mock-msg-bot mock-msg-streaming">
                Enterprise customers may have different terms per contract…
                <span className="mock-cursor"/>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="section" id="how-it-works">
        <div className="section-inner">
          <div className="section-label">Simple process</div>
          <h2 className="section-title">How DocChat works</h2>
          <p className="section-subtitle">
            Three steps from upload to answer. No setup, no configuration.
          </p>

          <div className="steps-grid">
            <StepCard
              number="01"
              icon={Icon.upload}
              title="Upload your files"
              description="Drag and drop any PDF, text file, markdown, JSON, or code file. Up to 10 MB per file."
            />
            <div className="step-arrow" aria-hidden="true">{Icon.arrow}</div>
            <StepCard
              number="02"
              icon={Icon.search}
              title="AI finds the answer"
              description="DocChat converts your question into a vector, searches your documents semantically, and retrieves the most relevant sections."
            />
            <div className="step-arrow" aria-hidden="true">{Icon.arrow}</div>
            <StepCard
              number="03"
              icon={Icon.message}
              title="Get a cited answer"
              description="The AI generates a clear answer based only on your documents, with source citations so you can verify every claim."
            />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="section section-alt" id="features">
        <div className="section-inner">
          <div className="section-label">Everything you need</div>
          <h2 className="section-title">Built for real work</h2>
          <p className="section-subtitle">
            Not just a demo — DocChat is production-ready with the features that matter.
          </p>

          <div className="features-grid">
            <FeatureCard
              icon={Icon.file}
              title="10+ file formats"
              description="PDF, TXT, MD, JSON, CSV, and all major code files — JS, TS, Python, Go, Rust, Java, and more."
            />
            <FeatureCard
              icon={Icon.source}
              title="Source attribution"
              description="Every answer shows exactly which document it came from and how relevant that source was."
            />
            <FeatureCard
              icon={Icon.zap}
              title="Streaming responses"
              description="Answers appear word-by-word as they're generated — no waiting for the full response."
            />
            <FeatureCard
              icon={Icon.shield}
              title="Your data, isolated"
              description="Each user's documents are private. Sign in with email to access your files from any device."
            />
            <FeatureCard
              icon={Icon.users}
              title="Three answer modes"
              description="Normal for balanced answers, Simple for plain language, Detailed for in-depth explanations."
            />
            <FeatureCard
              icon={Icon.message}
              title="Conversation memory"
              description="DocChat remembers the last few messages so you can ask follow-up questions naturally."
            />
          </div>
        </div>
      </section>

      {/* ── Supported formats ── */}
      <section className="section">
        <div className="section-inner">
          <div className="section-label">File support</div>
          <h2 className="section-title">Works with your files</h2>
          <div className="formats-grid">
            {[
              { label: 'PDF', color: '#f87171' },
              { label: 'TXT', color: '#94a3b8' },
              { label: 'Markdown', color: '#a78bfa' },
              { label: 'JSON', color: '#fbbf24' },
              { label: 'CSV', color: '#34d399' },
              { label: 'JavaScript', color: '#fbbf24' },
              { label: 'TypeScript', color: '#60a5fa' },
              { label: 'Python', color: '#34d399' },
              { label: 'Go', color: '#22d3ee' },
              { label: 'Rust', color: '#fb923c' },
              { label: 'Java', color: '#f87171' },
              { label: 'C / C++', color: '#94a3b8' },
            ].map(f => (
              <div key={f.label} className="format-chip" style={{'--chip-color': f.color}}>
                {f.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="section section-alt" id="pricing">
        <div className="section-inner">
          <div className="section-label">Pricing</div>
          <h2 className="section-title">Free to use</h2>
          <p className="section-subtitle">
            DocChat runs on free-tier APIs. No credit card required.
          </p>

          <div className="pricing-card">
            <div className="pricing-badge">Free forever</div>
            <div className="pricing-amount">
              <span className="pricing-currency">$</span>
              <span className="pricing-number">0</span>
              <span className="pricing-period">/ month</span>
            </div>
            <ul className="pricing-features">
              {[
                'Unlimited questions',
                'Up to 10 MB per file',
                'PDF, code, and text files',
                'Streaming responses',
                'Source attribution',
                'Conversation memory',
                'Email account to save documents',
              ].map(f => (
                <li key={f} className="pricing-feature">
                  <span className="pricing-check">{Icon.check}</span>
                  {f}
                </li>
              ))}
            </ul>
            <button className="btn-primary pricing-btn" onClick={() => navigate('/app')}>
              Get started free
              {Icon.arrow}
            </button>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="cta-section">
        <div className="cta-orb" aria-hidden="true"/>
        <div className="cta-inner">
          <h2 className="cta-title">Ready to chat with your documents?</h2>
          <p className="cta-subtitle">
            Upload your first file and get an answer in under 30 seconds.
          </p>
          <button className="btn-primary cta-btn" onClick={() => navigate('/app')}>
            Start for free — no signup required
            {Icon.arrow}
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="footer-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20" style={{color:'var(--cyan)'}}>
              <rect x="3" y="8" width="18" height="12" rx="2"/>
              <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
              <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/>
              <path d="M9 18h6" strokeLinecap="round"/>
            </svg>
            <span>DocChat</span>
          </div>
          <p className="footer-copy">
            Built with Groq, Supabase, and Jina AI · Open source on{' '}
            <a href="https://github.com/Qaziaaaa/RAG-chatbot" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </p>
          <div className="footer-links">
            <a href="https://github.com/Qaziaaaa/RAG-chatbot" target="_blank" rel="noopener noreferrer">GitHub</a>
            <button onClick={() => navigate('/app')}>Open App</button>
          </div>
        </div>
      </footer>

    </div>
  );
}
