```lily
\version "2.25.80"

\paper {
  indent = 0
  tagline = ##f
}

#(set-global-staff-size 16)

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%% 1. Cabeza circular blanca
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

circleHead =
#(lambda (grob)
   (grob-interpret-markup grob
    #{
      \markup
      \with-dimensions #'(-0.2 . 0.2) #'(-0.2 . 0.2)
      \postscript #"
        newpath
        0 0 0.82 0 360 arc
        closepath
        1 setgray fill
        newpath
        0 0 0.82 0 360 arc
        0 setgray
        0.10 setlinewidth
        stroke
      "
    #}))

circle = \override NoteHead.stencil = #circleHead

nhRombus =
#(lambda (grob)
   (grob-interpret-markup grob
    #{
      \markup
      \with-dimensions #'(-0.9 . 0.9) #'(-0.9 . 0.9)
      \postscript #"
        gsave
        0 0.6 0 setrgbcolor
        newpath
        0 0.8 moveto
        0.8 0 lineto
        0 -.8 lineto
        -0.8 0 lineto
        closepath
        fill
        grestore
      "
    #}))

romb = {
  \override NoteHead.stencil = #nhRombus
  \override NoteHead.stem-attachment =
   #(lambda (grob) (if (= (ly:grob-property grob 'direction 1) 1) '(0.9 . 0) '(-0.9 . 0)))
}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%% 2. Marca vertical de grilla
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

gridTickMarkup = \markup
  \with-dimensions #'(0 . 0) #'(0 . 0)
  \postscript #"
    gsave
    0 setgray
    0.18 setlinewidth
    [0.18 0.42] 0 setdash
    newpath
    0 0.6 moveto
    0 5.9 lineto
    stroke
    grestore
  "

gridTick =
#(define-event-function () ()
   #{
     -\tweak self-alignment-X #CENTER
     -\tweak outside-staff-priority ##f
     -\tweak extra-offset #'(0 . 0)
     -\tweak layer #-10
     -\markup \gridTickMarkup
   #})

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%% 3. Música superior: envolvente
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

topEnvelope = {
  \fixed c' {
    \time 5/4
    \tempo 4 = 60

    \circle d2 \glissando
    b2 \glissando
    g'4 \glissando

    c'2 \glissando
    e2 \glissando
    f'4

    r2
    b2 \glissando
    d2 \glissando
    d2 \glissando
    b8 \glissando
    e8 \glissando
    c'8 \glissando
    f'2 \glissando
    s2.
    d1

    \bar "|"
  }
}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%% 4. Voz oculta sólo para la grilla superior
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

topGrid = {
  \fixed c' {
    \time 5/4

    \override NoteHead.transparent = ##t
    \override Stem.transparent = ##t
    \override Flag.transparent = ##t
    \override Beam.transparent = ##t
    \override Rest.transparent = ##t
    \override Accidental.transparent = ##t
    \override Tie.transparent = ##t
    \override LedgerLineSpanner.transparent = ##t

    \repeat unfold 25 { c4 \gridTick }
  }
}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%% 5. Música inferior: clarinete bajo
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

bassClarinetMusic = {
  \clef bass
  \fixed c {
    \time 5/4

c2 \glissando \romb a2
    % placeholder temporal
    \repeat unfold 1 { s1 s4 }
  }
}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%% 6. Score
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

\score {
  \new StaffGroup \with {
    systemStartDelimiter = #'SystemStartBar
    instrumentName = \markup \center-column { "Cl. b." }
    shortInstrumentName = \markup \center-column { "Cl. b." }
  } <<
    %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    %% Staff superior: envolvente + grilla
    %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    \new Staff \with {
      \omit Clef
      \omit TimeSignature
      \omit BarNumber

      \override StaffSymbol.line-positions = #'(-5 0 5)

      \override Stem.transparent = ##t
      \override Flag.transparent = ##t
      \override Beam.transparent = ##t
      \override Accidental.transparent = ##t
      \override LedgerLineSpanner.transparent = ##t
      \override Rest.transparent = ##t

      \override Glissando.thickness = #2.0
      \override Glissando.gap = #0
      \override Glissando.bound-details.left.padding = #0.7
      \override Glissando.bound-details.right.padding = #0.7

      \override BarLine.thickness = #1.1
    } <<
      \new Voice { \topEnvelope }
      \new Voice { \voiceTwo \topGrid }
    >>

    %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    %% Staff inferior: clarinete bajo normal
    %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    \new Staff {
      \bassClarinetMusic   
    }
  >>

  \layout {
    \context {
      \Score
      \consists "Grid_line_span_engraver"
      \override GridLine.thickness = #0.3
      \override GridLine.dash-fraction = #0.22
      \override GridLine.dash-period = #0.9
      \override GridLine.layer = #-10
    }

    \context {
      \Staff
      \consists "Grid_point_engraver"
      gridInterval = #2/4
    }

    \context {
      \Staff
      \override GridPoint.Y-extent = #'(6 . -6)
    }
  }
}
```