import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const site = process.env.DOCS_SITE_URL || 'https://doc.musiki.org.ar';

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'Musiki Docs',
      description: 'Guías para estudiantes y docentes de Musiki.',
      favicon: '/favicon.svg',
      logo: {
        src: './src/assets/logo-musiki-docs.svg',
        alt: 'Musiki Docs',
      },
      customCss: ['./src/styles/musiki-docs.css'],
      defaultLocale: 'root',
      locales: {
        root: {
          label: 'Español',
          lang: 'es',
        },
      },
      social: [
        {
          icon: 'github',
          label: 'Musiki',
          href: 'https://musiki.org.ar',
        },
      ],
      sidebar: [
        {
          label: 'Empezar',
          items: [{ autogenerate: { directory: 'empezar' } }],
        },
        {
          label: 'Estudiantes',
          items: [{ autogenerate: { directory: 'estudiantes' } }],
        },
        {
          label: 'Docentes',
          items: [{ autogenerate: { directory: 'docentes' } }],
        },
        {
          label: 'Pods e instrumentos',
          items: [{ autogenerate: { directory: 'pods' } }],
        },
        {
          label: 'Presentaciones',
          items: [{ autogenerate: { directory: 'presentaciones' } }],
        },
        {
          label: 'Solución de problemas',
          items: [{ autogenerate: { directory: 'troubleshooting' } }],
        },
        {
          label: 'Referencia',
          items: [{ autogenerate: { directory: 'referencia' } }],
        },
      ],
    }),
  ],
});
