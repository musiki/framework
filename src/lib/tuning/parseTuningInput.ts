import { ratioToCents } from './tuningMath';
import type { TuningSpec } from '../../types/tuning';

export const parseTuningInput = (source: string): TuningSpec => {
  const clean = source.trim();
  
  // Default spec
  const spec: TuningSpec = {
    name: '12-EDO',
    sourceText: clean,
    source: 'edo',
    baseMidi: 60,
    baseFreq: 261.6255653,
    periodCents: 1200,
    degrees: []
  };

  if (!clean) {
    throw new Error('La expresión de afinación está vacía.');
  }

  // 1. EDO: uN
  const edoMatch = clean.match(/^u(\d+)$/i);
  if (edoMatch) {
    const edo = parseInt(edoMatch[1], 10);
    if (edo < 2) {
      throw new Error('El EDO debe ser mayor o igual a 2.');
    }
    spec.name = `${edo}-EDO`;
    spec.source = 'edo';
    spec.degrees = Array.from({ length: edo }, (_, i) => ({
      index: i,
      label: `${i}\\${edo}`,
      cents: (i * 1200) / edo,
      source: 'edo'
    }));
    
    // Check EDO limits
    if (edo > 128) {
      console.warn('EDO superior a 128: la interfaz del teclado puede ser muy densa.');
    }

    return spec;
  }

  // 2. Custom lists: u{...}
  const listMatch = clean.match(/^u\s*\{([^}]+)\}/i);
  if (listMatch) {
    const content = listMatch[1].trim();
    const parts = content.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      throw new Error('La lista de afinación está vacía.');
    }

    const hasRatios = parts.some(p => p.includes('/'));
    const hasCents = parts.some(p => !p.includes('/') && !isNaN(parseFloat(p)));

    if (hasRatios && hasCents) {
      throw new Error('No se permite mezclar cents y razones en la misma afinación.');
    }

    if (hasRatios) {
      spec.source = 'ratios';
      const parsedRatios: Array<{ ratio: string; cents: number }> = [];
      for (const part of parts) {
        let n = 1;
        let d = 1;
        if (part.includes('/')) {
          const [nStr, dStr] = part.split('/');
          n = parseFloat(nStr);
          d = parseFloat(dStr);
        } else {
          n = parseFloat(part);
          d = 1;
        }

        if (isNaN(n) || isNaN(d) || n <= 0 || d <= 0) {
          throw new Error(`Razón inválida o negativa: "${part}"`);
        }
        parsedRatios.push({
          ratio: part,
          cents: ratioToCents(n, d)
        });
      }

      // Ensure 1/1 exists
      if (!parsedRatios.some(pr => pr.ratio === '1/1' || pr.cents === 0)) {
        parsedRatios.unshift({ ratio: '1/1', cents: 0 });
      }

      // Sort ascending by cents
      parsedRatios.sort((a, b) => a.cents - b.cents);

      // Check for 2/1 (or 1200 cents) period marker
      let periodCents = 1200;
      const last = parsedRatios[parsedRatios.length - 1];
      if (parsedRatios.length > 1 && (last.ratio === '2/1' || Math.abs(last.cents - 1200) < 0.01)) {
        periodCents = last.cents;
        parsedRatios.pop();
      }

      spec.periodCents = periodCents;
      spec.name = `Afinación Justa (${parsedRatios.length} grados)`;
      spec.degrees = parsedRatios.map((pr, idx) => ({
        index: idx,
        label: pr.ratio,
        cents: pr.cents,
        ratio: pr.ratio,
        source: 'ratios'
      }));
    } else {
      // Cents list
      spec.source = 'cents';
      const centsList = parts.map(p => parseFloat(p));
      if (centsList.some(isNaN)) {
        throw new Error('La lista contiene valores numéricos inválidos.');
      }

      if (!centsList.includes(0)) {
        centsList.unshift(0);
      }

      centsList.sort((a, b) => a - b);

      let periodCents = 1200;
      if (centsList.length > 1 && centsList[centsList.length - 1] === 1200) {
        periodCents = 1200;
        centsList.pop();
      }

      spec.periodCents = periodCents;
      spec.name = `Afinación Cent (${centsList.length} grados)`;
      spec.degrees = centsList.map((cents, idx) => ({
        index: idx,
        label: `${cents}c`,
        cents: cents,
        source: 'cents'
      }));
    }

    // Validation: Fewer than 2 degrees
    if (spec.degrees.length < 2) {
      throw new Error('La afinación debe tener al menos 2 grados.');
    }

    // Validation: Duplicate/near-duplicate degrees within 0.01 cents
    for (let i = 1; i < spec.degrees.length; i++) {
      if (spec.degrees[i].cents - spec.degrees[i - 1].cents < 0.01) {
        throw new Error(`Grados duplicados o casi idénticos detectados (diferencia menor a 0.01 cents) en el índice ${i}.`);
      }
    }

    return spec;
  }

  throw new Error('Sintaxis de afinación no reconocida. Use "u31" o "u{0 100 200...}".');
};
