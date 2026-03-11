import { visit } from 'unist-util-visit';

function skipWhitespace(source, index) {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function parseDelimited(source, start, open, close) {
  if (source[start] !== open) return null;
  let depth = 0;
  let cursor = start;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: source.slice(start + 1, cursor),
          end: cursor + 1,
        };
      }
    }
    cursor += 1;
  }
  return null;
}

function parseBracketValue(source, start) {
  if (source[start] !== '[') return null;
  const parsed = parseDelimited(source, start, '[', ']');
  if (!parsed) return null;
  return {
    content: parsed.content.trim(),
    end: parsed.end,
  };
}

function parseMacroName(source, start) {
  let cursor = skipWhitespace(source, start);
  if (cursor >= source.length) return null;

  if (source[cursor] === '{') {
    const group = parseDelimited(source, cursor, '{', '}');
    if (!group) return null;
    const nameMatch = group.content.trim().match(/^\\([A-Za-z@]+)$/);
    if (!nameMatch) return null;
    return {
      name: nameMatch[1],
      end: group.end,
    };
  }

  if (source[cursor] !== '\\') return null;
  const nameMatch = source.slice(cursor + 1).match(/^([A-Za-z@]+)/);
  if (!nameMatch) return null;
  return {
    name: nameMatch[1],
    end: cursor + 1 + nameMatch[1].length,
  };
}

function parseMacroDefinition(source, start) {
  const commandMatch = source.slice(start).match(/^\\(?:re)?newcommand\b/);
  if (!commandMatch) return null;

  let cursor = start + commandMatch[0].length;
  const nameInfo = parseMacroName(source, cursor);
  if (!nameInfo) return null;
  cursor = nameInfo.end;

  let arity = 0;
  cursor = skipWhitespace(source, cursor);
  const arityInfo = parseBracketValue(source, cursor);
  if (arityInfo) {
    const parsedArity = Number.parseInt(arityInfo.content, 10);
    if (Number.isFinite(parsedArity) && parsedArity >= 0 && parsedArity <= 9) {
      arity = parsedArity;
      cursor = arityInfo.end;
    }
  }

  cursor = skipWhitespace(source, cursor);
  const bodyInfo = parseDelimited(source, cursor, '{', '}');
  if (!bodyInfo) return null;

  return {
    name: nameInfo.name,
    arity,
    body: bodyInfo.content,
    end: bodyInfo.end,
  };
}

function extractMacroDefinitions(source, macros) {
  let cursor = 0;
  let output = '';
  let found = false;

  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      const definition = parseMacroDefinition(source, cursor);
      if (definition) {
        macros.set(definition.name, {
          arity: definition.arity,
          body: definition.body,
        });
        found = true;
        cursor = definition.end;
        continue;
      }
    }

    output += source[cursor];
    cursor += 1;
  }

  return {
    value: output,
    found,
  };
}

function parseMathArgument(source, start) {
  const cursor = skipWhitespace(source, start);
  if (cursor >= source.length) return null;

  if (source[cursor] === '{') {
    const group = parseDelimited(source, cursor, '{', '}');
    if (!group) return null;
    return {
      content: group.content,
      end: group.end,
    };
  }

  if (source[cursor] === '\\') {
    const nameMatch = source.slice(cursor + 1).match(/^([A-Za-z@]+)/);
    if (nameMatch) {
      return {
        content: `\\${nameMatch[1]}`,
        end: cursor + 1 + nameMatch[1].length,
      };
    }
  }

  return {
    content: source[cursor],
    end: cursor + 1,
  };
}

function expandMacroReferences(source, macros) {
  let current = source;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    let changed = false;
    let cursor = 0;
    let output = '';

    while (cursor < current.length) {
      if (current[cursor] !== '\\') {
        output += current[cursor];
        cursor += 1;
        continue;
      }

      const nameMatch = current.slice(cursor + 1).match(/^([A-Za-z@]+)/);
      if (!nameMatch) {
        output += current.slice(cursor, cursor + 1);
        cursor += 1;
        continue;
      }

      const macroName = nameMatch[1];
      const macro = macros.get(macroName);
      if (!macro) {
        output += `\\${macroName}`;
        cursor += macroName.length + 1;
        continue;
      }

      let nextCursor = cursor + macroName.length + 1;
      const args = [];

      for (let argIndex = 0; argIndex < macro.arity; argIndex += 1) {
        const parsedArg = parseMathArgument(current, nextCursor);
        if (!parsedArg) {
          output += `\\${macroName}`;
          cursor += macroName.length + 1;
          nextCursor = null;
          break;
        }
        args.push(parsedArg.content);
        nextCursor = parsedArg.end;
      }

      if (nextCursor === null) {
        continue;
      }

      let replacement = macro.body;
      for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
        replacement = replacement.replaceAll(`#${argIndex + 1}`, args[argIndex]);
      }

      output += replacement;
      cursor = nextCursor;
      changed = true;
    }

    current = output;
    if (!changed) break;
  }

  return current;
}

function processMathNodes(nodes, macros) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];

    if (Array.isArray(node?.children) && node.children.length > 0) {
      processMathNodes(node.children, macros);
    }

    if (node?.type !== 'math' && node?.type !== 'inlineMath') continue;

    const source = typeof node.value === 'string' ? node.value : '';
    const extracted = extractMacroDefinitions(source, macros);
    const nextValue = expandMacroReferences(extracted.value, macros).trim();

    if (!nextValue) {
      nodes.splice(index, 1);
      index -= 1;
      continue;
    }

    node.value = nextValue;
    if (Array.isArray(node.data?.hChildren) && node.data.hChildren.length > 0) {
      for (const child of node.data.hChildren) {
        if (child?.type === 'text') {
          child.value = nextValue;
        }
      }
    }
  }
}

export default function remarkForumMathMacros() {
  return (tree) => {
    const macros = new Map();

    visit(tree, 'root', (node) => {
      if (!Array.isArray(node.children)) return;
      processMathNodes(node.children, macros);
    });
  };
}
