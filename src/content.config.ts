import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const courseNoteTypes = [
	'course',
	'lesson',
	'assignment',
	'eval',
	'lesson-presentation',
	'app-dataviewjs',
	'public-note',
] as const;

const workflowStatuses = ['draft', 'review', 'approved', 'published', 'archived', 'nonshown'] as const;
const publicStatuses = ['draft', 'review', 'approved', 'deprecated'] as const;

const content = defineCollection({
		// Load markdown from src/content excluding blog and cursos explicitly.
		// Extglob-based exclusion was matching nested course paths unintentionally.
		loader: glob({
			base: './src/content',
			pattern: ['**/*.{md,mdx}', '!blog/**', '!cursos/**'],
		}),
	// Schema for Obsidian-based content - very flexible to handle various YAML frontmatter
	schema: z.object({
		tag: z.string().or(z.array(z.string())).optional().nullable(),
		title: z.string().optional().nullable(),
		subtitle: z.string().optional().nullable(),
		summary: z.string().optional().nullable(),
		author: z.string().or(z.array(z.string())).optional().nullable(),
		authors: z.string().or(z.array(z.string())).optional().nullable(),
		category: z.string().or(z.array(z.string())).optional().nullable(),
		publisher: z.string().optional().nullable(),
		totalPage: z.number().optional().nullable(),
		coverUrl: z.string().optional().nullable(),
		coverSmallUrl: z.string().optional().nullable(),
		publish: z.union([z.number(), z.string(), z.date()]).optional().nullable(),
		colabs: z.string().or(z.array(z.string())).optional().nullable(),
		description: z.string().optional().nullable(),
		link: z.string().optional().nullable(),
		isbn10: z.string().or(z.number()).optional().nullable(),
		isbn13: z.string().or(z.number()).optional().nullable(),
		slug: z.string().optional().nullable(),
		shortSlug: z.string().optional().nullable(),
		theme: z.string().optional().nullable(),
		slideTheme: z.string().optional().nullable(),
		revealTheme: z.string().optional().nullable(),
	}).passthrough(), // Allow any additional fields from Obsidian YAML
});

const cursos = defineCollection({
	// Load all course content
	loader: glob({ base: './src/content/cursos', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
			// Course index fields
			type: z.enum(courseNoteTypes).optional(),
			title: z.string(),
			subtitle: z.string().optional().nullable(),
			description: z.string().optional().nullable(),
			summary: z.string().optional().nullable(),
			// Allow one or many instructors while keeping backward compatibility.
			instructor: z.union([z.string(), z.array(z.string())]).optional().nullable(),
			instructors: z.union([z.string(), z.array(z.string())]).optional().nullable(),
			// Academic year in bachelor context (e.g. "1er año", 2).
			year: z.union([z.number(), z.string()]).optional().nullable(),
			// Stable course identifier used for routes, aliases, and integrations.
			id: z.string().optional().nullable(),
			// Legacy compatibility while old frontmatter migrates away from "code".
			code: z.string().optional().nullable(),
			// Legacy compatibility while frontmatter migrates.
			level: z.union([z.enum(['beginner', 'intermediate', 'advanced']), z.string()]).optional().nullable(),
			duration: z.string().optional().nullable(),
		public: z.boolean().optional().default(false),
		coverImage: z.string().optional().nullable(),
		tags: z.array(z.string()).optional().nullable(),
		
		// Lesson/Assignment fields
		chapter: z.string().optional().nullable(),
		order: z.number().optional().nullable(),
		assignment: z.boolean().optional().default(false),
		points: z.number().optional().nullable(),
		visibility: z.enum(['public', 'enrolled-only']).optional().nullable(),
		status: z.enum(workflowStatuses).optional().nullable(),
		public_status: z.enum(publicStatuses).optional().nullable(),
		public_path: z.string().optional().nullable(),
		slug: z.string().optional().nullable(),
		shortSlug: z.string().optional().nullable(),
		theme: z.string().optional().nullable(),
		slideTheme: z.string().optional().nullable(),
		revealTheme: z.string().optional().nullable(),
	}).passthrough(),
});

export const collections = { content, cursos };
