import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HotTable } from '@handsontable/react-wrapper';
import type { HotTableRef } from '@handsontable/react-wrapper';
import { registerAllModules } from 'handsontable/registry';
import type Handsontable from 'handsontable';
import 'handsontable/styles/handsontable.css';
import 'handsontable/styles/ht-theme-main.css';

registerAllModules();

type SheetRow = {
  id?: number | string | null;
  instrument: string;
  family: string;
  technique: string;
  difficulty: number;
  minutes: number;
  active: boolean;
  notes: string;
  sortOrder?: number;
};

const API_URL = '/api/test-table/sheet';

const blankRow = (index: number): SheetRow => ({
  id: null,
  instrument: '',
  family: '',
  technique: '',
  difficulty: 1,
  minutes: 0,
  active: true,
  notes: '',
  sortOrder: index,
});

const isMeaningfulRow = (row: Partial<SheetRow> | null | undefined) => {
  if (!row) return false;
  return Boolean(
    String(row.instrument || '').trim()
    || String(row.family || '').trim()
    || String(row.technique || '').trim()
    || String(row.notes || '').trim()
    || Number(row.minutes || 0) > 0
  );
};

const normalizeRows = (rows: Partial<SheetRow>[]) =>
  rows
    .filter(isMeaningfulRow)
    .map((row, index) => ({
      id: row.id || null,
      instrument: String(row.instrument || ''),
      family: String(row.family || ''),
      technique: String(row.technique || ''),
      difficulty: Math.max(1, Math.min(5, Number(row.difficulty || 1))),
      minutes: Math.max(0, Number(row.minutes || 0)),
      active: Boolean(row.active),
      notes: String(row.notes || ''),
      sortOrder: index,
    }));

export default function PostgresSheet() {
  const hotRef = useRef<HotTableRef>(null);
  const saveTimerRef = useRef<number | null>(null);
  const suspendSaveRef = useRef(false);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [status, setStatus] = useState('Cargando Postgres...');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [selectionLabel, setSelectionLabel] = useState('Sin seleccion');
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<Handsontable.ColumnSettings[]>(() => [
    { data: 'instrument', type: 'text', width: 150 },
    { data: 'family', type: 'dropdown', source: ['Vientos', 'Cuerdas', 'Teclados', 'Cuerpo', 'Golpe', 'Electronica'], width: 130 },
    { data: 'technique', type: 'text', width: 170 },
    { data: 'difficulty', type: 'numeric', numericFormat: { pattern: '0' }, width: 95 },
    { data: 'minutes', type: 'numeric', numericFormat: { pattern: '0.00' }, width: 100 },
    { data: 'active', type: 'checkbox', width: 80 },
    { data: 'notes', type: 'text', width: 280 },
  ], []);

  const colHeaders = useMemo(() => [
    'Instrumento',
    'Familia',
    'Tecnica',
    'Dificultad',
    'Minutos',
    'Activo',
    'Notas',
  ], []);

  const pullTableRows = useCallback(() => {
    const sourceRows = hotRef.current?.hotInstance?.getSourceData() as Partial<SheetRow>[] | undefined;
    return normalizeRows(sourceRows || rows);
  }, [rows]);

  const loadRows = useCallback(async () => {
    setError(null);
    setStatus('Cargando Postgres...');

    try {
      const response = await fetch(API_URL);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'No se pudo cargar la tabla');

      const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
      suspendSaveRef.current = true;
      setRows(nextRows.length > 0 ? nextRows : [blankRow(0)]);
      window.setTimeout(() => {
        suspendSaveRef.current = false;
      }, 0);
      setStatus(`Postgres conectado: ${nextRows.length} filas`);
    } catch (loadError: any) {
      setError(loadError?.message || 'Error cargando datos');
      suspendSaveRef.current = true;
      setRows([blankRow(0), blankRow(1), blankRow(2)]);
      window.setTimeout(() => {
        suspendSaveRef.current = false;
      }, 0);
      setStatus('Modo local: API no disponible');
    }
  }, []);

  const saveRows = useCallback(async (nextRows = pullTableRows()) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(API_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: nextRows }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'No se pudo guardar');

      const persistedRows = Array.isArray(payload.rows) ? payload.rows : nextRows;
      suspendSaveRef.current = true;
      setRows(persistedRows.length > 0 ? persistedRows : [blankRow(0)]);
      window.setTimeout(() => {
        suspendSaveRef.current = false;
      }, 0);
      setLastSavedAt(new Date().toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }));
      setStatus(`Guardado en Postgres: ${persistedRows.length} filas`);
    } catch (saveError: any) {
      setError(saveError?.message || 'Error guardando datos');
      setStatus('Cambios sin guardar');
    } finally {
      setIsSaving(false);
    }
  }, [pullTableRows]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setStatus('Cambios pendientes...');
    saveTimerRef.current = window.setTimeout(() => {
      void saveRows();
    }, 650);
  }, [saveRows]);

  useEffect(() => {
    void loadRows();

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [loadRows]);

  const addRows = () => {
    const instance = hotRef.current?.hotInstance;
    if (!instance) return;
    instance.alter('insert_row_below', instance.countRows() - 1, 10);
    scheduleSave();
  };

  const resetDemo = async () => {
    const nextRows = [
      ['Clarinete', 'Vientos', 'Multifonico', 4, 12, true, 'Probar digitaciones estables'],
      ['Violin', 'Cuerdas', 'Sul ponticello', 3, 8, true, 'Entrada en bloque por seccion'],
      ['Piano', 'Teclados', 'Resonancia preparada', 5, 18, false, 'Fila editable desde la grilla'],
      ['Voz', 'Cuerpo', 'Sprechgesang', 2, 6, true, 'Copiar/pegar desde Sheets'],
      ['Percusion', 'Golpe', 'Rimshot granular', 3, 10, true, 'Arrastrar fill handle para repetir'],
    ].map((row, index) => ({
      id: null,
      instrument: String(row[0]),
      family: String(row[1]),
      technique: String(row[2]),
      difficulty: Number(row[3]),
      minutes: Number(row[4]),
      active: Boolean(row[5]),
      notes: String(row[6]),
      sortOrder: index,
    }));

    setRows(nextRows);
    await saveRows(nextRows);
  };

  const shouldIgnoreMutation = (source?: string) =>
    suspendSaveRef.current
    || source === 'loadData'
    || source === 'updateData'
    || source === 'auto';

  const afterChange = (_changes: Handsontable.CellChange[] | null, source: string) => {
    if (!_changes?.length || shouldIgnoreMutation(source)) return;
    scheduleSave();
  };

  const afterCreateRow = (_index: number, _amount: number, source?: string) => {
    if (shouldIgnoreMutation(source)) return;
    scheduleSave();
  };

  const afterRemoveRow = (_index: number, _amount: number, _removedRows?: number[], source?: string) => {
    if (shouldIgnoreMutation(source)) return;
    scheduleSave();
  };

  const afterRowMove = (_movedRows: number[], _finalIndex: number, _dropIndex: number | undefined, _movePossible: boolean, _orderChanged: boolean) => {
    scheduleSave();
  };

  return (
    <div className="sheet-shell">
      <div className="sheet-toolbar" aria-label="Controles de tabla">
        <div className="sheet-status" data-saving={isSaving ? 'true' : 'false'}>
          <strong>{isSaving ? 'Guardando...' : status}</strong>
          <span>{lastSavedAt ? `Ultimo guardado ${lastSavedAt}` : selectionLabel}</span>
        </div>
        <div className="sheet-actions">
          <button type="button" onClick={() => void saveRows()}>
            Guardar
          </button>
          <button type="button" onClick={addRows}>
            +10 filas
          </button>
          <button type="button" onClick={() => void loadRows()}>
            Recargar
          </button>
          <button type="button" onClick={() => void resetDemo()}>
            Reset
          </button>
        </div>
      </div>

      {error ? <div className="sheet-error">{error}</div> : null}

      <HotTable
        ref={hotRef}
        data={rows}
        columns={columns}
        colHeaders={colHeaders}
        rowHeaders={true}
        height="calc(100vh - 176px)"
        width="100%"
        stretchH="all"
        className="ht-theme-main"
        licenseKey="non-commercial-and-evaluation"
        contextMenu={true}
        dropdownMenu={true}
        filters={true}
        manualRowMove={true}
        manualColumnMove={true}
        manualColumnResize={true}
        manualRowResize={true}
        multiColumnSorting={true}
        copyPaste={true}
        fillHandle={{
          autoInsertRow: true,
        }}
        outsideClickDeselects={false}
        selectionMode="multiple"
        minSpareRows={1}
        undo={true}
        autoWrapRow={true}
        autoWrapCol={true}
        enterMoves={{ row: 1, col: 0 }}
        afterChange={afterChange}
        afterCreateRow={afterCreateRow}
        afterRemoveRow={afterRemoveRow}
        afterRowMove={afterRowMove}
        afterSelectionEnd={(row, col, row2, col2) => {
          const selectedRows = Math.abs(row2 - row) + 1;
          const selectedCols = Math.abs(col2 - col) + 1;
          setSelectionLabel(`${selectedRows} x ${selectedCols} seleccionado`);
        }}
      />
    </div>
  );
}
