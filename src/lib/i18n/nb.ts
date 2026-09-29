import type { Dict } from './en.ts';

// Norsk bokmål, only for the MishMash Concept Machine (tenant mm). Written by
// hand from the English source (mm-en.ts); drafted with an AI assistant and
// awaiting review by a Bokmål speaker. Keys missing elsewhere fall back to
// English in t(). Nynorsk readers get this dictionary (see src/lib/mm/ui-lang.ts).
export const nb: Pick<Dict, 'mm'> = {
  mm: {
    siteName: 'MishMash Concept Machine',
    shortName: 'Concept Machine',
    tagline: 'Et felles rom der nye begreper blir foreslått, diskutert, kombinert og sporet til de finner sin plass i felles bruk.',
    skip: 'Hopp til innholdet',
    nav: {
      label: 'Hovedmeny',
      forums: 'Forum',
      graph: 'Graf',
      about: 'Om',
      signIn: 'Logg inn',
      signOut: 'Logg ut',
      account: 'Logget inn som {name}',
    },
    lang: {
      label: 'Språk',
      en: 'English',
      nb: 'Norsk bokmål',
    },
    footer: {
      builtFor: 'Laget for MishMash-nettverket',
      wordmarkAlt: 'MishMash',
      lab: 'Concept Machine i MishMash Lab',
      privacy: 'Ingen sporing. Informasjonskapsler bare for innlogging og språk.',
    },
    home: {
      title: 'Begreper i emning',
      intro: 'Hvordan blir et nytt ord til et felles begrep? Her blir begreper foreslått, diskutert i forum, kombinert med eldre ideer og sporet til de finner sin plass i felles bruk, eller blir glemt.',
      howTitle: 'Slik fungerer det',
      howConcepts: 'Begreper har en definisjon, forfattere og kilder. En neologisme blir foreslått, er deretter under diskusjon, og blir til slutt innarbeidet når nettverket bruker den med en felles betydning.',
      howForums: 'Forum samler en lesning eller et spørsmål. Hvert innlegg kan angi hvilket grep det gjør: foreslår, kontrasterer, kombinerer, eksemplifiserer, problematiserer eller syntetiserer.',
      howCredit: 'Definisjoner har versjoner, og hver versjon krediterer forfatteren sin.',
      forumsTitle: 'Forum',
      forumsEmpty: 'Ingen forum er åpnet ennå. De vil bli listet her.',
      graphTitle: 'Begrepsgraf',
      graphLead: 'Se hvordan begrepene henger sammen: hvilke som er avledet av, kombinerer med eller står i kontrast til hvilke.',
      graphLink: 'Åpne grafen',
      joinTitle: 'Å delta',
      joinLead: 'Du trenger ingen konto for å lese. For å foreslå begreper og skrive innlegg logger du inn med GitHub eller en bekreftet e-postadresse, slik at hvert bidrag bærer navnet til den som skrev det.',
      joinLink: 'Logg inn for å delta',
      labTitle: 'Laget for MishMash-nettverket',
      labLead: 'Concept Machine er et eksperiment for MishMash senter for KI og kreativitet. Et statisk øyeblikksbilde og tankene bak finnes i MishMash Lab.',
      labLink: 'Les om det i MishMash Lab',
    },
    about: {
      title: 'Om',
      purposeTitle: 'Formål',
      purpose: 'I et forskningsnettverk blir begreper foreslått i møter, artikler og verksteder, deretter diskutert, kombinert med eldre ideer, og enten tatt i felles bruk eller glemt. Concept Machine gjør denne prosessen synlig: et sted for å foreslå begreper, diskutere dem med tydelig forfatterskap og spore hvordan hvert av dem oppstår.',
      statuses: 'Hvert begrep har en status: neologisme (foreslått), under diskusjon eller innarbeidet (brukt i nettverket med en felles betydning).',
      aiTitle: 'Bruk av KI',
      aiCode: 'Programvaren bak tjenesten er utviklet med en KI-assistent for koding og gjennomgått av forfatteren; assistenten er kreditert i commit-historikken.',
      aiTranslation: 'De norske (bokmål) grensesnittekstene er utarbeidet med en KI-assistent og venter på gjennomlesning av en som har bokmål som språk.',
      aiContent: 'Begreper, definisjoner og innlegg skrives av mennesker. Ingen KI skriver, endrer eller oversetter dem. Hvis KI-forslag legges til senere, blir de merket som KI og kommer bare med når en person godtar dem.',
      aiPhilosophy: 'Dette følger MishMash sin nettfilosofi: bruk av KI blir opplyst, og mennesker står ansvarlige for det som publiseres.',
      aiPhilosophyLink: 'MishMash sin nettfilosofi',
      privacyTitle: 'Personvern',
      privacyTracking: 'Det er ingen sporing og ingen analyseverktøy. Sidene henter ingenting fra andre nettsteder: skrifttyper og bilder leveres herfra.',
      privacyCookies: 'Informasjonskapsler brukes bare til innlogging og for å huske språket ditt (mm-lang).',
      privacyData: 'Når du logger inn, lagres navnet og e-postadressen din for å styre tilgang. Bidragene dine publiseres under visningsnavnet ditt. E-postadresser blir aldri vist eller eksportert.',
      languagesTitle: 'Språk',
      languages: 'Engelsk er kildespråket. Begreper kan også ha en definisjon på bokmål, skrevet for hånd; ingenting maskinoversettes. Lesere med nynorsk ser grensesnittet på bokmål.',
    },
    join: {
      title: 'Logg inn',
      lead: 'Logg inn for å foreslå begreper, skrive i forumene og stemme. Du trenger ingen konto for å lese.',
      how: 'Innloggingen går gjennom innloggingstjenesten vår, der du kan bruke GitHub eller en bekreftet e-postadresse.',
      button: 'Logg inn',
      signedIn: 'Du er logget inn som {name}.',
      toForums: 'Gå til forumene',
      privacy: 'Innlogging setter bare de informasjonskapslene som trengs for økten.',
      errors: {
        accessDenied: 'Denne kontoen har ikke tilgang ennå. Be en kurator om en invitasjon.',
        generic: 'Innloggingen mislyktes. Prøv igjen.',
      },
    },
    notFound: {
      title: 'Fant ikke siden',
      lead: 'Denne siden finnes ikke.',
      home: 'Tilbake til Concept Machine',
    },
  },
};
