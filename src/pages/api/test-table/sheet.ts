import type { APIRoute } from 'astro';
import { getClient, query } from '../../../lib/db/pool';

type SheetRow = {
  id?: number | string | null;
  instrument?: string | null;
  family?: string | null;
  technique?: string | null;
  difficulty?: number | string | null;
  minutes?: number | string | null;
  active?: boolean | string | number | null;
  notes?: string | null;
  sortOrder?: number | string | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ensureSheetTable = async () => {
  const { error: tableError } = await query(`
    CREATE TABLE IF NOT EXISTS "SheetTestRow" (
      "id" SERIAL PRIMARY KEY,
      "instrument" TEXT NOT NULL DEFAULT '',
      "family" TEXT NOT NULL DEFAULT '',
      "technique" TEXT NOT NULL DEFAULT '',
      "difficulty" INTEGER NOT NULL DEFAULT 1,
      "minutes" NUMERIC(8, 2) NOT NULL DEFAULT 0,
      "active" BOOLEAN NOT NULL DEFAULT TRUE,
      "notes" TEXT NOT NULL DEFAULT '',
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  if (tableError) throw tableError;

  const { data: countRows, error: countError } = await query<{ count: string }>(
    'SELECT COUNT(*)::TEXT AS count FROM "SheetTestRow"'
  );
  if (countError) throw countError;

  if (Number(countRows?.[0]?.count || 0) > 0) return;

  const seedRows = [
    ['Clarinete', 'Vientos', 'Multifonico', 4, 12, true, 'Probar digitaciones estables'],
    ['Violin', 'Cuerdas', 'Sul ponticello', 3, 8, true, 'Entrada en bloque por seccion'],
    ['Piano', 'Teclados', 'Resonancia preparada', 5, 18, false, 'Fila editable desde la grilla'],
    ['Voz', 'Cuerpo', 'Sprechgesang', 2, 6, true, 'Copiar/pegar desde Sheets'],
    ['Percusion', 'Golpe', 'Rimshot granular', 3, 10, true, 'Arrastrar fill handle para repetir'],
  ];

  for (let index = 0; index < seedRows.length; index += 1) {
    const row = seedRows[index];
    const { error } = await query(
      `INSERT INTO "SheetTestRow"
       ("instrument", "family", "technique", "difficulty", "minutes", "active", "notes", "sortOrder")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [...row, index]
    );
    if (error) throw error;
  }
};

const selectRows = async () => {
  const { data, error } = await query(`
    SELECT
      "id",
      "instrument",
      "family",
      "technique",
      "difficulty",
      "minutes"::FLOAT AS "minutes",
      "active",
      "notes",
      "sortOrder",
      "updatedAt"
    FROM "SheetTestRow"
    ORDER BY "sortOrder" ASC, "id" ASC
  `);
  if (error) throw error;
  return data || [];
};

const textValue = (value: unknown) => String(value ?? '').trim();

const numberValue = (value: unknown, fallback: number) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanValue = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 't', 'yes', 'y', 'si', 'sí', 'on'].includes(normalized);
};

const numericId = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeIncomingRows = (value: unknown) => {
  const rows = Array.isArray(value) ? value : [];

  return rows
    .map((row, index) => {
      const record = (row || {}) as SheetRow;
      return {
        id: numericId(record.id),
        instrument: textValue(record.instrument),
        family: textValue(record.family),
        technique: textValue(record.technique),
        difficulty: Math.max(1, Math.min(5, Math.round(numberValue(record.difficulty, 1)))),
        minutes: Math.max(0, numberValue(record.minutes, 0)),
        active: booleanValue(record.active),
        notes: textValue(record.notes),
        sortOrder: Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : index,
      };
    })
    .filter((row) =>
      row.instrument || row.family || row.technique || row.notes || row.minutes > 0
    );
};

export const GET: APIRoute = async () => {
  try {
    await ensureSheetTable();
    return json({ rows: await selectRows(), source: 'postgres' });
  } catch (error: any) {
    console.error('[test-table] GET failed', error);
    return json({ error: error?.message || 'Failed to load sheet rows' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  let client: Awaited<ReturnType<typeof getClient>> | null = null;

  try {
    const body = await request.json().catch(() => ({}));
    const rows = normalizeIncomingRows(body?.rows);

    await ensureSheetTable();
    client = await getClient();
    await client.query('BEGIN');

    const keptIds = rows.map((row) => row.id).filter((id): id is number => Boolean(id));
    if (keptIds.length > 0) {
      await client.query('DELETE FROM "SheetTestRow" WHERE NOT ("id" = ANY($1::INT[]))', [keptIds]);
    } else {
      await client.query('DELETE FROM "SheetTestRow"');
    }

    for (const [index, row] of rows.entries()) {
      const values = [
        row.instrument,
        row.family,
        row.technique,
        row.difficulty,
        row.minutes,
        row.active,
        row.notes,
        index,
      ];

      if (row.id) {
        await client.query(
          `UPDATE "SheetTestRow"
           SET "instrument" = $1,
               "family" = $2,
               "technique" = $3,
               "difficulty" = $4,
               "minutes" = $5,
               "active" = $6,
               "notes" = $7,
               "sortOrder" = $8,
               "updatedAt" = NOW()
           WHERE "id" = $9`,
          [...values, row.id]
        );
      } else {
        await client.query(
          `INSERT INTO "SheetTestRow"
           ("instrument", "family", "technique", "difficulty", "minutes", "active", "notes", "sortOrder")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          values
        );
      }
    }

    await client.query('COMMIT');
    return json({ rows: await selectRows(), source: 'postgres' });
  } catch (error: any) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }
    console.error('[test-table] PATCH failed', error);
    return json({ error: error?.message || 'Failed to save sheet rows' }, 500);
  } finally {
    client?.release();
  }
};
