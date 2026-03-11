-- Native forum schema for Astro + Supabase LMS
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists "ForumBoard" (
  "id" uuid primary key default gen_random_uuid(),
  "courseId" text not null,
  "slug" text not null,
  "title" text not null,
  "description" text,
  "createdByUserId" uuid not null references "User"("id") on delete cascade,
  "isDefault" boolean not null default false,
  "isArchived" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "ForumBoard_course_slug_unique" unique ("courseId", "slug")
);

create table if not exists "ForumThread" (
  "id" uuid primary key default gen_random_uuid(),
  "courseId" text not null,
  "lessonSlug" text not null,
  "title" text not null,
  "createdByUserId" uuid not null references "User"("id") on delete cascade,
  "isPinned" boolean not null default false,
  "isLocked" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "archivedAt" timestamptz
);

create table if not exists "ForumPost" (
  "id" uuid primary key default gen_random_uuid(),
  "threadId" uuid not null references "ForumThread"("id") on delete cascade,
  "authorUserId" uuid not null references "User"("id") on delete cascade,
  "parentPostId" uuid references "ForumPost"("id") on delete set null,
  "body" text not null,
  "status" text not null default 'published',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "ForumPost_status_check" check ("status" in ('published', 'hidden', 'deleted'))
);

create table if not exists "ForumPostVote" (
  "id" uuid primary key default gen_random_uuid(),
  "postId" uuid not null references "ForumPost"("id") on delete cascade,
  "userId" uuid not null references "User"("id") on delete cascade,
  "value" smallint not null check ("value" in (1, 2, 3)),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "ForumPostVote_post_user_unique" unique ("postId", "userId")
);

-- Normalize/upgrade reaction constraint for existing projects.
-- 1 = Útil, 2 = Aclara, 3 = Referencia valiosa.
do $$
declare
  existing_constraint text;
begin
  if to_regclass('"ForumPostVote"') is null then
    return;
  end if;

  -- Ensure reruns never fail if the named constraint already exists.
  alter table "ForumPostVote"
    drop constraint if exists "ForumPostVote_value_check";

  for existing_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = '"ForumPostVote"'::regclass
      and c.contype = 'c'
      and lower(pg_get_constraintdef(c.oid)) like '%value%'
  loop
    execute format('alter table "ForumPostVote" drop constraint if exists %I', existing_constraint);
  end loop;

  delete from "ForumPostVote"
  where "value" not in (1, 2, 3);

  alter table "ForumPostVote"
    add constraint "ForumPostVote_value_check" check ("value" in (1, 2, 3));
end;
$$;

create index if not exists "ForumThread_course_lesson_idx"
  on "ForumThread" ("courseId", "lessonSlug");

create index if not exists "ForumBoard_course_idx"
  on "ForumBoard" ("courseId");

create index if not exists "ForumBoard_course_archived_idx"
  on "ForumBoard" ("courseId", "isArchived");

create index if not exists "ForumThread_updated_idx"
  on "ForumThread" ("updatedAt" desc);

create index if not exists "ForumPost_thread_created_idx"
  on "ForumPost" ("threadId", "createdAt");

create index if not exists "ForumPost_parent_idx"
  on "ForumPost" ("parentPostId");

create index if not exists "ForumPostVote_post_idx"
  on "ForumPostVote" ("postId");

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

drop trigger if exists "ForumThread_touch_updated_at" on "ForumThread";
create trigger "ForumThread_touch_updated_at"
before update on "ForumThread"
for each row execute function public.touch_updated_at();

drop trigger if exists "ForumBoard_touch_updated_at" on "ForumBoard";
create trigger "ForumBoard_touch_updated_at"
before update on "ForumBoard"
for each row execute function public.touch_updated_at();

drop trigger if exists "ForumPost_touch_updated_at" on "ForumPost";
create trigger "ForumPost_touch_updated_at"
before update on "ForumPost"
for each row execute function public.touch_updated_at();

drop trigger if exists "ForumPostVote_touch_updated_at" on "ForumPostVote";
create trigger "ForumPostVote_touch_updated_at"
before update on "ForumPostVote"
for each row execute function public.touch_updated_at();

alter table "ForumBoard" enable row level security;
alter table "ForumThread" enable row level security;
alter table "ForumPost" enable row level security;
alter table "ForumPostVote" enable row level security;

-- NOTE:
-- This project currently queries Supabase with service-role key from server routes.
-- Service-role bypasses RLS. These policies are for future direct client access.

drop policy if exists "forum_thread_select" on "ForumThread";
create policy "forum_thread_select"
on "ForumThread"
for select
using (
  exists (
    select 1
    from "User" u
    where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (
        u.role = 'teacher'
        or exists (
          select 1
          from "Enrollment" e
          where e."userId" = u.id
            and e."courseId" = "ForumThread"."courseId"
        )
      )
  )
);

drop policy if exists "forum_board_select" on "ForumBoard";
create policy "forum_board_select"
on "ForumBoard"
for select
using (
  exists (
    select 1
    from "User" u
    where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (
        u.role = 'teacher'
        or exists (
          select 1
          from "Enrollment" e
          where e."userId" = u.id
            and e."courseId" = "ForumBoard"."courseId"
        )
      )
  )
);

drop policy if exists "forum_board_insert_teacher" on "ForumBoard";
create policy "forum_board_insert_teacher"
on "ForumBoard"
for insert
with check (
  exists (
    select 1
    from "User" u
    where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.id = "ForumBoard"."createdByUserId"
      and u.role = 'teacher'
  )
);

drop policy if exists "forum_board_update_teacher" on "ForumBoard";
create policy "forum_board_update_teacher"
on "ForumBoard"
for update
using (
  exists (
    select 1
    from "User" u
    where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.role = 'teacher'
  )
);

drop policy if exists "forum_thread_insert" on "ForumThread";
create policy "forum_thread_insert"
on "ForumThread"
for insert
with check (
  exists (
    select 1
    from "User" u
    where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.id = "ForumThread"."createdByUserId"
      and (
        u.role = 'teacher'
        or exists (
          select 1
          from "Enrollment" e
          where e."userId" = u.id
            and e."courseId" = "ForumThread"."courseId"
        )
      )
  )
);

drop policy if exists "forum_thread_update_teacher" on "ForumThread";
create policy "forum_thread_update_teacher"
on "ForumThread"
for update
using (
  exists (
    select 1
    from "User" u
    where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.role = 'teacher'
  )
);

drop policy if exists "forum_post_select" on "ForumPost";
create policy "forum_post_select"
on "ForumPost"
for select
using (
  exists (
    select 1
    from "ForumThread" t
    where t.id = "ForumPost"."threadId"
      and exists (
        select 1
        from "User" u
        where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and (
            u.role = 'teacher'
            or exists (
              select 1
              from "Enrollment" e
              where e."userId" = u.id
                and e."courseId" = t."courseId"
            )
          )
      )
  )
);

drop policy if exists "forum_post_insert" on "ForumPost";
create policy "forum_post_insert"
on "ForumPost"
for insert
with check (
  exists (
    select 1
    from "ForumThread" t
    join "User" u on u.id = "ForumPost"."authorUserId"
    where t.id = "ForumPost"."threadId"
      and lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (
        u.role = 'teacher'
        or exists (
          select 1
          from "Enrollment" e
          where e."userId" = u.id
            and e."courseId" = t."courseId"
        )
      )
  )
);

drop policy if exists "forum_post_update_owner_or_teacher" on "ForumPost";
create policy "forum_post_update_owner_or_teacher"
on "ForumPost"
for update
using (
  exists (
    select 1
    from "User" u
    where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (
        u.id = "ForumPost"."authorUserId"
        or u.role = 'teacher'
      )
  )
);

drop policy if exists "forum_post_vote_select" on "ForumPostVote";
create policy "forum_post_vote_select"
on "ForumPostVote"
for select
using (
  exists (
    select 1
    from "ForumPost" p
    join "ForumThread" t on t.id = p."threadId"
    where p.id = "ForumPostVote"."postId"
      and exists (
        select 1
        from "User" u
        where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and (
            u.role = 'teacher'
            or exists (
              select 1
              from "Enrollment" e
              where e."userId" = u.id
                and e."courseId" = t."courseId"
            )
          )
      )
  )
);

drop policy if exists "forum_post_vote_insert" on "ForumPostVote";
create policy "forum_post_vote_insert"
on "ForumPostVote"
for insert
with check (
  exists (
    select 1
    from "ForumPost" p
    join "ForumThread" t on t.id = p."threadId"
    join "User" u on u.id = "ForumPostVote"."userId"
    where p.id = "ForumPostVote"."postId"
      and lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (
        u.role = 'teacher'
        or exists (
          select 1
          from "Enrollment" e
          where e."userId" = u.id
            and e."courseId" = t."courseId"
        )
      )
  )
);

drop policy if exists "forum_post_vote_update_owner" on "ForumPostVote";
create policy "forum_post_vote_update_owner"
on "ForumPostVote"
for update
using (
  exists (
    select 1
    from "User" u
    where u.id = "ForumPostVote"."userId"
      and lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
)
with check (
  exists (
    select 1
    from "User" u
    where u.id = "ForumPostVote"."userId"
      and lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

drop policy if exists "forum_post_vote_delete_owner" on "ForumPostVote";
create policy "forum_post_vote_delete_owner"
on "ForumPostVote"
for delete
using (
  exists (
    select 1
    from "User" u
    where u.id = "ForumPostVote"."userId"
      and lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);
