import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSvg } from '../src/security/svg.js';

test('sanitizeSvg remove scripts, handlers e URLs ativas', () => {
  const dirty = [
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
    '<script>alert(2)</script>',
    '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject>',
    '<a href="javascript:alert(3)"><text>link</text></a>',
    '<image xlink:href="data:text/html;base64,PHNjcmlwdD4=" />',
    '<rect width="10" height="10" fill="#fff" onclick="alert(4)" />',
    '</svg>',
  ].join('');

  const clean = sanitizeSvg(dirty);

  assert.equal(/<script/i.test(clean), false);
  assert.equal(/foreignObject/i.test(clean), false);
  assert.equal(/onload|onclick/i.test(clean), false);
  assert.equal(/javascript:/i.test(clean), false);
  assert.equal(/data:text\/html/i.test(clean), false);
  assert.equal(clean.includes('<rect width="10" height="10" fill="#fff" />'), true);
  assert.equal(clean.startsWith('<svg'), true);
});

test('sanitizeSvg preserva SVG legítimo do PlantUML', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">' +
    '<style>.a{fill:#438DD5}</style>' +
    '<rect class="a" x="0" y="0" width="100" height="50"/>' +
    '<text x="10" y="20" fill="#fff">Sistema</text>' +
    '</svg>';

  assert.equal(sanitizeSvg(svg), svg);
});

test('sanitizeSvg remove DOCTYPE e ENTITY (evita XXE)', () => {
  const svg =
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
    '<svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>';

  const clean = sanitizeSvg(svg);
  assert.equal(/DOCTYPE|ENTITY/i.test(clean), false);
  assert.equal(clean.includes('<svg'), true);
});
