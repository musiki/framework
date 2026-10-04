import test from "node:test";
import assert from "node:assert/strict";
import { courseNoteTypes, noteTypeSchema } from "./note-types.mjs";

test("known note types still validate", () => {
	for (const t of courseNoteTypes) assert.equal(noteTypeSchema.parse(t), t);
});

test("unknown non-empty types (hem vault) validate", () => {
	for (const t of ["work", "note", "person", "hemworks", "obra", "code"]) {
		assert.equal(noteTypeSchema.parse(t), t);
	}
});

test("empty or non-string types are rejected", () => {
	assert.equal(noteTypeSchema.safeParse("").success, false);
	assert.equal(noteTypeSchema.safeParse(3).success, false);
	assert.equal(noteTypeSchema.optional().safeParse(undefined).success, true);
});
