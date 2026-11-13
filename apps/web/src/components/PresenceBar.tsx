import type { PresenceUser } from '../services/ws';

interface PresenceBarProps {
  users: PresenceUser[];
  currentClientLabel?: string;
}

/** Lista compacta de quem está na mesma view/sala. */
export function PresenceBar({ users, currentClientLabel }: PresenceBarProps) {
  if (users.length === 0) {
    return <span style={{ fontSize: 12, color: '#7b8290' }}>Sem outros usuários online</span>;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#9ca3af' }}>
        {users.length} online{currentClientLabel ? ` · ${currentClientLabel}` : ''}
      </span>
      {users.map((user) => (
        <span
          key={user.clientId}
          title={user.viewKey ? `View: ${user.viewKey}` : user.name}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 999,
            background: '#1f2937',
            border: `1px solid ${user.color}`,
            fontSize: 12,
            color: '#e5e7eb',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: user.color,
              display: 'inline-block',
            }}
          />
          {user.name}
        </span>
      ))}
    </div>
  );
}
