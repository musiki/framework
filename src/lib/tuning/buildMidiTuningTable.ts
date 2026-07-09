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

    // Closest standard 12-TET semitone relative to baseMidi
    const closestRelSemitone = Math.round(cents / 100);
    const closestMidi = spec.baseMidi + closestRelSemitone;
    
    // Deviation in cents from that closest standard semitone
    const centsFrom12TET = cents - closestRelSemitone * 100;

    table.push({
      midi,
      degree,
      cycle,
      cents,
      frequency,
      centsFrom12TET,
      closestMidi
    });
  }

  return table;
};
