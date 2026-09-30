// Localized texts about a relation type for the pages (server side): the
// description of its visual sample and its property names. Built from the
// pure helpers + the mm dictionaries; plain strings (rendered as text).

import { t, type MessageKey } from '../i18n';
import { TYPE_COLORS, TYPE_STROKES, typeProperties, type TypeLike } from './relation-type-ui.ts';
import type { MmLang } from './ui-lang.ts';

export function sampleDescription(lang: MmLang, type: Pick<TypeLike, 'render' | 'stroke' | 'arrow' | 'color' | 'symmetric'>): string {
  const color = (TYPE_COLORS as readonly string[]).includes(type.color) ? type.color : 'ink';
  const stroke = (TYPE_STROKES as readonly string[]).includes(type.stroke) ? type.stroke : 'solid';
  const vars = {
    color: t(lang, `mm.modeler.colors.${color}` as MessageKey),
    stroke: t(lang, `mm.modeler.strokes.${stroke}` as MessageKey),
  };
  if (type.render === 'area') return t(lang, 'mm.modeler.sampleArea', vars);
  return t(lang, type.arrow && !type.symmetric ? 'mm.modeler.sampleArrow' : 'mm.modeler.sampleLine', vars);
}

export const propertyNames = (lang: MmLang, type: Pick<TypeLike, 'symmetric' | 'transitive' | 'hierarchical'>) =>
  typeProperties(type).map((p) => ({ key: p, name: t(lang, `mm.modeler.properties.${p}` as MessageKey), help: t(lang, `mm.modeler.propertyHelp.${p}` as MessageKey) }));
