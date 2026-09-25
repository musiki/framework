import type { LangPack } from './index.ts';

export const es: LangPack = {
  lang: 'es',
  stopwords: new Set([
    'para', 'como', 'pero', 'más', 'con', 'que', 'una', 'uno', 'los', 'las',
    'del', 'este', 'esta', 'esto', 'desde', 'hasta', 'sobre', 'entre', 'cuando',
    'donde', 'puede', 'tiene', 'también', 'además', 'porque', 'aunque', 'según',
    'todos', 'todas', 'todo', 'bien', 'hacer', 'tener', 'haber', 'siendo', 'están',
    'estar', 'había', 'será', 'mismo', 'misma', 'mismos', 'mismas', 'ante', 'bajo',
    'cada', 'casi', 'cierto', 'contra', 'cual', 'cuya', 'dado', 'debe', 'deben',
    'ella', 'ellas', 'ellos', 'embargo', 'esas', 'esos', 'gran', 'hacia', 'incluso',
    'junto', 'lado', 'largo', 'lugar', 'manera', 'mayor', 'mediante', 'mejor',
    'menor', 'menos', 'mientras', 'modo', 'ninguna', 'ninguno', 'otras', 'otros',
    'otra', 'otro', 'pues', 'parte', 'poco', 'primer', 'primera', 'propio', 'propia',
    'sino', 'solo', 'sola', 'tanto', 'tipo', 'toda', 'tras', 'unos', 'unas',
    'varios', 'veces', 'forma', 'nivel', 'dicho', 'dicha', 'aquí', 'allí', 'ahora',
    'antes', 'después', 'siempre', 'nunca', 'algo', 'algún', 'alguna', 'algunos',
    'algunas', 'nada', 'nadie', 'mucho', 'bastante', 'demasiado', 'través',
  ]),
  connectors: [
    'sin embargo', 'pero', 'por lo tanto', 'en consecuencia', 'por ejemplo',
    'así', 'entonces', 'además', 'no obstante', 'por ende', 'en cambio',
    'cuando', 'al final', 'mientras', 'luego', 'después',
  ],
};
