/**
 * Sanitização defensiva de SVG recebido de um renderizador externo.
 *
 * O proxy PlantUML devolve o SVG do servidor configurado. Como o usuário
 * controla o conteúdo do diagrama (e o servidor pode ser comprometido), o SVG
 * é tratado como não confiável: removemos scripts, conteúdo HTML embutido e
 * URLs ativas. A sanitização é uma camada extra — a resposta também recebe
 * CSP `sandbox` e `Content-Disposition: attachment` para navegação direta.
 *
 * As expressões abaixo removem apenas as tags (não o conteúdo entre elas).
 * Isso mantém o custo linear mesmo para entradas hostis: um regex de par
 * `<script>...</script>` com backtracking poderia ser O(n²) num SVG grande.
 */

const DANGEROUS_TAG =
  /<\s*\/?\s*(?:script|foreignObject|iframe|object|embed|handler|listener|set|animate|animateMotion|animateTransform)\b[^>]*>/gi;

const EVENT_HANDLERS = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const ACTIVE_URL_ATTRIBUTE =
  /(\b(?:href|xlink:href|src|action|formaction)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

const DECLARATION = /<![^>]*>/g;

function isActiveUrl(value: string): boolean {
  return /^\s*(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value);
}

export function sanitizeSvg(svg: string): string {
  // Declarações (DOCTYPE/ENTITY) não são necessárias e habilitam XXE.
  let output = svg.replace(DECLARATION, '');
  output = output.replace(DANGEROUS_TAG, '');
  output = output.replace(EVENT_HANDLERS, '');
  output = output.replace(
    ACTIVE_URL_ATTRIBUTE,
    (match, prefix: string, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
      const value = doubleQuoted ?? singleQuoted ?? bare ?? '';
      return isActiveUrl(value) ? '' : match;
    }
  );
  return output;
}
