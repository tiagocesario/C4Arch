import type { InspectionReport } from '../services/api';

interface InspectionsPanelProps {
  report: InspectionReport | null;
  loading: boolean;
  onClose: () => void;
}

const buttonStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
  background: '#1f2937',
  color: '#e8eaed',
  cursor: 'pointer',
  fontSize: 13,
};

const severityColor = (severity: string): string =>
  severity === 'error' ? '#f87171' : severity === 'warning' ? '#fbbf24' : '#93c5fd';

/** Relatório de inspections/“saúde da arquitetura”. */
export function InspectionsPanel({ report, loading, onClose }: InspectionsPanelProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1a1d24',
          border: '1px solid #2a2f3a',
          borderRadius: 8,
          padding: 16,
          width: 'min(640px, 90vw)',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>Inspeções de arquitetura</h3>
        {loading && <p>Carregando...</p>}
        {!loading && report && (
          <>
            <p>
              Total de problemas: {report.totalIssues} (erros: {report.bySeverity.error}, avisos:{' '}
              {report.bySeverity.warning}, info: {report.bySeverity.info})
            </p>
            {report.issues.length === 0 && <p>Nenhum problema encontrado.</p>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {report.issues.map((issue, index) => (
                <li key={index} style={{ borderBottom: '1px solid #2a2f3a', padding: '6px 0' }}>
                  <span style={{ fontWeight: 600, color: severityColor(issue.severity) }}>
                    [{issue.severity}] {issue.code}
                  </span>
                  <div style={{ fontSize: 13 }}>{issue.message}</div>
                </li>
              ))}
            </ul>
          </>
        )}
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button onClick={onClose} style={buttonStyle}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
