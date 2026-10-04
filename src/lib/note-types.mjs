import { z } from "astro/zod";

/** Note types with dedicated behaviour in the engine. */
export const courseNoteTypes = [
	"course",
	"lesson",
	"assignment",
	"eval",
	"lesson-presentation",
	"app-dataviewjs",
	"public-note",
	"latex-template",
	"info",
	"concept",
	"glossary",
];

/**
 * Frontmatter `type`: a known note type, or any other non-empty string
 * (vaults such as hem use note, work, person, hemworks, obra, code...).
 * Unknown types render as generic notes.
 */
export const noteTypeSchema = z.union([z.enum(courseNoteTypes), z.string().min(1)]);
