import { JSDOM } from 'jsdom';

/**
 * Instala um DOM mínimo (jsdom) no `globalThis` para testar componentes React
 * com o test runner nativo do Node. Deve ser chamado antes de importar
 * `@testing-library/react` e os componentes.
 */
export function setupDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  const define = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  };

  define('window', dom.window);
  define('document', dom.window.document);
  define('navigator', dom.window.navigator);
  define('HTMLElement', dom.window.HTMLElement);
  define('HTMLInputElement', dom.window.HTMLInputElement);
  define('HTMLTextAreaElement', dom.window.HTMLTextAreaElement);
  define('HTMLSelectElement', dom.window.HTMLSelectElement);
  define('Node', dom.window.Node);
  define('Event', dom.window.Event);
  define('MouseEvent', dom.window.MouseEvent);
  define('KeyboardEvent', dom.window.KeyboardEvent);
  define('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  define('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0)
  );
  define('cancelAnimationFrame', (id: number) => clearTimeout(id));
  // Necessário para o React 18 reconhecer o ambiente de teste e aplicar `act`.
  define('IS_REACT_ACT_ENVIRONMENT', true);

  return dom;
}
