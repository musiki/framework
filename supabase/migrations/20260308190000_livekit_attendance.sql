create extension if not exists pgcrypto;

create or replace function public.touch_livekit_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public."LiveKitWebhookEvent" (
  "eventId" text primary key,
  "eventName" text not null,
  "roomSid" text,
  "roomName" text,
  "courseId" text,
  "pageSlug" text,
  "participantSid" text,
  "participantIdentity" text,
  "participantName" text,
  "userId" uuid references public."User" ("id") on delete set null,
  "role" text not null default 'student' check ("role" in ('teacher', 'student')),
  "trackSid" text,
  "trackName" text,
  "createdAt" timestamptz not null,
  "payload" jsonb not null default '{}'::jsonb,
  "insertedAt" timestamptz not null default timezone('utc', now())
);

create index if not exists "LiveKitWebhookEvent_eventName_idx"
  on public."LiveKitWebhookEvent" ("eventName");

create index if not exists "LiveKitWebhookEvent_roomSid_idx"
  on public."LiveKitWebhookEvent" ("roomSid");

create index if not exists "LiveKitWebhookEvent_courseId_createdAt_idx"
  on public."LiveKitWebhookEvent" ("courseId", "createdAt" desc);

create table if not exists public."LiveClassSession" (
  "id" uuid primary key default gen_random_uuid(),
  "livekitRoomSid" text not null unique,
  "roomName" text not null,
  "courseId" text,
  "pageSlug" text,
  "teacherUserId" uuid references public."User" ("id") on delete set null,
  "startedAt" timestamptz not null,
  "lastEventAt" timestamptz not null,
  "finishedAt" timestamptz,
  "metadata" jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default timezone('utc', now()),
  "updatedAt" timestamptz not null default timezone('utc', now())
);

create index if not exists "LiveClassSession_courseId_startedAt_idx"
  on public."LiveClassSession" ("courseId", "startedAt" desc);

create index if not exists "LiveClassSession_pageSlug_startedAt_idx"
  on public."LiveClassSession" ("pageSlug", "startedAt" desc);

create index if not exists "LiveClassSession_teacherUserId_startedAt_idx"
  on public."LiveClassSession" ("teacherUserId", "startedAt" desc);

drop trigger if exists "LiveClassSession_touch_updated_at" on public."LiveClassSession";
create trigger "LiveClassSession_touch_updated_at"
before update on public."LiveClassSession"
for each row
execute function public.touch_livekit_updated_at();

create table if not exists public."LiveClassAttendance" (
  "id" uuid primary key default gen_random_uuid(),
  "sessionId" uuid not null references public."LiveClassSession" ("id") on delete cascade,
  "userId" uuid references public."User" ("id") on delete set null,
  "identity" text not null,
  "participantSid" text,
  "name" text,
  "role" text not null default 'student' check ("role" in ('teacher', 'student')),
  "courseId" text,
  "pageSlug" text,
  "firstJoinedAt" timestamptz,
  "lastJoinedAt" timestamptz,
  "lastLeftAt" timestamptz,
  "joinCount" integer not null default 0 check ("joinCount" >= 0),
  "leaveCount" integer not null default 0 check ("leaveCount" >= 0),
  "abortedCount" integer not null default 0 check ("abortedCount" >= 0),
  "lastStatus" text not null default 'pending' check (
    "lastStatus" in ('pending', 'joined', 'left', 'aborted', 'room_finished')
  ),
  "lastEventAt" timestamptz not null default timezone('utc', now()),
  "metadata" jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default timezone('utc', now()),
  "updatedAt" timestamptz not null default timezone('utc', now()),
  constraint "LiveClassAttendance_session_identity_key" unique ("sessionId", "identity")
);

create index if not exists "LiveClassAttendance_sessionId_idx"
  on public."LiveClassAttendance" ("sessionId");

create index if not exists "LiveClassAttendance_userId_lastEventAt_idx"
  on public."LiveClassAttendance" ("userId", "lastEventAt" desc);

create index if not exists "LiveClassAttendance_courseId_lastEventAt_idx"
  on public."LiveClassAttendance" ("courseId", "lastEventAt" desc);

create index if not exists "LiveClassAttendance_pageSlug_lastEventAt_idx"
  on public."LiveClassAttendance" ("pageSlug", "lastEventAt" desc);

drop trigger if exists "LiveClassAttendance_touch_updated_at" on public."LiveClassAttendance";
create trigger "LiveClassAttendance_touch_updated_at"
before update on public."LiveClassAttendance"
for each row
execute function public.touch_livekit_updated_at();

alter table public."LiveKitWebhookEvent" enable row level security;
alter table public."LiveClassSession" enable row level security;
alter table public."LiveClassAttendance" enable row level security;
