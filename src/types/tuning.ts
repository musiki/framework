export type TuningSource = 'cents' | 'ratios' | 'edo';

export type TuningDegree = {
  index: number;
  label: string;
  cents: number;
  ratio?: string;
  source: TuningSource;
};

export type TuningSpec = {
  name: string;
  sourceText: string;
  source: TuningSource;
  baseMidi: number;
  baseFreq: number;
  periodCents: number;
  degrees: TuningDegree[];
};

export type MidiTuningRow = {
  midi: number;
  degree: number;
  cycle: number;
  cents: number;
  frequency: number;
  centsFrom12TET: number;
  closestMidi: number;
  hejiAccidental?: string;
  hejiOffset?: number;
};
