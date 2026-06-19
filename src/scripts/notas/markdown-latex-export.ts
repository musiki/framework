type LatexListState = 'itemize' | 'enumerate';
type LatexCalloutKind = 'tip' | 'info' | 'summary';

export type LatexTemplateId = 'direct' | 'asignacion-seminario' | 'tesina-seminario';

export interface MarkdownToLatexOptions {
  templateId?: LatexTemplateId | string;
}

export interface LatexTemplateDefinition {
  id: LatexTemplateId;
  label: string;
  description: string;
}

export const UNTREF_LOGO_URL = 'https://i.imgur.com/3dKJzNX.png';

export const LATEX_TEMPLATES: LatexTemplateDefinition[] = [
  {
    id: 'direct',
    label: 'LaTeX directo',
    description: 'Documento article simple para export rapido.',
  },
  {
    id: 'asignacion-seminario',
    label: 'asignación-seminario',
    description: 'Paper academico basado en acmart sigconf.',
  },
  {
    id: 'tesina-seminario',
    label: 'tesina-seminario',
    description: 'Tesina de grado con layout moderno.',
  },
];

const LATEX_SPECIALS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

function escapeLatex(value: string): string {
  return String(value || '').replace(/[\\&%$#_{}~^]/g, char => LATEX_SPECIALS[char] || char);
}

function stripFrontmatter(markdown: string): string {
  return String(markdown || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function latexCommandForHeading(level: number): string {
  if (level <= 1) return 'section';
  if (level === 2) return 'subsection';
  if (level === 3) return 'subsubsection';
  if (level === 4) return 'paragraph';
  return 'subparagraph';
}

function sanitizeUrl(url: string): string {
  return String(url || '').replace(/[{}\\]/g, '');
}

function remoteAssetFileName(index: number, url: string): string {
  const extension = sanitizeUrl(url).split(/[?#]/)[0].match(/\.(png|jpe?g|pdf)$/i)?.[1]?.toLowerCase();
  return `remote-image-${index}.${extension === 'jpg' ? 'jpg' : extension || 'png'}`;
}

function remoteImageLatex(alt: string, url: string, index: number): string {
  const cleanUrl = sanitizeUrl(url);
  const caption = escapeLatex(alt || 'Imagen remota');
  const filename = remoteAssetFileName(index, cleanUrl);
  return [
    '\\begin{figure}[ht]',
    '\\centering',
    `% Remote image asset: ${cleanUrl}`,
    `\\IfFileExists{${filename}}{\\includegraphics[width=.92\\linewidth]{${filename}}}{\\fbox{\\href{${cleanUrl}}{${caption}}}}`,
    `\\caption{${caption}}`,
    '\\end{figure}',
  ].join('\n');
}

function calloutTitle(kind: LatexCalloutKind, title: string): string {
  const explicit = String(title || '').trim();
  if (explicit) return explicit;
  if (kind === 'tip') return 'Tip';
  if (kind === 'info') return 'Info';
  return 'Resumen';
}

function calloutOptions(kind: LatexCalloutKind): string {
  if (kind === 'tip') return 'colback=green!5,colframe=green!45!black';
  if (kind === 'info') return 'colback=blue!5,colframe=blue!45!black';
  return 'colback=gray!10,colframe=black';
}

function closeCallout(
  lines: string[],
  callout: { kind: LatexCalloutKind; title: string; content: string[] } | null,
): null {
  if (!callout) return null;
  const body = markdownToLatexBody(callout.content.join('\n'));
  lines.push(`\\begin{musikinotebox}[${calloutOptions(callout.kind)}]{${escapeLatex(calloutTitle(callout.kind, callout.title))}}`);
  if (body) lines.push(body);
  lines.push('\\end{musikinotebox}');
  lines.push('');
  return null;
}

function inlineMarkdownToLatex(markdown: string): string {
  const placeholders: string[] = [];
  const hold = (value: string) => {
    const token = `LATEXPLACEHOLDER${placeholders.length}TOKEN`;
    placeholders.push(value);
    return token;
  };

  let text = String(markdown || '');
  text = text.replace(/`([^`]+)`/g, (_match, code) => hold(`\\texttt{${escapeLatex(code)}}`));
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) =>
    hold(remoteImageLatex(alt, url, placeholders.length)));
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) =>
    hold(`\\href{${sanitizeUrl(url)}}{${inlineMarkdownToLatex(label)}}`));
  text = text.replace(/\*\*([^*]+)\*\*/g, (_match, inner) => hold(`\\textbf{${inlineMarkdownToLatex(inner)}}`));
  text = text.replace(/__([^_]+)__/g, (_match, inner) => hold(`\\textbf{${inlineMarkdownToLatex(inner)}}`));
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_match, inner) => hold(`\\emph{${inlineMarkdownToLatex(inner)}}`));
  text = text.replace(/(?<!_)_([^_\n]+)_(?!_)/g, (_match, inner) => hold(`\\emph{${inlineMarkdownToLatex(inner)}}`));
  text = escapeLatex(text);

  placeholders.forEach((value, index) => {
    text = text.replaceAll(`LATEXPLACEHOLDER${index}TOKEN`, value);
  });
  return text;
}

function closeList(lines: string[], activeList: LatexListState | null): null {
  if (activeList) {
    lines.push(`\\end{${activeList}}`);
    lines.push('');
  }
  return null;
}

export function markdownToLatexBody(markdown: string): string {
  const source = stripFrontmatter(markdown).replace(/\r\n?/g, '\n');
  const output: string[] = [];

  let activeList: LatexListState | null = null;
  let activeCallout: { kind: LatexCalloutKind; title: string; content: string[] } | null = null;
  let inCodeFence = false;
  let codeBuffer: string[] = [];

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trimEnd();
    const fence = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      if (inCodeFence) {
        output.push('\\begin{verbatim}');
        output.push(...codeBuffer);
        output.push('\\end{verbatim}');
        output.push('');
        codeBuffer = [];
        inCodeFence = false;
      } else {
        activeList = closeList(output, activeList);
        inCodeFence = true;
        codeBuffer = [];
      }
      continue;
    }

    if (activeCallout) {
      const quoted = line.match(/^>\s?(.*)$/);
      if (quoted) {
        activeCallout.content.push(quoted[1]);
        continue;
      }
      activeCallout = closeCallout(output, activeCallout);
    }

    if (inCodeFence) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      activeList = closeList(output, activeList);
      if (output[output.length - 1] !== '') output.push('');
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      activeList = closeList(output, activeList);
      output.push(`\\${latexCommandForHeading(heading[1].length)}{${inlineMarkdownToLatex(heading[2])}}`);
      output.push('');
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      activeList = closeList(output, activeList);
      output.push('\\bigskip\\hrule\\bigskip');
      output.push('');
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      if (activeList !== 'itemize') {
        activeList = closeList(output, activeList);
        output.push('\\begin{itemize}[leftmargin=*]');
        activeList = 'itemize';
      }
      output.push(`\\item ${inlineMarkdownToLatex(unordered[1])}`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (activeList !== 'enumerate') {
        activeList = closeList(output, activeList);
        output.push('\\begin{enumerate}[leftmargin=*]');
        activeList = 'enumerate';
      }
      output.push(`\\item ${inlineMarkdownToLatex(ordered[1])}`);
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      activeList = closeList(output, activeList);
      const callout = quote[1].match(/^\[!(tip|info|summary)\]\s*(.*)$/i);
      if (callout) {
        activeCallout = {
          kind: callout[1].toLowerCase() as LatexCalloutKind,
          title: callout[2] || '',
          content: [],
        };
        continue;
      }
      output.push('\\begin{quote}');
      output.push(inlineMarkdownToLatex(quote[1]));
      output.push('\\end{quote}');
      output.push('');
      continue;
    }

    activeList = closeList(output, activeList);
    output.push(inlineMarkdownToLatex(line));
    output.push('');
  }

  if (inCodeFence) {
    output.push('\\begin{verbatim}');
    output.push(...codeBuffer);
    output.push('\\end{verbatim}');
    output.push('');
  }

  closeList(output, activeList);
  closeCallout(output, activeCallout);
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tcolorboxCommands(): string[] {
  return [
    '\\usepackage[most]{tcolorbox}',
    '\\tcbuselibrary{skins,breakable}',
    '\\newtcolorbox{musikinotebox}[2][]{%',
    '  enhanced,breakable,sharp corners,boxrule=0pt,leftrule=2pt,',
    '  boxsep=1mm,left=2mm,right=2mm,top=1mm,bottom=1mm,',
    '  colback=gray!8,colframe=black,coltitle=black,fonttitle=\\bfseries,',
    '  title={#2},#1',
    '}',
  ];
}

function untrefLogoCommands(): string[] {
  return [
    `\\newcommand{\\untreflogourl}{${UNTREF_LOGO_URL}}`,
    '% Remote logo asset: https://i.imgur.com/3dKJzNX.png',
    '% Future PDF compiler can download it as untref-logo.png before running LaTeX.',
    '\\newcommand{\\untreflogo}{\\IfFileExists{untref-logo.png}{\\includegraphics[height=0.42cm]{untref-logo.png}}{\\href{\\untreflogourl}{UNTREF}}}',
  ];
}

function directLatexDocument(body: string, title: string): string {
  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{hyperref}',
    '\\usepackage{graphicx}',
    '\\usepackage{enumitem}',
    '\\usepackage{geometry}',
    ...tcolorboxCommands(),
    '\\geometry{margin=2.7cm}',
    `\\title{${escapeLatex(title || 'Nota')}}`,
    '\\date{}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    body,
    '',
    '\\end{document}',
    '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

function asignacionSeminarioDocument(body: string, title: string): string {
  return [
    '\\documentclass[sigconf]{acmart}',
    '\\settopmatter{printacmref=false}',
    '\\renewcommand\\footnotetextcopyrightpermission[1]{}',
    '\\pagestyle{plain}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{hyperref}',
    '\\usepackage{graphicx}',
    '\\usepackage{enumitem}',
    '\\usepackage{fancyhdr}',
    ...tcolorboxCommands(),
    ...untrefLogoCommands(),
    '\\fancypagestyle{seminario}{%',
    '  \\fancyhf{}%',
    '  \\fancyhead[L]{\\small\\untreflogo}%',
    '  \\fancyhead[R]{\\small Seminario de Composicion}%',
    '  \\fancyfoot[C]{\\small\\thepage}%',
    '}',
    `\\title{${escapeLatex(title || 'Asignacion seminario')}}`,
    '\\author{}',
    '\\date{}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '\\thispagestyle{seminario}',
    '',
    body,
    '',
    '\\end{document}',
    '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

function tesinaSeminarioDocument(body: string, title: string): string {
  return [
    '\\documentclass[12pt,a4paper]{report}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[spanish]{babel}',
    '\\usepackage{hyperref}',
    '\\usepackage{graphicx}',
    '\\usepackage{enumitem}',
    '\\usepackage{geometry}',
    '\\usepackage{setspace}',
    '\\usepackage{titlesec}',
    '\\usepackage{fancyhdr}',
    ...tcolorboxCommands(),
    '\\geometry{top=2.8cm,bottom=2.8cm,left=3.2cm,right=2.6cm}',
    '\\onehalfspacing',
    ...untrefLogoCommands(),
    '\\pagestyle{fancy}',
    '\\fancyhf{}',
    '\\fancyhead[L]{\\small\\untreflogo}',
    '\\fancyhead[R]{\\small Tesina seminario}',
    '\\fancyfoot[C]{\\small\\thepage}',
    '\\titleformat{\\chapter}[display]{\\normalfont\\bfseries\\Large}{\\chaptertitlename\\ \\thechapter}{12pt}{\\Huge}',
    `\\title{${escapeLatex(title || 'Tesina seminario')}}`,
    '\\author{}',
    '\\date{\\today}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '\\tableofcontents',
    '\\clearpage',
    '',
    body,
    '',
    '\\end{document}',
    '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

export function markdownToLatex(markdown: string, title = 'Nota', options: MarkdownToLatexOptions = {}): string {
  const body = markdownToLatexBody(markdown);
  if (options.templateId === 'asignacion-seminario') return asignacionSeminarioDocument(body, title);
  if (options.templateId === 'tesina-seminario') return tesinaSeminarioDocument(body, title);
  return directLatexDocument(body, title);
}
