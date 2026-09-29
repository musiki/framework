import { mmRoute, json } from '../../../../lib/mm/api';
import { authorizeOwnerLibraries } from '../../../../lib/mm/forum';
import { BibliographyError, listOwnerLibraries } from '../../../../lib/mm/bibliography';

export const prerender = false;

// Curators/admins: the Seshat libraries owned by ?owner=<email> for the forum
// bibliography picker (optional ?q= filter). Same ownership rule as linking a
// forum bibliography: curators only for their own emails, admins any owner.
// `{ available: false }` when Seshat has no library listing (paste the id).
export const GET = mmRoute({ auth: true, tag: 'mm:admin:seshat-libraries' }, async ({ url }, { space, userId }) => {
  const ownerEmail = await authorizeOwnerLibraries({ spaceId: space.id, actorUserId: userId, ownerEmail: url.searchParams.get('owner') });
  try {
    const result = await listOwnerLibraries(ownerEmail, url.searchParams.get('q'));
    return json(result);
  } catch (err) {
    if (err instanceof BibliographyError) return json({ error: err.message }, err.status === 400 ? 400 : 502);
    throw err;
  }
});
