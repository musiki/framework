\version "2.24.0" % Specify your LilyPond version
\paper { 
tagline = ##f  
paper-height=#(* 2 cm) 
paper-width=#(* 20 cm)  
system-count=#1 }

\score {
\new Staff \relative{(g8 a b c) \tuplet{c d <f gis>8}}
}