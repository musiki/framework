import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        audience: z.enum(['student', 'teacher', 'admin', 'all']).default('all'),
        area: z.string().optional(),
        featureStatus: z.enum(['stable', 'beta', 'experimental']).default('stable'),
        lastVerified: z.coerce.string().optional(),
      }),
    }),
  }),
};
