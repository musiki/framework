import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitBibtexEntries, renderBibtexBlock, accentBibliographyAuthors, BibtexRenderError } from './apa-refs.mjs';

const WASON = `@article{Wason1960,
  author  = {Wason, Peter C.},
  title   = {On the Failure to Eliminate Hypotheses in a Conceptual Task},
  journal = {Quarterly Journal of Experimental Psychology},
  volume  = {12}, number = {3}, year = {1960}, pages = {129--140},
  doi     = {10.1080/17470216008416717}
}`;
const SCHAEFFER = `@book{Schaeffer1966, author={Schaeffer, Pierre and Reibel, Guy}, title={Trait{\\'e} des objets {musicaux}}, publisher={Seuil}, year={1966}}`;

describe('splitBibtexEntries', () => {
  test('respeta llaves anidadas y separa entradas', () => {
    const entries = splitBibtexEntries(`${SCHAEFFER}\n\n% comentario\n${WASON}`);
    assert.deepEqual(entries.map((e) => e.key), ['Schaeffer1966', 'Wason1960']);
    assert.ok(entries[0].raw.endsWith('year={1966}}'));
  });
  test('ignora @comment y @string', () => {
    assert.deepEqual(splitBibtexEntries('@comment{x}\n@string{a = "b"}\n' + WASON).map((e) => e.key), ['Wason1960']);
  });
});

describe('renderBibtexBlock', () => {
  test('una entrada: autores en negrita, revista en cursiva, DOI como link, sin botones globales', () => {
    const html = renderBibtexBlock(WASON);
    assert.match(html, /<span class="csl-author">Wason, P\. C\.<\/span> \(1960\)/);
    assert.match(html, /<i>Quarterly Journal of Experimental Psychology<\/i>/);
    assert.match(html, /<a href="https:\/\/doi\.org\/10\.1080\/17470216008416717"/);
    assert.equal((html.match(/data-bib-copy=/g) || []).length, 2);
    assert.doesNotMatch(html, /bib-refs-toolbar/);
  });
  test('libro: el título va en cursiva y los acentos LaTeX se resuelven', () => {
    assert.match(renderBibtexBlock(SCHAEFFER), /<i>Traité des objets musicaux<\/i>/);
  });
  test('varias entradas: botones globales y el BibTeX crudo de cada una', () => {
    const html = renderBibtexBlock(`${WASON}\n${SCHAEFFER}`);
    assert.match(html, /bib-refs-toolbar/);
    assert.match(html, /data-bib-copy="apa-all"/);
    assert.match(html, /data-bib-key="Wason1960" data-bibtex="@article\{Wason1960,/);
  });
  test('un bloque sin entradas no se toca', () => {
    assert.equal(renderBibtexBlock('% nada'), null);
  });
});

test('accentBibliographyAuthors cubre fechas con mes y s. f.', () => {
  assert.match(accentBibliographyAuthors('<div class="csl-entry">Doe, J. (2020, marzo 3). X</div>'), /csl-author">Doe, J\.<\/span>/);
  assert.match(accentBibliographyAuthors('<div class="csl-entry">Doe, J. (s. f.). X</div>'), /csl-author">Doe, J\.<\/span>/);
});

test('BibtexRenderError existe para que el plugin deje el bloque crudo', () => {
  assert.equal(typeof BibtexRenderError, 'function');
});
