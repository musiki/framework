import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPE_COLORS, TYPE_STROKES, TYPE_RENDERS, typeLabel, typeInverse, typeProperties, typePath, strokeColor, tintColor,
  dashArray, needsInkUnderlay, sampleSpec, svgAttrs, formRules, buildTypeBody, moveSlug, visibleSlugs, CLOUD_SAMPLE, SAMPLE_W, SAMPLE_H,
} from './relation-type-ui.ts';
import { RELATION_COLORS, RELATION_STROKES, RELATION_RENDERS, cleanRelationTypeFields } from './relation-types-core.ts';

const contains = {
  slug: 'contains', label: 'contains', labelNb: 'inneholder', inverseLabel: 'is contained in', inverseLabelNb: null,
  render: 'area', stroke: 'solid', arrow: true, color: 'purple', symmetric: false, transitive: true, hierarchical: true,
};

test('enum lists mirror the core', () => {
  assert.deepEqual([...TYPE_COLORS], [...RELATION_COLORS]);
  assert.deepEqual([...TYPE_STROKES], [...RELATION_STROKES]);
  assert.deepEqual([...TYPE_RENDERS], [...RELATION_RENDERS]);
});

test('typeLabel: hand-written Bokmål for nb/nn, English otherwise', () => {
  assert.deepEqual(typeLabel(contains, 'en'), { text: 'contains', lang: 'en' });
  assert.deepEqual(typeLabel(contains, 'nb'), { text: 'inneholder', lang: 'nb' });
  assert.deepEqual(typeLabel(contains, 'nn'), { text: 'inneholder', lang: 'nb' });
  assert.deepEqual(typeLabel({ label: 'derives from', labelNb: '  ' }, 'nb'), { text: 'derives from', lang: 'en' });
  assert.deepEqual(typeLabel({ label: 'x', labelNb: null }, 'nb'), { text: 'x', lang: 'en' });
});

test('typeInverse: nb when present, English stands in, none for symmetric or missing', () => {
  assert.deepEqual(typeInverse(contains, 'en'), { text: 'is contained in', lang: 'en' });
  assert.deepEqual(typeInverse(contains, 'nb'), { text: 'is contained in', lang: 'en' });
  assert.deepEqual(typeInverse({ ...contains, inverseLabelNb: 'er inneholdt i' }, 'nb'), { text: 'er inneholdt i', lang: 'nb' });
  assert.equal(typeInverse({ ...contains, symmetric: true }, 'en'), null);
  assert.equal(typeInverse({ inverseLabel: null, inverseLabelNb: null, symmetric: false }, 'en'), null);
  assert.equal(typeInverse({ inverseLabel: '', inverseLabelNb: null, symmetric: false }, 'nb'), null);
});

test('typeProperties in fixed order; typePath encodes', () => {
  assert.deepEqual(typeProperties(contains), ['transitive', 'hierarchical']);
  assert.deepEqual(typeProperties({ symmetric: true, transitive: false, hierarchical: false }), ['symmetric']);
  assert.equal(typePath('contains'), '/r/contains');
  assert.equal(typePath('a b/c'), '/r/a%20b%2Fc');
});

test('colours come only from brand tokens', () => {
  for (const c of TYPE_COLORS) {
    assert.match(strokeColor(c), /^var\(--mm-[a-z-]+\)$/);
    assert.match(tintColor(c), /^var\(--mm-[a-z0-9-]+\)$/);
  }
  assert.equal(strokeColor('purple'), 'var(--mm-purple-text)');
  assert.equal(strokeColor('green'), 'var(--mm-green)');
  assert.equal(strokeColor('#ff0000'), 'var(--mm-ink)');
  assert.equal(strokeColor('url(x)'), 'var(--mm-ink)');
  assert.equal(tintColor('purple'), 'var(--mm-purple-tint)');
  assert.equal(tintColor('red'), 'var(--mm-pink-tint)');
  assert.equal(tintColor('ink'), 'var(--mm-ink-5)');
  assert.equal(tintColor('nope'), 'var(--mm-ink-5)');
});

test('dashArray per stroke pattern', () => {
  assert.equal(dashArray('solid'), null);
  assert.equal(dashArray('double'), null);
  assert.equal(dashArray('dashed'), '6 4');
  assert.equal(dashArray('dotted'), '2 3');
});

const tags = (spec) => spec.shapes.map((s) => s.tag);

test('sampleSpec: solid directed line = one line + arrowhead in the slot colour', () => {
  const s = sampleSpec({ render: 'line', stroke: 'solid', arrow: true, color: 'green', symmetric: false });
  assert.equal(s.width, 64);
  assert.equal(s.height, 24);
  assert.deepEqual(tags(s), ['line', 'line', 'path']);
  assert.equal(s.shapes[1].attrs.stroke, 'var(--mm-green)');
  assert.equal(s.shapes[1].attrs['stroke-dasharray'], undefined);
  assert.equal(s.shapes[1].attrs['stroke-linecap'], 'butt');
  assert.equal(s.shapes[2].attrs.fill, 'var(--mm-green)');
  assert.ok(s.shapes[1].attrs.x2 < 60, 'the line stops before the arrowhead');
});

test('sampleSpec: dashed / dotted carry the dash; symmetric never has an arrow', () => {
  const d = sampleSpec({ render: 'line', stroke: 'dashed', arrow: true, color: 'purple', symmetric: true });
  assert.deepEqual(tags(d), ['line']);
  assert.equal(d.shapes[0].attrs['stroke-dasharray'], '6 4');
  const o = sampleSpec({ render: 'line', stroke: 'dotted', arrow: false, color: 'ink', symmetric: false });
  assert.deepEqual(tags(o), ['line']);
  assert.equal(o.shapes[0].attrs['stroke-dasharray'], '2 3');
});

test('sampleSpec: double = two parallel strokes', () => {
  const s = sampleSpec({ render: 'line', stroke: 'double', arrow: false, color: 'red', symmetric: false });
  assert.deepEqual(tags(s), ['line', 'line']);
  assert.notEqual(s.shapes[0].attrs.y1, s.shapes[1].attrs.y1);
  assert.equal(s.shapes[0].attrs.y1, s.shapes[0].attrs.y2);
});

test('sampleSpec: area = a small straight-edged cloud, tint fill + slot-coloured border, never a square', () => {
  const s = sampleSpec(contains);
  assert.deepEqual(tags(s), ['path', 'path']);
  assert.equal(s.shapes[0].attrs.fill, 'var(--mm-purple-tint)');
  assert.equal(s.shapes[1].attrs.stroke, 'var(--mm-purple-text)');
  assert.equal(s.shapes[1].attrs.fill, 'none');
  assert.equal(s.shapes[1].attrs['stroke-width'], 2);
  assert.equal(s.shapes[0].attrs.d, s.shapes[1].attrs.d);
  // Straight segments only, more than four sides (not a square), convex, inside the viewBox.
  const d = String(s.shapes[0].attrs.d);
  assert.match(d, /^M[-\d.,]+(L[-\d.,]+)+Z$/);
  const pts = d.slice(1, -1).split('L').map((p) => p.split(',').map(Number));
  assert.ok(pts.length > 4);
  const turns = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  assert.ok(turns.every((x) => x > 0) || turns.every((x) => x < 0));
  for (const [x, y] of pts) assert.ok(x >= 1 && x <= SAMPLE_W - 1 && y >= 1 && y <= SAMPLE_H - 1, `${x},${y}`);
  assert.deepEqual(CLOUD_SAMPLE.map((p) => p.join(',')), pts.map((p) => p.join(',')));
  for (const sh of s.shapes) {
    assert.notEqual(sh.tag, 'rect');
    assert.equal(sh.attrs.rx, undefined);
  }
  const dashed = sampleSpec({ ...contains, stroke: 'dashed' });
  assert.equal(dashed.shapes[1].attrs['stroke-dasharray'], '6 4');
  const double = sampleSpec({ ...contains, stroke: 'double' });
  assert.deepEqual(tags(double), ['path', 'path', 'path']);
  assert.notEqual(double.shapes[1].attrs.d, double.shapes[2].attrs.d);
});

test('svgAttrs: colours move into style, geometry stays attributes', () => {
  const s = sampleSpec({ render: 'line', stroke: 'dashed', arrow: true, color: 'red', symmetric: false });
  assert.deepEqual(svgAttrs(s.shapes[0]), {
    'stroke-width': '2', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-dasharray': '6 4',
    x1: '4', y1: '12', x2: '52', y2: '12', style: 'stroke:var(--mm-red);fill:none',
  });
  assert.equal(svgAttrs(s.shapes[1]).style, 'fill:var(--mm-red);stroke:none');
});

test('sampleSpec: unknown values fall back safely', () => {
  const s = sampleSpec({ render: 'line', stroke: 'wavy', arrow: false, color: 'javascript:x', symmetric: false });
  assert.deepEqual(tags(s), ['line']);
  assert.equal(s.shapes[0].attrs.stroke, 'var(--mm-ink)');
});

test('formRules: area locks hierarchical on and symmetric off; symmetric and hierarchical exclude each other', () => {
  assert.deepEqual(formRules({ render: 'line', symmetric: false, hierarchical: false }), {
    disabled: { symmetric: false, hierarchical: false, area: false }, forceHierarchical: false,
  });
  assert.deepEqual(formRules({ render: 'area', symmetric: false, hierarchical: false }), {
    disabled: { symmetric: true, hierarchical: true, area: false }, forceHierarchical: true,
  });
  assert.deepEqual(formRules({ render: 'line', symmetric: true, hierarchical: false }), {
    disabled: { symmetric: false, hierarchical: true, area: true }, forceHierarchical: false,
  });
  assert.deepEqual(formRules({ render: 'line', symmetric: false, hierarchical: true }), {
    disabled: { symmetric: true, hierarchical: false, area: false }, forceHierarchical: false,
  });
});

const good = {
  label: ' contains ', labelNb: 'inneholder', inverseLabel: 'is contained in', inverseLabelNb: '', render: 'area', stroke: 'solid',
  arrow: true, color: 'purple', symmetric: false, transitive: true, hierarchical: true, skos: 'skos:narrower', wikidata: 'P527',
  definition: 'A contains B when B is part of A.\r\n',
};

test('buildTypeBody create: flat body, JSON booleans, empty optional fields left out, definition required', () => {
  const r = buildTypeBody(good, 'create');
  assert.equal(r.ok, true);
  assert.deepEqual(r.body, {
    label: 'contains', labelNb: 'inneholder', inverseLabel: 'is contained in', render: 'area', stroke: 'solid', arrow: true,
    color: 'purple', symmetric: false, transitive: true, hierarchical: true, skos: 'skos:narrower', wikidata: 'P527',
    definition: 'A contains B when B is part of A.',
  });
  for (const k of ['arrow', 'symmetric', 'transitive', 'hierarchical']) assert.equal(typeof r.body[k], 'boolean', k);
  // The server accepts what the mirror builds.
  const { definition, ...fields } = r.body;
  assert.doesNotThrow(() => cleanRelationTypeFields(fields));
  const missing = buildTypeBody({ ...good, definition: '   ' }, 'create');
  assert.deepEqual(missing, { ok: false, errors: [{ field: 'definition', code: 'definitionRequired' }] });
});

test('buildTypeBody edit: every field, null clears, no definition', () => {
  const r = buildTypeBody({ ...good, labelNb: '', skos: '' }, 'edit');
  assert.equal(r.ok, true);
  assert.equal(r.body.labelNb, null);
  assert.equal(r.body.inverseLabelNb, null);
  assert.equal(r.body.skos, null);
  assert.equal('definition' in r.body, false);
  assert.doesNotThrow(() => cleanRelationTypeFields(r.body, { ...contains, skos: 'skos:x', wikidata: null }));
});

test('buildTypeBody mirrors the server rules', () => {
  const codes = (v, mode = 'edit') => { const r = buildTypeBody(v, mode); return r.ok ? [] : r.errors.map((e) => `${e.field}:${e.code}`); };
  assert.deepEqual(codes({ ...good, label: '' }), ['label:labelRequired']);
  assert.deepEqual(codes({ ...good, label: 'x'.repeat(201) }), ['label:tooLong']);
  assert.deepEqual(codes({ ...good, inverseLabel: 'x'.repeat(201) }), ['inverseLabel:tooLong']);
  assert.deepEqual(codes({ ...good, hierarchical: false }), ['hierarchical:areaNeedsHierarchical']);
  assert.deepEqual(codes({ ...good, render: 'line', symmetric: true }), ['symmetric:symmetricHierarchical']);
  assert.deepEqual(codes({ ...good, color: '#123456' }), ['color:invalidChoice']);
  assert.deepEqual(codes({ ...good, stroke: 'wavy' }), ['stroke:invalidChoice']);
  assert.deepEqual(codes({ ...good, render: 'blob' }), ['render:invalidChoice']);
  assert.deepEqual(codes({ ...good, skos: 'broader' }), ['skos:invalidSkos']);
  assert.deepEqual(codes({ ...good, wikidata: 'X1' }), ['wikidata:invalidWikidata']);
  assert.deepEqual(codes({ ...good, definition: 'x'.repeat(20001) }, 'create'), ['definition:definitionTooLong']);
  // Every rejection above is also a server rejection.
  for (const bad of [{ render: 'area', hierarchical: false }, { symmetric: true, hierarchical: true }, { color: '#123456' }, { skos: 'broader' }, { wikidata: 'X1' }]) {
    assert.throws(() => cleanRelationTypeFields({ label: 'x', ...bad }));
  }
});

test('moveSlug and visibleSlugs', () => {
  const order = ['derives', 'combines', 'contains'];
  assert.deepEqual(moveSlug(order, 'contains', -1), ['derives', 'contains', 'combines']);
  assert.deepEqual(moveSlug(order, 'derives', -1), order);
  assert.deepEqual(moveSlug(order, 'contains', 1), order);
  assert.deepEqual(moveSlug(order, 'nope', 1), order);
  assert.deepEqual(order, ['derives', 'combines', 'contains']);
  assert.deepEqual(visibleSlugs([{ slug: 'a', checked: true }, { slug: 'b', checked: false }, { slug: 'c', checked: true }]), ['a', 'c']);
});

test('needsInkUnderlay: only the four pastel slots', () => {
  for (const c of ['green', 'yellow', 'blue', 'pink']) assert.equal(needsInkUnderlay(c), true, c);
  for (const c of ['purple', 'red', 'ink', 'nope', '', undefined, null]) assert.equal(needsInkUnderlay(c), false, String(c));
});

test('sampleSpec: light-slot line gets an ink underlay 1px wider, same dash, drawn first', () => {
  const s = sampleSpec({ render: 'line', stroke: 'dashed', arrow: true, color: 'pink', symmetric: false });
  assert.deepEqual(tags(s), ['line', 'line', 'path']);
  const [u, c, a] = s.shapes;
  assert.equal(u.attrs.stroke, 'var(--mm-ink)');
  assert.equal(c.attrs.stroke, 'var(--mm-pink)');
  assert.equal(u.attrs['stroke-width'], c.attrs['stroke-width'] + 1);
  assert.equal(u.attrs['stroke-dasharray'], '6 4');
  assert.equal(u.attrs['stroke-linecap'], 'butt');
  assert.equal(a.attrs.fill, 'var(--mm-pink)');
  assert.equal(a.attrs.stroke, 'var(--mm-ink)');
});

test('sampleSpec: double light line underlays each of the two strokes', () => {
  const s = sampleSpec({ render: 'line', stroke: 'double', arrow: false, color: 'yellow', symmetric: false });
  assert.deepEqual(s.shapes.map((x) => x.attrs.stroke), ['var(--mm-ink)', 'var(--mm-ink)', 'var(--mm-yellow)', 'var(--mm-yellow)']);
  assert.equal(s.shapes[0].attrs.y1, s.shapes[2].attrs.y1);
  assert.equal(s.shapes[0].attrs['stroke-width'], 2.5);
});

test('sampleSpec: light cloud border gets a 2px-wider ink underlay; dark slots none', () => {
  const s = sampleSpec({ render: 'area', stroke: 'solid', arrow: false, color: 'blue', symmetric: false });
  assert.deepEqual(tags(s), ['path', 'path', 'path']);
  assert.equal(s.shapes[1].attrs.stroke, 'var(--mm-ink)');
  assert.equal(s.shapes[1].attrs['stroke-width'], 4);
  assert.equal(s.shapes[1].attrs.d, s.shapes[2].attrs.d);
  assert.equal(s.shapes[2].attrs.stroke, 'var(--mm-blue)');
  for (const c of ['purple', 'red', 'ink']) {
    const d = sampleSpec({ render: 'area', stroke: 'solid', arrow: true, color: c, symmetric: false });
    assert.ok(!d.shapes.some((x) => x.attrs.stroke === 'var(--mm-ink)' && c !== 'ink'), c);
  }
});
