/**
 * Utilitários de texto compartilhados pela UI: busca sem acento, nomes de
 * arquivo e extração de nome de URL de importação.
 */

// Normaliza texto para busca: minúsculas e sem acentos, para que "servico"
// encontre "Serviço" enquanto o usuário digita.
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function stripFileExtension(value: string): string {
  return value
    .replace(/(\.drawio)?\.xml$/i, '')
    .replace(/\.drawio$/i, '')
    .trim();
}

export function nameFromImportUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const fromPath = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
    if (fromPath && fromPath !== 'view' && fromPath !== 'edit') {
      return stripFileExtension(fromPath);
    }
    const driveId = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? url.searchParams.get('id');
    return driveId ? `Modelo importado ${driveId.slice(0, 8)}` : 'Modelo importado';
  } catch {
    return 'Modelo importado';
  }
}
