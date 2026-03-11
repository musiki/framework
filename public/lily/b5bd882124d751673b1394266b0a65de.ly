\version "2.24.0" % Specify your LilyPond version
\paper { 
tagline = ##f  
paper-height=#(* 3 cm) 
paper-width=#(* 8 cm)  
system-count=#1 }

\score {
 
\new Staff \relative{ \time 5/4  (g8' a8 b8 c8) \p \< (\tuplet 3/4 {c4 d8. f16 g16})\f }
}

