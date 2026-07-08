import { centsToFreq } from './tuningMath';
import type { TuningSpec, MidiTuningRow } from '../../types/tuning';

export const buildMidiTuningTable = (spec: TuningSpec): MidiTuningRow[] => {
  const table: MidiTuningRow[] = [];
  const degreeCount = spec.degrees.length;

  for (let midi = 0; midi < 128; midi++) {
    const rel = midi - spec.baseMidi;
    const degree = ((rel % degreeCount) + degreeCount) % degreeCount;
    const cycle = Math.floor(rel / degreeCount);
    
    const cents = spec.degrees[degree].cents + cycle * spec.periodCents;
    const frequency = centsToFreq(spec.baseFreq, cents);

    // Standard 12-TET frequency for this MIDI note number
    const tet12Freq = 440 * Math.pow(2, (midi - 69) / 12);
    
    // Difference in cents from standard 12-TET for this MIDI note
    const centsFrom12TET = 1200 * Math.log2(frequency / tet12Freq);

    table.push({
      midi,
      degree,
      cycle,
      cents,
      frequency,
      centsFrom12TET
    });
  }

  return table;
};
