import { query } from './db/pool';

export const SITE_THEMES = ['default', 'invulne'] as const;
export type SiteTheme = (typeof SITE_THEMES)[number];

export const DEFAULT_SITE_THEME: SiteTheme = 'default';
export const SITE_THEME_SETTING_KEY = 'globalTheme';

export const isSiteTheme = (value: unknown): value is SiteTheme =>
  typeof value === 'string' && SITE_THEMES.includes(value as SiteTheme);

export const normalizeSiteTheme = (value: unknown): SiteTheme =>
  isSiteTheme(value) ? value : DEFAULT_SITE_THEME;

const isMissingSiteSettingTable = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === '42P01');

export async function readGlobalSiteTheme(): Promise<SiteTheme> {
  const { data, error } = await query<{ value?: { theme?: unknown } | null }>(
    `SELECT "value" FROM "SiteSetting" WHERE "key" = $1 LIMIT 1`,
    [SITE_THEME_SETTING_KEY],
    0,
  );

  if (error) {
    if (isMissingSiteSettingTable(error)) return DEFAULT_SITE_THEME;
    throw error;
  }

  return normalizeSiteTheme(data?.[0]?.value?.theme);
}

export async function writeGlobalSiteTheme(theme: SiteTheme, updatedBy: string): Promise<SiteTheme> {
  const { data, error } = await query<{ value?: { theme?: unknown } | null }>(
    `INSERT INTO "SiteSetting" ("key", "value", "updatedBy", "updatedAt")
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT ("key") DO UPDATE SET
       "value" = EXCLUDED."value",
       "updatedBy" = EXCLUDED."updatedBy",
       "updatedAt" = EXCLUDED."updatedAt"
     RETURNING "value"`,
    [SITE_THEME_SETTING_KEY, JSON.stringify({ theme }), updatedBy],
    0,
  );

  if (error) throw error;
  return normalizeSiteTheme(data?.[0]?.value?.theme);
}
