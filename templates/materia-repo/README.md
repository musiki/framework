# __SUBJECT_NAME__

This repo is the source of truth for the `__SUBJECT_NAME__` Obsidian vault and LMS content.

## Structure

- `cursos/` course-private material used by the LMS.
- `public/` public notes that require pull requests and editorial review.
- `draft/` incubator material, student submissions, and supporting resources.
- `.github/workflows/notify-platform-on-content-change.yml` dispatches updates to `__PLATFORM_OWNER__/__PLATFORM_REPO__`.

## Collaboration rules

- `public/**` only through pull requests.
- `cursos/**` can use direct pushes for day-to-day teaching work.
- `draft/**` is a staging area and does not publish directly.
- student contributions should arrive via PR and stay in `draft/estudiantes/**` until a teacher reviews them.
- Framework changes belong in `__PLATFORM_OWNER__/__PLATFORM_REPO__`, not here.

## GitHub setup

Add this repository secret:

- `PLATFORM_DISPATCH_TOKEN`: token allowed to trigger `repository_dispatch` on `__PLATFORM_OWNER__/__PLATFORM_REPO__`.

## Owners

- Teaching team: `__TEACHERS_TEAM__`
- Editorial team: `__EDITORIAL_TEAM__`
- Developers: `__DEVS_TEAM__`

## First tasks after scaffold

1. Replace the example course notes under `cursos/__COURSE_ID__/`.
2. Confirm `CODEOWNERS` matches your real GitHub teams.
3. Protect `main` with required reviews for `public/**`.
4. Register this repo as a source in the framework manifest.
