// src/scripts/notas/qa-analyzer-logic.ts

export const STOPWORDS = new Set([
  // Spanish
  'de','la','el','en','y','a','que','del','los','las','un','una','por','con',
  'no','su','se','es','al','lo','más','pero','ya','fue','ser','ha','si','como',
  'hasta','me','mi','bien','cual','cuando','sin','sobre','también','entre',
  'uno','todo','esta','este','estos','estas','son','hay','está','para','nos',
  'muy','sus','así','aquí','porque','él','ella','ellos','les','eso','esto',
  'eran','era','estar','tiene','han','ni','le','te','tu','yo','eres','él',
  'nos','vos','tan','o','e','u','ante','bajo','cabe','contra','desde','durante',
  'hacia','mediante','salvo','según','tras','versus',
  // English
  'the','be','to','of','and','in','that','have','it','for','not','on','with',
  'he','as','you','do','at','this','but','his','by','from','they','we','say',
  'her','she','or','an','will','my','one','all','would','there','their','what',
  'so','up','out','if','about','who','get','which','go','me','when','make',
  'can','like','time','just','him','know','take','into','your','some','could',
  'them','see','other','than','then','now','look','only','come','its','over',
  'think','also','back','after','use','two','how','our','work','first','well',
  'way','even','new','want','because','any','these','give','day','most','us',
  'am','are','was','were','been','being','did','does','had','has','having',
  'is','than','then','too','very','s','t','don','should','now','ll','re','ve',
]);

export interface FrequencyEntry {
  word: string;
  count: number;
  pct: number; // count / maxCount * 100
}

export interface ZipfPoint {
  rank: number;
  word: string;
  count: number;
  expected: number;
}

export interface ZipfProfile {
  points: ZipfPoint[];
  tokenCount: number;
  vocabularySize: number;
  slope: number | null;
}

/** Returns top-N words by frequency, excluding stopwords and short tokens. */
export function computeFrequency(text: string, topN = 20): FrequencyEntry[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-záéíóúüñàèìòùâêîôûäëïöü'\w\s-]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));

  const freq = new Map<string, number>();
  for (const w of tokens) freq.set(w, (freq.get(w) ?? 0) + 1);

  const sorted = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  const max = sorted[0]?.[1] ?? 1;
  return sorted.map(([word, count]) => ({ word, count, pct: (count / max) * 100 }));
}

/** Builds a compact rank-frequency profile for a Zipf lens. */
export function computeZipfProfile(text: string, topN = 16): ZipfProfile {
  const frequencies = computeFrequency(text, Number.MAX_SAFE_INTEGER);
  const tokenCount = frequencies.reduce((sum, entry) => sum + entry.count, 0);
  const points = frequencies.slice(0, topN).map((entry, index) => ({
    rank: index + 1,
    word: entry.word,
    count: entry.count,
    expected: (frequencies[0]?.count ?? 0) / (index + 1),
  }));

  let slope: number | null = null;
  if (frequencies.length > 1) {
    const samples = frequencies.map((entry, index) => ({
      x: Math.log(index + 1),
      y: Math.log(entry.count),
    }));
    const meanX = samples.reduce((sum, sample) => sum + sample.x, 0) / samples.length;
    const meanY = samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length;
    const numerator = samples.reduce((sum, sample) => sum + ((sample.x - meanX) * (sample.y - meanY)), 0);
    const denominator = samples.reduce((sum, sample) => sum + ((sample.x - meanX) ** 2), 0);
    if (denominator > 0) slope = numerator / denominator;
  }

  return { points, tokenCount, vocabularySize: frequencies.length, slope };
}

export interface KwicLine {
  before: string;
  match: string;
  after: string;
}

/** Returns all KWIC (Key Word In Context) lines for a word in text. */
export function computeKwic(text: string, word: string, contextChars = 40): KwicLine[] {
  if (!word.trim()) return [];
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');
  const lines: KwicLine[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    lines.push({
      before: text.slice(Math.max(0, start - contextChars), start),
      match:  m[0],
      after:  text.slice(end, Math.min(text.length, end + contextChars)),
    });
  }
  return lines;
}
