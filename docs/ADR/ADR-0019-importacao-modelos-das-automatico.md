# ADR-0019 — Importação de modelos por arquivo/Drive/URL e DAS automático

- **Status:** Adotada
- **Data:** 06/11/2026 — time C4Arch
- **Relaciona-se com:** ADR-0018 (multi-diagrama no mesmo modelo)

## Contexto

Os modelos existentes só entravam no C4Arch pelo fluxo manual de criar modelo
e depois importar o XML draw.io dentro do editor. Equipes que já mantêm
diagramas no Google Drive, em pastas locais ou em outras URLs precisavam repetir
esse processo arquivo por arquivo, sem visão de lote e sem garantia de que o
tipo C4 seria o correto.

Além disso, o DAS era gerado apenas a partir do tipo primário e dos elementos do
Postgres. Modelos antigos continuavam com um documento incompleto, e adicionar
um novo tipo de diagrama não refletia no DAS. Como o DAS é um artefato derivado
do modelo, manter cópias manuais desatualizadas contraria o objetivo de fonte
única e viva.

## Decisão

1. Criar `POST /api/models/import` para importar **um** modelo por chamada,
   aceitando exatamente uma fonte: `xml` (conteúdo lido no navegador de arquivo
   ou pasta local) ou `url` (Google Drive ou outra fonte).
2. O frontend (`Arquivos → Importar`) oferece as abas **Arquivos**, **Pasta
   local**, **Google Drive** e **Outras URLs**, lê arquivos locais no browser e
   chama a API uma vez por item, exibindo progresso e resultado individual.
   Isso permite lotes de até 100 itens sem que uma falha interrompa os demais.
3. Downloads por URL acontecem no servidor, evitando CORS e permitindo
   validação de conteúdo. A API normaliza links públicos de arquivo do Google
   Drive para `drive.google.com/uc?export=download&id=<id>`, rejeita links de
   pasta do Drive (exigiriam OAuth) e bloqueia hosts internos/loopback, com
   revalidação após redirecionamentos (proteção SSRF). Limite: 100 kB e 15 s.
4. O título é derivado, nesta ordem: título explícito, `<diagram name="...">`
   do XML, nome do arquivo/URL, `Modelo importado`. O tipo C4 é inferido pelo
   nome/título quando o modo automático está ativo; o padrão é `container`.
5. Centralizar a geração do DAS em `c4/das.ts`:
   - `generateDAS` recebe o modelo, elementos/conexões do Postgres, o XML
     primário e todos os `models.diagrams`, extrai shapes/conexões via
     `parseDrawio` e monta inventário + seções por tipo C4.
   - `regenerateModelDAS(modelId)` lê o estado atual do Postgres e grava
     `models.das_content`.
   - `regenerateAllDAS()` percorre todos os modelos no startup da API e aplica
     o formato atual, cobrindo modelos antigos.
6. Disparar a regeneração em criação, atualização, `POST
   /api/models/:id/diagrams`, importação draw.io, importação de modelo e
   primeira leitura de DAS vazio. `models.das_content` passa a ser **derivado**;
   edições manuais não são preservadas.
7. Manter o diagrama primário em `models.c4_type`/`drawio_xml` e os tipos extras
   em `models.diagrams`; a importação preenche apenas o primário.

## Consequências

- + Um ou vários modelos entram no C4Arch em um único fluxo, com resultado por
  item e sem depender de abrir o draw.io.
- + O DAS reflete automaticamente todos os diagramas do modelo, inclusive
  landscape, dinâmico e implantação, e é aplicado retroativamente aos modelos
  existentes.
- + A superfície de rede da importação é restrita a URLs públicas, com limite
  de tamanho e timeout.
- - Importar uma pasta do Google Drive exige OAuth ou sincronização local; o
  fluxo atual aceita somente links públicos de arquivo.
- - `das_content` deixa de ser editável de forma independente: qualquer
  regeneração sobrescreve o conteúdo.
- - O backfill no startup percorre todos os modelos; em bases muito grandes ele
  deve migrar para job assíncrono.
- - Diagramas acima do limite de 5 MB por XML ainda exigem streaming ou
  armazenamento externo.

## Referências

- `apps/api/src/routes/models.routes.ts` (`POST /api/models/import`)
- `apps/api/src/controllers/models.controller.ts` (`importModel`,
  `inferC4Type`)
- `apps/api/src/security/url.ts` (`fetchPublicText`, `normalizeImportUrl`,
  `assertPublicHttpUrl`, `readLimitedBody`)
- `apps/api/src/c4/das.ts` (`generateDAS`, `regenerateModelDAS`,
  `regenerateAllDAS`, `parseDrawio`)
- `apps/api/src/index.ts` (backfill no startup)
- `apps/api/src/controllers/drawio.controller.ts` (regeneração após import)
- `apps/web/src/App.tsx` (modal de importação e disparo em lote)
- `apps/web/src/services/api.ts` (`importModel`)
- `docs/PRD.md` (RF-23 e RF-24)
- `docs/SECURITY.md` (controles da importação por URL)
