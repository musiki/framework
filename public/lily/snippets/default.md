
```lily
version "2.25.80" 
\paper { 
tagline = ##f  paper-height=#(* 5 cm)  paper-width=#(* 10 cm) system-count=#1 }
tempoPrimo = 84
\score {
\new Staff \relative{\time 5/4 \tempo 4 =\tempoPrimo <b c>4 \p \< des8. e16-. f4-- \mf(ges2) \bar "|."}
}
```





