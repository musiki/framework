import type { Dict } from './en.ts';

// Français, taken from the hem fork (src/locales/fr.ts) and mapped onto the
// engine's keys by meaning. Partial: keys without a French string fall back to
// English in t(). Fork strings with no engine key yet are added with their
// keys in the hem-instance UI task. The mm namespace is English/Bokmål only.
type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

export const fr: DeepPartial<Omit<Dict, 'mm'>> = {
  studio: {
    tree: {
      rename: 'Renommer',
      delete: 'Supprimer',
      loading: 'Chargement…',
    },
    signIn: 'Connexion',
    signOut: 'Se déconnecter',
    access: {
      remove: 'Supprimer',
    },
  },
  editor: {
    loading: 'Chargement…',
    commentsTitle: 'Commentaires',
    cancelBtn: 'Annuler',
  },
};
