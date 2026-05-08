create table if not exists public."LiveRoomInvite" (
  "id" uuid primary key default gen_random_uuid(),
  "code" text not null unique,
  "room" text not null,
  "inviteType" text not null default 'external' check ("inviteType" in ('external', 'student')),
  "courseId" text,
  "pageSlug" text,
  "presentationHref" text,
  "displayName" text,
  "requiresPassword" boolean not null default false,
  "passwordHash" text,
  "createdByUserId" uuid references public."User" ("id") on delete set null,
  "expiresAt" timestamptz,
  "isActive" boolean not null default true,
  "metadata" jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default timezone('utc', now()),
  "updatedAt" timestamptz not null default timezone('utc', now()),
  constraint "LiveRoomInvite_password_required_check" check (
    not "requiresPassword" or coalesce(length("passwordHash"), 0) > 0
  )
);

create index if not exists "LiveRoomInvite_code_idx"
  on public."LiveRoomInvite" ("code");

create index if not exists "LiveRoomInvite_room_inviteType_updatedAt_idx"
  on public."LiveRoomInvite" ("room", "inviteType", "updatedAt" desc);

create index if not exists "LiveRoomInvite_courseId_updatedAt_idx"
  on public."LiveRoomInvite" ("courseId", "updatedAt" desc);

create index if not exists "LiveRoomInvite_createdByUserId_updatedAt_idx"
  on public."LiveRoomInvite" ("createdByUserId", "updatedAt" desc);

drop trigger if exists "LiveRoomInvite_touch_updated_at" on public."LiveRoomInvite";
create trigger "LiveRoomInvite_touch_updated_at"
before update on public."LiveRoomInvite"
for each row
execute function public.touch_livekit_updated_at();

alter table public."LiveRoomInvite" enable row level security;
