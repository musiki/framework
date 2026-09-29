import { mmRoute, json } from '../../../../lib/mm/api';
import { loadExport } from '../../../../lib/mm/export-core';

export const prerender = false;

// Public export (spec §8): Lab `concept_machine.json` shape + `forum` and `_nb`
// fields. Display names only — no emails, no user ids. Cacheable.
export const GET = mmRoute({ tag: 'mm:export' }, async (_ctx, { space, q }) =>
  json(await loadExport(q, space.id), 200, {
    'Cache-Control': 'public, max-age=300',
    'Access-Control-Allow-Origin': '*',
  }));
