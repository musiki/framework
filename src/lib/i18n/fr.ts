import type { Dict, DeepPartial } from './en.ts';

// Français, taken from the hem fork (src/locales/fr.ts) and mapped onto the
// engine's keys by meaning. Partial: keys without a French string fall back to
// English in t(). Fork strings with no engine key yet are added with their
// keys in the hem-instance UI task. The mm namespace is English/Bokmål only.

export const fr: DeepPartial<Omit<Dict, 'mm'>> = {
  studio: {
    tree: {
      rename: 'Renommer',
      delete: 'Supprimer',
      loading: 'Chargement…',
    },
    signIn: 'Se connecter',
    signOut: 'Se déconnecter',
    access: {
      remove: 'Retirer',
    },
  },
  editor: {
    loading: 'Chargement…',
    commentsTitle: 'Commentaires',
    cancelBtn: 'Annuler',
  },
  header: {
    about: 'À propos',
    dashboard: 'Tableau de bord',
    courses: 'Cours',
    goTo: 'Aller à {name}',
    goToCourses: 'Aller aux cours',
    openCoursesSelector: 'Ouvrir le sélecteur de cours',
    openCoursesSelectorActive: 'Ouvrir le sélecteur de cours. Cours actif : {name}',
    openForums: 'Ouvrir les forums',
    forum: 'Forum',
    openPresentation: 'Ouvrir la présentation',
    liveInteraction: 'Ouvrir l’interaction en direct',
    openRoom: 'Ouvrir la salle performative',
    onlineUsers: 'Utilisateurs en ligne',
    knowledgeGraph: 'Afficher le graphe de connaissances',
    toggleTheme: 'Changer le thème',
    pageInfo: 'Afficher les informations de la page',
    account: 'Compte',
    notes: 'Mes notes',
    signOut: 'Se déconnecter',
    login: 'Connexion',
  },
  ribbon: {
    home: 'Accueil',
    homeLabel: '{name} — accueil',
    activitySoon: 'Activité (bientôt disponible)',
    changeTheme: 'Changer le thème',
    changeThemeTitle: 'Changer le thème clair/sombre',
    infoMetadata: 'Infos et métadonnées',
    infoTitle: 'Infos (⌘/Ctrl + i)',
    progressPath: 'Progression du parcours',
    progressTitle: 'Progression (parcours)',
    openCentauro: 'Ouvrir Centauro (micro-accordage)',
    myCourses: 'Mes cours',
    myCoursesActive: 'Mes cours — cours actif : {code}',
    myCoursesHeader: 'Mes cours',
    noActiveCourses: 'Vous n’avez pas de cours actifs',
    viewAllCourses: 'Voir tous les cours',
    about: 'À propos de {name}',
  },
};
