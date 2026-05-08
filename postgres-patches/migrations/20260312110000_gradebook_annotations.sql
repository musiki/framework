create table if not exists public."GradebookAnnotation" (
  "id" uuid primary key default gen_random_uuid(),
  "courseId" text not null,
  "year" text not null,
  "subjectUserId" uuid references public."User" ("id") on delete set null,
  "field" text not null default '',
  "tab" text not null default 'overview',
  "scopeType" text not null check (
    "scopeType" in ('overview_cell', 'gradebook_cell', 'attendance_cell', 'admin_cell')
  ),
  "scopeRef" text not null,
  "color" text check (
    "color" is null or "color" in ('red', 'coral', 'orange', 'yellow', 'lime', 'green', 'cyan', 'blue')
  ),
  "comment" text not null default '',
  "visibility" text not null default 'teachers' check (
    "visibility" in ('private', 'teachers')
  ),
  "authorUserId" uuid not null references public."User" ("id") on delete cascade,
  "authorName" text not null default '',
  "authorEmail" text not null default '',
  "metadata" jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default timezone('utc', now()),
  "updatedAt" timestamptz not null default timezone('utc', now()),
  constraint "GradebookAnnotation_author_scope_unique"
    unique ("authorUserId", "courseId", "year", "scopeType", "scopeRef")
);

create index if not exists "GradebookAnnotation_course_year_updatedAt_idx"
  on public."GradebookAnnotation" ("courseId", "year", "updatedAt" desc);

create index if not exists "GradebookAnnotation_subjectUserId_updatedAt_idx"
  on public."GradebookAnnotation" ("subjectUserId", "updatedAt" desc);

create index if not exists "GradebookAnnotation_scope_idx"
  on public."GradebookAnnotation" ("scopeType", "scopeRef");

create index if not exists "GradebookAnnotation_authorUserId_updatedAt_idx"
  on public."GradebookAnnotation" ("authorUserId", "updatedAt" desc);

drop trigger if exists "GradebookAnnotation_touch_updated_at" on public."GradebookAnnotation";
create trigger "GradebookAnnotation_touch_updated_at"
before update on public."GradebookAnnotation"
for each row
execute function public.touch_livekit_updated_at();

alter table public."GradebookAnnotation" enable row level security;
