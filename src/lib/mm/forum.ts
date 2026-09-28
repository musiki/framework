// DB-bound wrapper for the mm forum core. Reads use the pool's retrying
// `query`; mutations that run a transaction (createThread, createPost) bind `q`
// to one pooled client via `onClient` (same pattern as concepts.ts). Post
// bodies render at read time with musiki's forum markdown (KaTeX, LilyPond,
// Seshat @citekey citations), sanitized, and cached per post version.

import { query } from '../db/pool';
import { renderForumMarkdown } from '../forum-markdown';
import { onClient } from './concepts';
import { createRenderCache } from './forum-render-cache.ts';
import * as core from './forum-core.ts';
import type { QueryFn } from './forum-core.ts';

export { ForumError, POST_MOVES, MODERATION_ACTIONS, VOTE_VALUES, publicSettings } from './forum-core.ts';
export type {
  ForumSummary, ForumAdminView, ForumSettings, ThreadSummary, ThreadView, PostView, PostMove, VoteCounts,
  ModerationAction,
} from './forum-core.ts';

const poolQ: QueryFn = (text, params) => query(text, params as any[]);

/**
 * musiki forum renderer for mm: ALWAYS sanitized (posts are public to
 * anonymous readers), remote LilyPond on as in the course forum UI, and cached
 * per post version (bounded LRU) so remote renders/MIDI lookups are not
 * repeated on every read.
 */
const mmRenderCache = createRenderCache((markdown) =>
  renderForumMarkdown(markdown, { remoteLilypond: true, sanitize: true }),
);
export const renderMmPost: core.Render = mmRenderCache.render;

export const listForums = (args: Parameters<typeof core.listForums>[1]) => core.listForums(poolQ, args);
export const getForum = (args: Parameters<typeof core.getForum>[1]) => core.getForum(poolQ, args);
export const listForumsAdmin = (args: Parameters<typeof core.listForumsAdmin>[1]) => core.listForumsAdmin(poolQ, args);
export const createForum = (args: Parameters<typeof core.createForum>[1]) => core.createForum(poolQ, args);
export const updateForum = (args: Parameters<typeof core.updateForum>[1]) => core.updateForum(poolQ, args);
export const listThreads = (args: Parameters<typeof core.listThreads>[1]) => core.listThreads(poolQ, args);
export const listPosts = (args: Omit<Parameters<typeof core.listPosts>[1], 'render'>) =>
  core.listPosts(poolQ, { ...args, render: renderMmPost });
export const vote = (args: Parameters<typeof core.vote>[1]) => core.vote(poolQ, args);
export const moderatePost = (args: Parameters<typeof core.moderatePost>[1]) => core.moderatePost(poolQ, args);

export const createThread = (args: Parameters<typeof core.createThread>[1]) =>
  onClient((q) => core.createThread(q, args));
export const createPost = (args: Parameters<typeof core.createPost>[1]) => onClient((q) => core.createPost(q, args));
