const DEFAULT_RUBRIC = [
  'Interpretación del texto y comprensión de ideas',
  'Claridad de tesis y coherencia argumental',
  'Calidad de evidencias y ejemplos',
  'Precisión del lenguaje académico',
  'Sugerencia de mejora concreta'
];

export function createCorrectionPrompt({ studentText, rubricText }) {
  const rubric = rubricText?.trim() || DEFAULT_RUBRIC.join('; ');

  return `Eres un asistente de corrección académica especializado en interpretación de textos.

Tu tarea: evaluar el texto de un estudiante y devolver SOLO JSON válido (sin markdown, sin comentarios, sin texto extra) con esta estructura exacta:
{
  "resumen": "string",
  "tesis": {
    "clara": true,
    "explicacion": "string"
  },
  "fortalezas": ["string", "string"],
  "debilidades": ["string", "string"],
  "sugerencia": "string",
  "calificacion": {
    "nota": 0,
    "justificacion": "string"
  }
}

Reglas:
- "resumen": breve y objetivo (1-3 oraciones).
- "tesis.clara": booleano estricto true/false.
- "fortalezas": exactamente 2 items concretos.
- "debilidades": exactamente 2 items concretos.
- "sugerencia": una acción puntual y aplicable.
- "calificacion.nota": número entre 0 y 10 (acepta decimal, ej. 7.5).
- "calificacion.justificacion": 1 oración breve explicando por qué esa nota.
- Evalúa con esta rúbrica base: ${rubric}

Texto del estudiante:
"""
${studentText}
"""`;
}
