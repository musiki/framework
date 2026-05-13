-- Allow room resources to represent PowerPoint files opened in VS.

ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'pptx';
