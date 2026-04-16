# Note Types in Musiki

This document describes the different content types used in the Musiki platform, specifically within the `cursos` collection.

## Types of Content

| Type | Icon | Visibility | Description |
| :--- | :--- | :--- | :--- |
| `course` | - | Public/Enrolled | The main index file for a course (`_index.md`). |
| `lesson` | - | Public/Enrolled | A standard lesson or class note. |
| `assignment` | 📝 | Enrolled | A task or assignment that may require a submission. |
| `eval` | 📝 | Enrolled | An evaluative task, often with automated correction. |
| `info` | ℹ️ | Logged-in Only | A simple note listed in a chapter, restricted to logged-in users. |
| `lesson-presentation`| - | - | Presentation-specific content. |
| `app-dataviewjs` | - | - | Technical type for custom interactive logic. |
| `public-note` | - | Public | Note intended for wide public access. |

## Detailed Descriptions

### `info`
The `info` type is used for supplemental information or simple notes that should be organized within a course chapter but should not be accessible to anonymous visitors, even if the course itself is public.
- **Access Control:** Requires an active session (login). If an anonymous user tries to access it, they are redirected to the login page.
- **Navigation:** Appears in the course sidebar within its designated chapter only for logged-in users.
- **Visual Indicator:** Marked with an ℹ️ icon in the sidebar to distinguish it from standard lessons.

### `assignment` and `eval`
These types represent tasks that students need to perform.
- **Visual Indicator:** Marked with a 📝 icon.
- **Functionality:** `eval` usually contains interactive blocks that can be automatically graded or tracked.

### `public-note`
Used for content that should always be accessible to the public, regardless of course-level restrictions.

## Visibility and Status

Access to a note is determined by a combination of the `type` and the following frontmatter fields:

- **`visibility`**: 
  - `public`: Accessible to everyone (unless restricted by type like `info`).
  - `enrolled-only`: Requires the user to be logged in and enrolled in the course.
- **`status`**: Internal workflow status.
  - `draft` and `private`: Only visible to teachers and admins.
  - `published`, `approved`, etc.: Visible to students (and public if applicable).

## Configuration

The allowed types are defined in `src/content.config.ts` under the `courseNoteTypes` constant.
