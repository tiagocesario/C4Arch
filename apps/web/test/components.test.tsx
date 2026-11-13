import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { setupDom } from './setup-dom';

// O `tsx` compila o arquivo de teste com o runtime clássico; expor `React`
// mantém o JSX funcionando sem depender da configuração do tsconfig.
(globalThis as Record<string, unknown>).React = React;

const dom = setupDom();

const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
const { AppHeader } = await import('../src/components/AppHeader');
const { LoginScreen } = await import('../src/components/LoginScreen');
const { VersionsPanel } = await import('../src/components/VersionsPanel');
const { InspectionsPanel } = await import('../src/components/InspectionsPanel');
const { ImportModelsPanel } = await import('../src/components/ImportModelsPanel');
const { DasEditor } = await import('../src/components/DasEditor');
const { PresenceBar } = await import('../src/components/PresenceBar');
const { StructurizrImportPanel } = await import('../src/components/StructurizrImportPanel');
type ModelVersion = import('../src/services/api').ModelVersion;
type InspectionReport = import('../src/services/api').InspectionReport;
type PresenceUser = import('../src/services/ws').PresenceUser;
type ImportResult = import('../src/components/ImportModelsPanel').ImportResult;
type DasEditorSection = import('../src/components/DasEditor').DasEditorSection;
type StructurizrTemplate = import('../src/services/collaboration').StructurizrTemplate;

afterEach(() => cleanup());

const version: ModelVersion = {
  id: 'ver-1',
  model_id: 'model-1',
  version: 1,
  content_hash: 'abcdef0123456789abcdef',
  label: 'Baseline',
  description: null,
  kind: 'auto',
  author_id: null,
  author_email: null,
  created_at: '2026-01-02T03:04:05.000Z',
  size_bytes: 128,
};

const report: InspectionReport = {
  modelId: 'model-1',
  totalIssues: 3,
  bySeverity: { error: 1, warning: 1, info: 1 },
  issues: [
    { code: 'C4-ELEMENT-ORPHAN', severity: 'error', message: 'Elemento sem relação.' },
    { code: 'C4-VIEW-EMPTY', severity: 'warning', message: 'View sem elementos.' },
    { code: 'C4-DAS-EMPTY', severity: 'info', message: 'Seção do DAS vazia.' },
  ],
};

const sections: DasEditorSection[] = [
  {
    key: 'preamble',
    label: 'Informações do documento',
    description: 'Metadados iniciais.',
    body: '# Documento',
  },
  {
    key: 'section-6.1',
    label: '6.1 Elementos',
    description: 'Conteúdo dos elementos.',
    body: 'Texto da seção',
  },
];

test('AppHeader mostra identidade, papel e ação de logout', () => {
  let loggedOut = false;
  render(
    <AppHeader
      loggedIn
      role="editor"
      email="ana@example.com"
      onLogout={() => {
        loggedOut = true;
      }}
    />
  );

  assert.ok(screen.getByText('C4Arch'));
  assert.ok(screen.getByText('ana@example.com · Editor'));
  fireEvent.click(screen.getByText('Sair'));
  assert.equal(loggedOut, true);
});

test('AppHeader esconde sessão quando não autenticado', () => {
  render(<AppHeader loggedIn={false} role={null} email={null} onLogout={() => {}} />);
  assert.equal(screen.queryByText('Sair'), null);
});

test('LoginScreen propaga email, senha e submit', () => {
  let submitted = 0;
  let email = '';
  let password = '';
  render(
    <LoginScreen
      email="admin@example.com"
      password=""
      error="Credenciais inválidas"
      onEmailChange={(value) => {
        email = value;
      }}
      onPasswordChange={(value) => {
        password = value;
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submitted += 1;
      }}
    />
  );

  fireEvent.change(screen.getByPlaceholderText('Email'), {
    target: { value: 'novo@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'segredo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

  assert.equal(email, 'novo@example.com');
  assert.equal(password, 'segredo');
  assert.equal(submitted, 1);
  assert.ok(screen.getByText('Credenciais inválidas'));
  assert.ok(screen.getByText('Entrar com Google'));
});

test('VersionsPanel lista versões, restaura e fecha', () => {
  let restored: ModelVersion | null = null;
  let closed = false;
  render(
    <VersionsPanel
      versions={[version]}
      loading={false}
      canRestore
      onClose={() => {
        closed = true;
      }}
      onRestore={(item) => {
        restored = item;
      }}
    />
  );

  assert.ok(screen.getByText('Versões do modelo'));
  assert.ok(screen.getByText('v1 — auto'));
  assert.ok(screen.getByText(/Baseline/));
  fireEvent.click(screen.getByText('Restaurar'));
  assert.equal(restored?.id, 'ver-1');
  fireEvent.click(screen.getByText('Fechar'));
  assert.equal(closed, true);
});

test('VersionsPanel respeita permissão de restauração e estado vazio', () => {
  render(
    <VersionsPanel
      versions={[]}
      loading={false}
      canRestore={false}
      onClose={() => {}}
      onRestore={() => {}}
    />
  );
  assert.ok(screen.getByText('Nenhuma versão encontrada.'));
  assert.equal(screen.queryByText('Restaurar'), null);
});

test('InspectionsPanel mostra totais e issues por severidade', () => {
  render(<InspectionsPanel report={report} loading={false} onClose={() => {}} />);
  assert.ok(screen.getByText(/Total de problemas: 3/));
  assert.ok(screen.getByText(/C4-ELEMENT-ORPHAN/));
  assert.ok(screen.getByText('Elemento sem relação.'));
  assert.ok(screen.getByText(/C4-DAS-EMPTY/));
});

test('ImportModelsPanel troca de fonte, lista pastas e dispara importação', () => {
  let source = 'files';
  let files: File[] = [];
  let submitted = 0;
  const results: ImportResult[] = [{ name: 'a.drawio', ok: false, error: 'XML inválido' }];

  render(
    <ImportModelsPanel
      source="files"
      files={[]}
      links=""
      folderId={null}
      type="auto"
      folderOptions={[
        { id: 'f1', name: 'Arquitetura', depth: 0 },
        { id: 'f2', name: 'Detalhes', depth: 1 },
      ]}
      importing={false}
      progress="Importando 1 de 2"
      results={results}
      error="Falha parcial"
      onSourceChange={(next) => {
        source = next;
      }}
      onFilesChange={(next) => {
        files = next;
      }}
      onLinksChange={() => {}}
      onFolderChange={() => {}}
      onTypeChange={() => {}}
      onClose={() => {}}
      onSubmit={() => {
        submitted += 1;
      }}
    />
  );

  assert.ok(screen.getByText('Importar modelos'));
  assert.ok(screen.getByText(/Importando 1 de 2/));
  assert.ok(screen.getByText(/a\.drawio — XML inválido/));
  assert.ok(screen.getByText('Falha parcial'));
  assert.ok(screen.getByText('Arquitetura'));

  fireEvent.click(screen.getByText('Outras URLs'));
  assert.equal(source, 'urls');

  const file = new dom.window.File(['<mxfile/>'], 'modelo.drawio', {
    type: 'application/xml',
  });
  fireEvent.change(dom.window.document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'modelo.drawio');

  fireEvent.click(screen.getByText('Importar'));
  assert.equal(submitted, 1);
});

test('DasEditor navega por seções, edita, salva e descarta', () => {
  let selected = -1;
  let edited = '';
  let saved = 0;
  let discarded = 0;
  let viewMode = '';
  render(
    <DasEditor
      modelTitle="Pagamentos"
      content={'# Documento\n\n## 6.1 Elementos\n\nTexto da seção'}
      viewMode="edit"
      loading={false}
      saving={false}
      dirty
      sections={sections}
      emptySections={0}
      activeIndex={0}
      previewUrl={null}
      onClose={() => {}}
      onSave={() => {
        saved += 1;
      }}
      onRegenerate={() => {}}
      onDiscard={() => {
        discarded += 1;
      }}
      onSelectSection={(index) => {
        selected = index;
      }}
      onEditSection={(value) => {
        edited = value;
      }}
      onViewModeChange={(mode) => {
        viewMode = mode;
      }}
    />
  );

  assert.ok(screen.getByText(/DAS — Pagamentos/));
  assert.ok(screen.getByText('6.1 Elementos'));
  assert.ok(screen.getAllByText('Alterações não salvas').length > 0);

  fireEvent.click(screen.getByText('6.1 Elementos'));
  assert.equal(selected, 1);

  const textarea = screen.getByPlaceholderText(/Descreva informações do documento/);
  fireEvent.change(textarea, { target: { value: 'Novo conteúdo' } });
  assert.equal(edited, 'Novo conteúdo');

  fireEvent.click(screen.getByText('Salvar DAS'));
  assert.equal(saved, 1);

  fireEvent.click(screen.getByText('Descartar alterações'));
  assert.equal(discarded, 1);

  fireEvent.click(screen.getByText('Visualizar'));
  assert.equal(viewMode, 'preview');
});

test('PresenceBar alterna entre vazio e lista de usuários', () => {
  const users: PresenceUser[] = [
    { clientId: 'c1', name: 'Ana', color: '#f00', viewKey: 'container' },
    { clientId: 'c2', name: 'Bruno', color: '#0f0' },
  ];

  const { rerender } = render(<PresenceBar users={[]} />);
  assert.ok(screen.getByText('Sem outros usuários online'));

  rerender(<PresenceBar users={users} currentClientLabel="view:container" />);
  assert.ok(screen.getByText('2 online · view:container'));
  assert.ok(screen.getByText('Ana'));
  assert.ok(screen.getByText('Bruno'));
});

test('StructurizrImportPanel preenche o workspace a partir de um padrão', () => {
  const templates: StructurizrTemplate[] = [
    {
      id: 'containers',
      name: 'Sistema e containers',
      description: 'Aplicação web, API e banco.',
      c4Type: 'container',
      format: 'dsl',
      content: 'workspace "Sistema e containers" {\n  model {\n  }\n}',
    },
  ];

  render(
    <StructurizrImportPanel
      modelId={null}
      orgId="org-1"
      templates={templates}
      onClose={() => {}}
      onImported={() => {}}
    />
  );

  assert.ok(screen.getByText('Novo modelo a partir do Structurizr'));
  const select = screen.getByLabelText('Padrão Structurizr') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'containers' } });

  const workspace = screen.getByLabelText('Workspace Structurizr') as HTMLTextAreaElement;
  assert.match(workspace.value, /Sistema e containers/);
  assert.equal((screen.getByLabelText('Título') as HTMLInputElement).value, 'Sistema e containers');
  assert.equal((screen.getByLabelText('Tipo C4') as HTMLSelectElement).value, 'container');
  assert.ok(screen.getByText('Aplicação web, API e banco.'));
});
