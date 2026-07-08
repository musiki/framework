export const centsToFreq = (baseFreq: number, cents: number): number => {
  return baseFreq * Math.pow(2, cents / 1200);
};

export const ratioToCents = (n: number, d: number): number => {
  if (n <= 0 || d <= 0) return 0;
  return 1200 * Math.log2(n / d);
};

export const midi12TetFreq = (midi: number): number => {
  return 440 * Math.pow(2, (midi - 69) / 12);
};

export const centsBetween = (freq: number, ref: number): number => {
  if (freq <= 0 || ref <= 0) return 0;
  return 1200 * Math.log2(freq / ref);
};
