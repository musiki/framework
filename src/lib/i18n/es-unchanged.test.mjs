import test from 'node:test';
import assert from 'node:assert/strict';
import { t } from './index.ts';

// Guard for the hem-instance localization: every screen string moved to t()
// must render on musiki (locale es) exactly as the literal it replaced.
// Rows: [key, previous Spanish literal] or [key, vars, previous rendered literal].
const ROWS = [
  ["header.about", "Acerca"],
  ["header.dashboard", "Dashboard"],
  ["header.courses", "Cursos"],
  ["header.goTo", {"name": "Armonía I"}, "Ir a Armonía I"],
  ["header.goToCourses", "Ir a Cursos"],
  ["header.openCoursesSelector", "Abrir selector de cursos"],
  ["header.openCoursesSelectorActive", {"name": "Armonía I"}, "Abrir selector de cursos. Curso activo: Armonía I"],
  ["header.openForums", "Abrir foros"],
  ["header.forum", "Foro"],
  ["header.openPresentation", "Abrir presentacion"],
  ["header.liveInteraction", "Abrir interacción en vivo"],
  ["header.openRoom", "Abrir sala performativa"],
  ["header.onlineUsers", "Usuarios online"],
  ["header.knowledgeGraph", "Mostrar grafo de conocimiento"],
  ["header.toggleTheme", "Toggle theme"],
  ["header.pageInfo", "Mostrar informacion de la pagina"],
  ["header.account", "Cuenta"],
  ["header.notes", "Notas"],
  ["header.signOut", "Cerrar Sesión"],
  ["header.login", "Login"],
  ["ribbon.home", "Inicio"],
  ["ribbon.homeLabel", {"name": "musiki26"}, "musiki26 — inicio"],
  ["ribbon.activitySoon", "Actividad (próximamente)"],
  ["ribbon.changeTheme", "Cambiar tema"],
  ["ribbon.changeThemeTitle", "Cambiar tema claro/oscuro"],
  ["ribbon.infoMetadata", "Info y metadatos"],
  ["ribbon.infoTitle", "Info (⌘/Ctrl + i)"],
  ["ribbon.progressPath", "Progreso del recorrido"],
  ["ribbon.progressTitle", "Progreso (recorrido)"],
  ["ribbon.openCentauro", "Abrir Centauro (Microafinación)"],
  ["ribbon.myCourses", "Mis cursos"],
  ["ribbon.myCoursesActive", {"code": "ARM1"}, "Mis cursos — curso activo: ARM1"],
  ["ribbon.myCoursesHeader", "Mis Cursos"],
  ["ribbon.noActiveCourses", "No tienes cursos activos"],
  ["ribbon.viewAllCourses", "Ver todos los cursos"],
  ["ribbon.about", {"name": "musiki26"}, "Acerca de musiki26"],
];

test('es: localized screen strings equal the Spanish literals they replaced', () => {
  for (const row of ROWS) {
    const [key, vars, expected] = row.length === 3 ? row : [row[0], undefined, row[1]];
    assert.equal(t('es', key, vars), expected, key);
  }
});

test('fr: every localized screen key has a French string', async () => {
  const { fr } = await import('./fr.ts');
  for (const [key] of ROWS) {
    const value = key.split('.').reduce((node, part) => node?.[part], fr);
    assert.equal(typeof value, 'string', `missing fr: ${key}`);
  }
});
