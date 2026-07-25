import test from 'node:test';
import assert from 'node:assert/strict';
import { LATEX_TEMPLATES, UNTREF_LOGO_URL, markdownToLatex } from './markdown-latex-export.ts';

test('markdownToLatex converts headings, emphasis and links', () => {
  const tex = markdownToLatex('# Título\n\nTexto con **peso**, *gesto* y [link](https://example.com?a=1).', 'Mi nota');
  assert.match(tex, /\\title\{Mi nota\}/);
  assert.match(tex, /\\section\{Título\}/);
  assert.match(tex, /\\textbf\{peso\}/);
  assert.match(tex, /\\emph\{gesto\}/);
  assert.match(tex, /\\href\{https:\/\/example\.com\?a=1\}\{link\}/);
});

test('markdownToLatex converts lists and escapes LaTeX specials', () => {
  const tex = markdownToLatex('- A & B\n- 50% #1\n\n1. alpha_beta', 'Lista');
  assert.match(tex, /\\begin\{itemize\}/);
  assert.match(tex, /\\item A \\& B/);
  assert.match(tex, /\\item 50\\% \\#1/);
  assert.match(tex, /\\begin\{enumerate\}/);
  assert.match(tex, /\\item alpha\\_beta/);
});

test('markdownToLatex strips frontmatter and preserves code fences as verbatim', () => {
  const tex = markdownToLatex('---\ntitle: Demo\n---\n\n```js\nconst x = 1 & 2;\n```', 'Demo');
  assert.doesNotMatch(tex, /title: Demo/);
  assert.match(tex, /\\begin\{verbatim\}\nconst x = 1 & 2;\n\\end\{verbatim\}/);
});

test('markdownToLatex keeps remote markdown images as LaTeX asset placeholders', () => {
  const tex = markdownToLatex('![Logo UNTREF](https://i.imgur.com/3dKJzNX.png)', 'Imagenes');
  assert.match(tex, /% Remote image asset: https:\/\/i\.imgur\.com\/3dKJzNX\.png/);
  assert.match(tex, /\\IfFileExists\{remote-image-0\.png\}/);
  assert.match(tex, /\\fbox\{LOCAL IMAGE HERE: remote-image-0\.png\}/);
  assert.match(tex, /\\caption\{Logo UNTREF\}/);
});

test('markdownToLatex parses image options: width, positional and explicit captions', () => {
  const tex = markdownToLatex([
    '![|500px](https://i.imgur.com/3dKJzNX.png)',
    '![|Whole Earth Catalog (1968) Fuente: MoMA](https://i.imgur.com/3dKJzNX.png)',
    '![|caption:"Whole Earth Catalog (1968) Fuente: MoMA"](https://i.imgur.com/3dKJzNX.png)',
    '![|500px|caption:"Whole Earth Catalog (1968) Fuente: MoMA"](https://i.imgur.com/3dKJzNX.png)',
    '![|80%](https://i.imgur.com/3dKJzNX.png)'
  ].join('\n\n'), 'ImagesWithOptions');

  assert.match(tex, /\\includegraphics\[width=500px\]/);
  assert.match(tex, /\\caption\{Whole Earth Catalog \(1968\) Fuente: MoMA\}/);
  assert.match(tex, /\\includegraphics\[width=0\.80\\linewidth\]/);
});

test('markdownToLatex converts markdown callouts to tcolorbox blocks', () => {
  const tex = markdownToLatex([
    '> [!tip] Escucha',
    '> Texto con **énfasis**.',
    '',
    '>[!info]',
    '> Dato.',
    '',
    '> [!summary]',
    '> Cierre.',
  ].join('\n'), 'Callouts');
  assert.match(tex, /\\usepackage\[most\]\{tcolorbox\}/);
  assert.match(tex, /\\newtcolorbox\{musikinotebox\}/);
  assert.match(tex, /\\begin\{musikinotebox\}\[colback=green!5,colframe=green!45!black\]\{Escucha\}/);
  assert.match(tex, /Texto con \\textbf\{énfasis\}\./);
  assert.match(tex, /\\begin\{musikinotebox\}\[colback=blue!5,colframe=blue!45!black\]\{Info\}/);
  assert.match(tex, /\\begin\{musikinotebox\}\[colback=gray!10,colframe=black\]\{Resumen\}/);
});

test('markdownToLatex converts blockquotes and quote callouts following APA7 format', () => {
  const tex = markdownToLatex([
    '> [!quote] Stewart Brand (1968)',
    '> Stay hungry, stay foolish.',
    '> A guide for the next generation.',
    '',
    '> This is an ordinary blockquote.',
    '> Line two.',
  ].join('\n'), 'APA7 Quotes');

  // Verify quote callout with title
  assert.match(tex, /\\begin\{quote\}\n\\textbf\{Stewart Brand \(1968\)\}\\\\\nStay hungry, stay foolish\.\n+A guide for the next generation\.\n\\end\{quote\}/);
  // Verify standard blockquote grouping
  assert.match(tex, /\\begin\{quote\}\nThis is an ordinary blockquote\.\n+Line two\.\n\\end\{quote\}/);
});

test('markdownToLatex translates footnotes and extracts definitions', () => {
  const tex = markdownToLatex([
    'Esto es un texto[^1] con nota.',
    'Y otra nota[^2] más.',
    '',
    '[^1]: esta es la nota footnote 1 con **formato**',
    '[^2]: otra nota.',
  ].join('\n'), 'Footnotes');

  assert.doesNotMatch(tex, /\[\^1\]:/);
  assert.match(tex, /Esto es un texto\\footnote\{esta es la nota footnote 1 con \\textbf\{formato\}\} con nota\./);
  assert.match(tex, /Y otra nota\\footnote\{otra nota\.\} más\./);
});

test('markdownToLatex supports list of figures indexofigures tag', () => {
  const tex = markdownToLatex([
    'Texto previo.',
    '</indexofigures>',
    'Texto posterior.',
  ].join('\n'), 'IndexOfFigures');

  assert.match(tex, /\\listoffigures/);
  assert.doesNotMatch(tex, /indexofigures/);
});

test('markdownToLatex exports asignacion-seminario as an acmart paper template', () => {
  const tex = markdownToLatex('# Resumen\n\nContenido.', 'Entrega', { templateId: 'asignacion-seminario' });
  assert.match(tex, /\\documentclass\[sigconf\]\{acmart\}/);
  assert.match(tex, /\\usepackage\[most\]\{tcolorbox\}/);
  assert.match(tex, new RegExp(UNTREF_LOGO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(tex, /\\fancyhead\[L\]\{\\small\\untreflogo\}/);
  assert.match(tex, /\\section\{Resumen\}/);
});

test('markdownToLatex exports tesina-seminario as a modern thesis template', () => {
  const tex = markdownToLatex('# Capítulo\n\nContenido.', 'Tesina', { templateId: 'tesina-seminario' });
  assert.match(tex, /\\documentclass\[12pt,a4paper\]\{report\}/);
  assert.match(tex, /\\usepackage\[spanish\]\{babel\}/);
  assert.match(tex, /\\tableofcontents/);
  assert.match(tex, /\\section\{Capítulo\}/);
});

test('LATEX_TEMPLATES lists the seminar exports', () => {
  assert.equal(LATEX_TEMPLATES.some(template => template.id === 'asignacion-seminario'), true);
  assert.equal(LATEX_TEMPLATES.some(template => template.id === 'tesina-seminario'), true);
});

test('markdownToLatex processes footnotes inside callouts and write18 remote image downloaders', () => {
  const tex = markdownToLatex([
    '> [!quote] Cita',
    '> Esto es una cita[^3] con footnote.',
    '>',
    '> [^3]: esta es la nota 3 dentro de la cita.',
    '',
    '![Imagen Web](https://example.com/figure.png)'
  ].join('\n'), 'FootnotesInQuotesAndWrite18');

  assert.match(tex, /Esto es una cita\\footnote\{esta es la nota 3 dentro de la cita\.\} con footnote\./);
  assert.match(tex, /\\fbox\{LOCAL IMAGE HERE: remote-image-0\.png\}/);
});


