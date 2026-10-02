// DB-bound wrapper for the mm forum core. Reads use the pool's retrying
// `query`; mutations that run a transaction (createThread, createPost) bind `q`
// to one pooled client via `onClient` (same pattern as concepts.ts). Post
// bodies render at read time with musiki's forum markdown (KaTeX, LilyPond,
// Seshat @citekey citations), sanitized, and cached per post version.

import { query } from '../db/pool';
import { onClient } from './concepts';
import { mmPostRenderCache, mmRendererFor } from './render.ts';
import type { MmLang } from './ui-lang.ts';
import * as core from './forum-core.ts';
import type { QueryFn } from './forum-core.ts';

export { ForumError, POST_MOVES, MODERATION_ACTIONS, VOTE_VALUES, publicSettings, isReservedChannelSlug } from './forum-core.ts';
export type {
  ForumSummary, ForumAdminView, ForumSettings, ThreadSummary, ThreadView, PostView, PostMove, VoteCounts,
  ModerationAction, ForumRef,
} from './forum-core.ts';

const poolQ: QueryFn = (text, params) => query(text, params as any[]);

/**
 * musiki forum renderer for mm (see render.ts / post-render.ts): ALWAYS
 * sanitized, no remote LilyPond, same-origin media only, `[@key]` citations
 * resolved against the post's forum bibliography, cached per forum + lang +
 * post version (bounded LRU).
 */
export const renderMmPost: core.Render = mmPostRenderCache.render;

export const listForums = (args: Parameters<typeof core.listForums>[1]) => core.listForums(poolQ, args);
export const getForum = (args: Parameters<typeof core.getForum>[1]) => core.getForum(poolQ, args);
export const getForumByPath = (args: Parameters<typeof core.getForumByPath>[1]) => core.getForumByPath(poolQ, args);
/** A forum by API reference: group slug or forum id (channels are addressed by id). */
export const getForumRef = (args: Parameters<typeof core.getForumRef>[1]) => core.getForumRef(poolQ, args);
export const authorizeOwnerLibraries = (args: Parameters<typeof core.authorizeOwnerLibraries>[1]) =>
  core.authorizeOwnerLibraries(poolQ, args);
export const listForumsAdmin = (args: Parameters<typeof core.listForumsAdmin>[1]) => core.listForumsAdmin(poolQ, args);
/** One transaction on one client (the root slug check runs under the concepts' slug lock). */
export const createForum = (args: Parameters<typeof core.createForum>[1]) => onClient((q) => core.createForum(q, args));
export const updateForum = (args: Parameters<typeof core.updateForum>[1]) => core.updateForum(poolQ, args);
export const reorderChannels = (args: Parameters<typeof core.reorderChannels>[1]) => core.reorderChannels(poolQ, args);
export const listThreads = (args: Parameters<typeof core.listThreads>[1]) => core.listThreads(poolQ, args);
/** `lang` picks the citation locale / references heading (default en). */
export const listPosts = ({ lang = 'en', ...args }: Omit<Parameters<typeof core.listPosts>[1], 'render'> & { lang?: MmLang }) =>
  core.listPosts(poolQ, { ...args, render: mmRendererFor(mmPostRenderCache, lang) });
export const vote = (args: Parameters<typeof core.vote>[1]) => core.vote(poolQ, args);
export const moderatePost = (args: Parameters<typeof core.moderatePost>[1]) => core.moderatePost(poolQ, args);
/** PATCH /api/mm/posts/<id>: author edit/delete or curator moderation (see core). */
export const patchPost = (args: Parameters<typeof core.patchPost>[1]) => core.patchPost(poolQ, args);
export const editPost = (args: Parameters<typeof core.editPost>[1]) => core.editPost(poolQ, args);
export const deleteOwnPost = (args: Parameters<typeof core.deleteOwnPost>[1]) => core.deleteOwnPost(poolQ, args);

export const createThread = (args: Parameters<typeof core.createThread>[1]) =>
  onClient((q) => core.createThread(q, args));
export const createPost = (args: Parameters<typeof core.createPost>[1]) => onClient((q) => core.createPost(q, args));
