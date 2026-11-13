import type { UserRole } from '../types/user';

interface AppHeaderProps {
  loggedIn: boolean;
  role: UserRole | null;
  email: string | null | undefined;
  onLogout: () => void;
}

const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
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

const smallMuted = { fontSize: 12, color: '#7b8290' };

/** Cabeçalho fixo da aplicação, com identidade e sessão do usuário. */
export function AppHeader({ loggedIn, role, email, onLogout }: AppHeaderProps) {
  return (
    <header
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid #2a2f3a',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
      }}
    >
      <h1 style={{ margin: 0, fontWeight: 600 }}>C4Arch</h1>
      <span style={{ ...smallMuted, marginLeft: 'auto' }}>React Flow + Yjs · Docker</span>
      {loggedIn && role && (
        <span
          title="Perfil na organização (definido em memberships)"
          style={{
            ...smallMuted,
            color: '#c7d2fe',
            border: '1px solid #2a2f3a',
            borderRadius: 999,
            padding: '3px 9px',
          }}
        >
          {email} · {ROLE_LABEL[role]}
        </span>
      )}
      {loggedIn && (
        <button onClick={onLogout} style={buttonStyle}>
          Sair
        </button>
      )}
    </header>
  );
}
