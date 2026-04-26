```lily
\version "2.25.80"
\language "english"

\paper    {
   #(set-paper-size "a4landscape")
  top-margin = 20\mm
  bottom-margin = 20\mm
  left-margin = 30\mm
  right-margin = 30\mm
  system-system-spacing.basic-distance = #10 % Base distance between systems
  system-system-spacing.padding = #20      %  SISTEMA SPACE
  system-system-spacing.stretch = #2    % Additional stretchability per system
   markup-system-spacing.padding = #0 % SISTEMA padding
   ragged-right = ##f
   tagline = ##f 
}

\score {
  \new StaffGroup = "Ritmos" <<
    \new Staff = "Ritmos" \with {
         \remove "Time_signature_engraver"
         \hide Clef
       } 
       \relative c'{
    \override Score.BarNumber.break-visibility = ##(#t #t #t)      
    b4 b b b
    b4 b b b
    b4 b b b
       }
  >>
}   

```