type LatexListState = 'itemize' | 'enumerate';
type LatexCalloutKind = 'tip' | 'info' | 'summary' | 'quote';

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

function imageFileName(index: number, url: string): string {
  const clean = sanitizeUrl(url).replace(/[<>]/g, '');
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    const extension = clean.split(/[?#]/)[0].match(/\.(png|jpe?g|pdf)$/i)?.[1]?.toLowerCase();
    const ext = extension === 'jpeg' ? 'jpeg' : (extension === 'jpg' ? 'jpg' : (extension || 'png'));
    return `remote-image-${index}.${ext}`;
  }
  return clean;
}

function remoteImageLatex(alt: string, url: string, index: number): string {
  const cleanUrl = sanitizeUrl(url).replace(/[<>]/g, '');
  let caption = 'Imagen remota';
  let width = '.92\\linewidth';

  if (alt.includes('|')) {
    const parts = alt.split('|').map(p => p.trim()).filter(Boolean);
    parts.forEach(part => {
      const capMatch = part.match(/^caption:\s*["']?(.*?)["']?$/i);
      if (capMatch) {
        caption = capMatch[1];
      } else if (/^\d+(?:\.\d+)?%$/.test(part)) {
        const pct = parseFloat(part);
        width = `${(pct / 100).toFixed(2)}\\linewidth`;
      } else if (/^(?:width=)?(\d+(?:\.\d+)?(?:px|cm|mm|in|pt|em|ex|\\linewidth|\\textwidth)?)$/i.test(part)) {
        const match = part.match(/^(?:width=)?(.*)$/i);
        width = match ? match[1] : part;
      } else {
        caption = part;
      }
    });
  } else if (alt.trim()) {
    caption = alt.trim();
  }

  const escapedCaption = escapeLatex(caption);
  const filename = imageFileName(index, cleanUrl);
  const escapedFilename = escapeLatex(filename);
  return [
    '\\begin{figure}[H]',
    '\\centering',
    `% Remote image asset: ${cleanUrl}`,
    `\\IfFileExists{${filename}}{%`,
    `  \\includegraphics[width=${width}]{${filename}}%`,
    `}{%`,
    `  \\fbox{LOCAL IMAGE HERE: ${escapedFilename}}%`,
    `}`,
    `\\caption{${escapedCaption}}`,
    '\\end{figure}',
  ].join('\n');
}

function calloutTitle(kind: LatexCalloutKind, title: string): string {
  const explicit = String(title || '').trim();
  if (explicit) return explicit;
  if (kind === 'tip') return 'Tip';
  if (kind === 'info') return 'Info';
  if (kind === 'quote') return 'Quote';
  return 'Resumen';
}

function calloutOptions(kind: LatexCalloutKind): string {
  if (kind === 'tip') return 'colback=green!5,colframe=green!45!black';
  if (kind === 'info') return 'colback=blue!5,colframe=blue!45!black';
  if (kind === 'quote') return 'colback=gray!5,colframe=gray!45!black';
  return 'colback=gray!10,colframe=black';
}

function closeCallout(
  lines: string[],
  callout: { kind: LatexCalloutKind; title: string; content: string[] } | null,
  footnotes?: Map<string, string>
): null {
  if (!callout) return null;
  const body = markdownToLatexBody(callout.content.join('\n'), footnotes);
  if (callout.kind === 'quote') {
    lines.push('\\begin{quote}');
    if (callout.title && callout.title.trim()) {
      lines.push(`\\textbf{${escapeLatex(callout.title.trim())}}\\\\`);
    }
    if (body) lines.push(body);
    lines.push('\\end{quote}');
    lines.push('');
  } else {
    lines.push(`\\begin{musikinotebox}[${calloutOptions(callout.kind)}]{${escapeLatex(calloutTitle(callout.kind, callout.title))}}`);
    if (body) lines.push(body);
    lines.push('\\end{musikinotebox}');
    lines.push('');
  }
  return null;
}

function inlineMarkdownToLatex(markdown: string, footnotes?: Map<string, string>): string {
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
    hold(`\\href{${sanitizeUrl(url)}}{${inlineMarkdownToLatex(label, footnotes)}}`));
  
  // Convert footnotes: [^1]
  text = text.replace(/\[\^([^\]]+)\]/g, (_match, id) => {
    const fnId = id.trim();
    const fnContent = footnotes?.get(fnId) || '';
    if (fnContent) {
      return hold(`\\footnote{${inlineMarkdownToLatex(fnContent, footnotes)}}`);
    }
    return hold(`\\footnote{${escapeLatex(fnId)}}`);
  });

  text = text.replace(/\*\*([^*]+)\*\*/g, (_match, inner) => hold(`\\textbf{${inlineMarkdownToLatex(inner, footnotes)}}`));
  text = text.replace(/__([^_]+)__/g, (_match, inner) => hold(`\\textbf{${inlineMarkdownToLatex(inner, footnotes)}}`));
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_match, inner) => hold(`\\emph{${inlineMarkdownToLatex(inner, footnotes)}}`));
  text = text.replace(/(?<!_)_([^_\n]+)_(?!_)/g, (_match, inner) => hold(`\\emph{${inlineMarkdownToLatex(inner, footnotes)}}`));
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

export function extractFootnotes(markdown: string): { cleanMarkdown: string; footnotes: Map<string, string> } {
  const footnotes = new Map<string, string>();
  const lines = markdown.split('\n');
  const cleanLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([\s>]*?)\[\^([^\]]+)\]:\s*(.*)$/);
    if (match) {
      footnotes.set(match[2].trim(), match[3].trim());
      const prefix = match[1];
      if (prefix.includes('>')) {
        cleanLines.push(prefix.trimEnd());
      } else {
        cleanLines.push('');
      }
    } else {
      cleanLines.push(line);
    }
  }

  return {
    cleanMarkdown: cleanLines.join('\n'),
    footnotes,
  };
}

export function markdownToLatexBody(markdown: string, footnotes?: Map<string, string>): string {
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
        if (activeCallout) activeCallout = closeCallout(output, activeCallout, footnotes);
        inCodeFence = true;
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeFence) {
      codeBuffer.push(rawLine);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      const quoteContent = quoteMatch[1];
      if (activeCallout) {
        activeCallout.content.push(quoteContent);
      } else {
        activeList = closeList(output, activeList);
        const calloutMatch = quoteContent.match(/^\[!(tip|info|summary|quote)\]\s*(.*)$/i);
        if (calloutMatch) {
          activeCallout = {
            kind: calloutMatch[1].toLowerCase() as LatexCalloutKind,
            title: calloutMatch[2] || '',
            content: [],
          };
        } else {
          activeCallout = {
            kind: 'quote',
            title: '',
            content: [quoteContent],
          };
        }
      }
      continue;
    }

    if (activeCallout) {
      activeCallout = closeCallout(output, activeCallout, footnotes);
    }

    if (!line.trim()) {
      activeList = closeList(output, activeList);
      if (output[output.length - 1] !== '') output.push('');
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      activeList = closeList(output, activeList);
      output.push(`\\${latexCommandForHeading(heading[1].length)}{${inlineMarkdownToLatex(heading[2], footnotes)}}`);
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
      output.push(`\\item ${inlineMarkdownToLatex(unordered[1], footnotes)}`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (activeList !== 'enumerate') {
        activeList = closeList(output, activeList);
        output.push('\\begin{enumerate}[leftmargin=*]');
        activeList = 'enumerate';
      }
      output.push(`\\item ${inlineMarkdownToLatex(ordered[1], footnotes)}`);
      continue;
    }

    activeList = closeList(output, activeList);
    output.push(inlineMarkdownToLatex(line, footnotes));
    output.push('');
  }

  if (inCodeFence) {
    output.push('\\begin{verbatim}');
    output.push(...codeBuffer);
    output.push('\\end{verbatim}');
    output.push('');
  }

  closeList(output, activeList);
  if (activeCallout) closeCallout(output, activeCallout, footnotes);
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
    '\\IfFileExists{untref-logo.png}{}{%',
    `  \\immediate\\write18{curl -L -o untref-logo.png "${UNTREF_LOGO_URL}" || wget -O untref-logo.png "${UNTREF_LOGO_URL}"}%`,
    '}',
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
    '\\usepackage{float}',
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
    '\\usepackage{float}',
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

function parseCover(content: string) {
  const lines = content.split('\n');
  const props: Record<string, string> = {
    title: '',
    subtitle: '',
    author: '',
    attribution: 'Tesina para la Licenciatura en Música de la Universidad Nacional de Tres de Febrero',
    year: '',
    tutor: ''
  };
  for (const line of lines) {
    const parts = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (parts) {
      let key = parts[1].trim().toLowerCase();
      if (key === 'attribuition') key = 'attribution';
      let val = parts[2].trim();
      if (val.startsWith('{') && val.endsWith('}')) {
        val = val.slice(1, -1).trim();
      }
      if (key in props) {
        props[key] = val;
      }
    }
  }
  return props;
}

function tesinaSeminarioDocument(
  body: string,
  title: string,
  extra?: {
    coverData?: any;
    abstractSP?: string | null;
    abstractEN?: string | null;
    keywordsSP?: string | null;
    keywordsEN?: string | null;
    footnotes?: Map<string, string>;
  }
): string {
  let coverPage = '';
  let makeTitleCmd = '\\maketitle';

  if (extra?.coverData) {
    const cd = extra.coverData;
    makeTitleCmd = '';
    coverPage = [
      '\\begin{titlepage}',
      '\\centering',
      '\\vspace*{2cm}',
      `{\\Large \\bfseries ${escapeLatex(cd.title || title)} \\par}`,
      cd.subtitle ? `\\vspace{0.5cm}\n{\\large ${escapeLatex(cd.subtitle)} \\par}` : '',
      '\\vspace{2.5cm}',
      `{\\large \\bfseries ${escapeLatex(cd.author)} \\par}`,
      '\\vspace{2.5cm}',
      cd.year
        ? `{\\large ${escapeLatex(cd.attribution)} [${escapeLatex(cd.year)}] \\par}`
        : `{\\large ${escapeLatex(cd.attribution)} \\par}`,
      '\\vspace{2cm}',
      cd.tutor ? `{\\large Tutor: ${escapeLatex(cd.tutor)} \\par}` : '',
      '\\vfill',
      '\\end{titlepage}',
      '\\clearpage'
    ].filter(Boolean).join('\n');
  }

  let abstractPages = '';
  const fns = extra?.footnotes;
  if (extra?.abstractSP) {
    const abstractSPBody = markdownToLatexBody(extra.abstractSP, fns);
    const keywordsSPStr = extra.keywordsSP
      ? `\\vspace{1.5cm}\n\\noindent \\textbf{Palabras Claves:} ${inlineMarkdownToLatex(extra.keywordsSP, fns)}`
      : '';
    abstractPages += [
      '\\chapter*{Resumen}',
      '\\addcontentsline{toc}{chapter}{Resumen}',
      abstractSPBody,
      keywordsSPStr,
      '\\clearpage'
    ].join('\n') + '\n\n';
  }

  if (extra?.abstractEN) {
    const abstractENBody = markdownToLatexBody(extra.abstractEN, fns);
    const keywordsENStr = extra.keywordsEN
      ? `\\vspace{1.5cm}\n\\noindent \\textbf{Keywords:} ${inlineMarkdownToLatex(extra.keywordsEN, fns)}`
      : '';
    abstractPages += [
      '\\chapter*{Abstract}',
      '\\addcontentsline{toc}{chapter}{Abstract}',
      abstractENBody,
      keywordsENStr,
      '\\clearpage'
    ].join('\n') + '\n\n';
  }

  return [
    '\\documentclass[12pt,a4paper]{report}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[spanish]{babel}',
    '\\usepackage{hyperref}',
    '\\usepackage{graphicx}',
    '\\usepackage{float}',
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
    extra?.coverData ? coverPage : makeTitleCmd,
    abstractPages,
    '\\tableofcontents',
    '\\clearpage',
    '',
    body,
    '',
    '\\end{document}',
    '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

export function parseCustomBlocks(markdown: string): {
  cleanMarkdown: string;
  blocks: Map<string, string>;
} {
  const blocks = new Map<string, string>();
  let result = '';
  let i = 0;

  while (i < markdown.length) {
    if (markdown[i] === '{' && markdown[i + 1] === '#') {
      let j = i + 2;
      while (j < markdown.length && /[a-zA-Z0-9_-]/.test(markdown[j])) {
        j++;
      }
      const name = markdown.substring(i + 2, j).toLowerCase();
      let depth = 1;
      let k = j;
      while (k < markdown.length && depth > 0) {
        if (markdown[k] === '{') {
          depth++;
        } else if (markdown[k] === '}') {
          depth--;
        }
        k++;
      }
      if (depth === 0) {
        const content = markdown.substring(j, k - 1).trim();
        blocks.set(name, content);
        i = k;
        continue;
      }
    }
    result += markdown[i];
    i++;
  }

  return {
    cleanMarkdown: result,
    blocks
  };
}

export function markdownToLatex(markdown: string, title = 'Nota', options: MarkdownToLatexOptions = {}): string {
  const { cleanMarkdown, footnotes } = extractFootnotes(markdown);

  let tesinaCoverData: any = null;
  let tesinaAbstractSP: string | null = null;
  let tesinaAbstractEN: string | null = null;
  let tesinaKeywordsSP: string | null = null;
  let tesinaKeywordsEN: string | null = null;

  let processedMarkdown = cleanMarkdown;

  if (options.templateId === 'tesina-seminario') {
    const { cleanMarkdown: stripped, blocks } = parseCustomBlocks(cleanMarkdown);
    processedMarkdown = stripped.trim();

    const coverContent = blocks.get('cover');
    if (coverContent) {
      tesinaCoverData = parseCover(coverContent);
    }
    tesinaAbstractSP = blocks.get('abstract-sp') || null;
    tesinaAbstractEN = blocks.get('abstract-en') || null;
    tesinaKeywordsSP = blocks.get('keywords-sp') || null;
    tesinaKeywordsEN = blocks.get('keywords-en') || null;
  }

  let body = markdownToLatexBody(processedMarkdown, footnotes);

  // Replace indexofigures tags
  body = body.replace(/&lt;\/?indexofigures&gt;/gi, '\\listoffigures');
  body = body.replace(/<\/?indexofigures>/gi, '\\listoffigures');

  if (options.templateId === 'asignacion-seminario') return asignacionSeminarioDocument(body, title);
  if (options.templateId === 'tesina-seminario') {
    return tesinaSeminarioDocument(body, title, {
      coverData: tesinaCoverData,
      abstractSP: tesinaAbstractSP,
      abstractEN: tesinaAbstractEN,
      keywordsSP: tesinaKeywordsSP,
      keywordsEN: tesinaKeywordsEN,
      footnotes
    });
  }
  return directLatexDocument(body, title);
}
