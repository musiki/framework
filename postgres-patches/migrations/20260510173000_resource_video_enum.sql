-- Allow room resources to represent synchronized video in VS while the audio
-- stream is analyzed by SA/SV.

ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'video';
ALTER TYPE "ResourceSource" ADD VALUE IF NOT EXISTS 'vs';
