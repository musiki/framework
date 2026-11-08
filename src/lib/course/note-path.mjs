// Forma con la que la sidebar escribe la ruta de una nota dentro del curso:
// cada segmento sin acentos, en minúsculas y con guiones en vez de espacios
// ("03-organología/Introducción a la Organología" → "03-organologia/
// introduccion-a-la-organologia"). El router la acepta como alias de la ruta
// real del archivo; si cada lado la armara a su manera, los links de la
// sidebar volverían a caer en la portada del curso.
export function noteRelPathKey(relPath) {
  return String(relPath || '')
    .replace(/\.(md|mdx)$/i, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => seg.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').toLowerCase())
    .join('/');
}
