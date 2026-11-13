import type { ChangeEvent, FormEvent } from 'react';

interface LoginScreenProps {
  email: string;
  password: string;
  error: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

const inputStyle = {
  padding: '8px',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
  background: '#1a1d27',
  color: '#e8eaed',
};

const buttonStyle = {
  padding: '6px 10px',
  background: '#2a2f3a',
  color: '#e8eaed',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};

/** Tela de login (email/senha + Google) com o painel ilustrado do C4. */
export function LoginScreen({
  email,
  password,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: LoginScreenProps) {
  const googleLogin = () => {
    window.location.href =
      (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api/auth/google';
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px',
          background: 'linear-gradient(135deg, #0f1115 0%, #1a1d27 100%)',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <svg viewBox="0 0 320 200" width="100%" height="auto" style={{ marginBottom: 16 }}>
            <rect x="20" y="20" width="80" height="40" rx="6" fill="#438DD5" stroke="#3C7FC0" />
            <text x="60" y="45" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="system-ui">
              System
            </text>
            <rect x="120" y="20" width="80" height="40" rx="6" fill="#85BBF0" stroke="#3C7FC0" />
            <text x="160" y="45" textAnchor="middle" fill="#1f2937" fontSize="11" fontFamily="system-ui">
              Container
            </text>
            <rect x="220" y="20" width="80" height="40" rx="6" fill="#b4d9f7" stroke="#3C7FC0" />
            <text x="260" y="45" textAnchor="middle" fill="#1f2937" fontSize="11" fontFamily="system-ui">
              Component
            </text>
            <circle cx="60" cy="130" r="18" fill="#238636" />
            <text x="60" y="135" textAnchor="middle" fill="#fff" fontSize="10" fontFamily="system-ui">
              Actor
            </text>
            <line x1="60" y1="60" x2="60" y2="112" stroke="#7b8290" strokeWidth="1.5" markerEnd="url(#arrow)" />
            <line x1="100" y1="40" x2="120" y2="40" stroke="#7b8290" strokeWidth="1.5" />
            <line x1="200" y1="40" x2="220" y2="40" stroke="#7b8290" strokeWidth="1.5" />
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="#7b8290" />
              </marker>
            </defs>
          </svg>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>C4Arch</h2>
          <p style={{ margin: 0, color: '#7b8290', fontSize: 14 }}>
            Modele arquitetura C4 viva em equipe, com persistência e edição em tempo real.
          </p>
        </div>
      </div>
      <div
        style={{
          width: 360,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px',
          borderLeft: '1px solid #2a2f3a',
          background: '#1a1d27',
        }}
      >
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Entrar</h3>
          <input
            value={email}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onEmailChange(event.target.value)}
            placeholder="Email"
            style={inputStyle}
          />
          <input
            type="password"
            value={password}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onPasswordChange(event.target.value)}
            placeholder="Senha"
            style={inputStyle}
          />
          {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
          <button type="submit" style={{ ...buttonStyle, background: '#3b82f6', color: '#fff' }}>
            Entrar
          </button>
          <button type="button" onClick={googleLogin} style={{ ...buttonStyle, background: '#fff', color: '#1f2937' }}>
            Entrar com Google
          </button>
        </form>
      </div>
    </div>
  );
}
