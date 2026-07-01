# Paradigmas educativos → evaluación

Última actualización: 2026-07-01
Estado: nota-madre (transfiere [edu MOC](edu%20MOC.md) al sistema de evaluación de musiki)

Nota puente entre la pedagogía y el sistema de bloques `eval`. No repite la gramática técnica (eso vive en [MANUAL-EVAL](MANUAL-EVAL.md) y [Evaluation-realtime](Evaluation-realtime.md)); traduce cada paradigma educativo a una decisión evaluable concreta. La lee el [Evaluation MOC](Evaluation%20MOC.md) como capa de fundamentación.

## 1. Tesis de la nota

Un LMS no es neutral: cada tipo de evaluación encarna una teoría del aprendizaje (ontología operativa, en clave organológica: cada instrumento de medida hace cognoscible un mundo distinto). Elegir `mcq` en vez de `peer_rubric` no es una decisión de UX, es una apuesta epistemológica sobre dónde reside el conocimiento —en el individuo, en la red, en la práctica situada—. Esta nota vuelve explícita esa apuesta para que el diseño sea deliberado y no un default heredado del formato quiz.

## 2. El eje que faltaba: resistencia a la delegación

Ninguno de los documentos previos tiene el eje que la era agéntica vuelve central: la resistencia a la delegación (delegation-resistance / AI-proofness). Mide cuán fácilmente un agente (LLM) puede producir la respuesta en lugar del estudiante.

- Resistencia baja: `mcq`, `msq`, respuesta corta factual. Un LLM las resuelve trivialmente. Sirven para autoestudio y práctica de recuperación (retrieval practice), no para certificar autoría.
- Resistencia media: `short_ai`, `essay_ai`, `patch_ai`. Delegables pero rastreables; el valor está en el proceso, la iteración y la defensa, no en el producto final.
- Resistencia alta: ejecución en vivo, defensa oral, patcheo en tiempo real, escucha analítica cronometrada, coevaluación presencial. No se delegan porque exigen cuerpo, tiempo real y testigo.

Consecuencia de diseño: la nota longitudinal debe apoyarse en el peso de los ítems de resistencia alta; los de resistencia baja son andamiaje formativo, no sumativo. Este eje conecta directamente con la organología del vault: [[liveness]], [[playability]] y [[performatividad]] describen exactamente la clase de acto que no se delega. La evaluación musical tiene aquí una ventaja estructural sobre otras disciplinas: tocar, en vivo, ante otros, es irreductible al agente.

## 3. Matriz paradigma → evaluación

Cada fila: qué mide el paradigma, qué tipo `eval` lo instrumenta, y su resistencia a la delegación.

### 3.1 Conectivismo (Siemens)

El conocimiento vive en la red, no en la cabeza; aprender es formar, mantener y reconfigurar conexiones. Evaluación: medir la capacidad de conectar, no de recitar. Instrumentos: `combinatoria` (subtype `matching`/`sorting`) sobre relaciones entre conceptos; navegación del grafo con rel-types; la propia wiki de notas atómicas como artefacto evaluable (¿qué enlaza el estudiante, con qué densidad?). Resistencia: media-alta si se evalúa la topología propia del estudiante, no una plantilla.

### 3.2 Teoría de la actividad (Engeström)

El aprendizaje es transformación colectiva de un sistema mediado por herramientas, reglas y división del trabajo; la creatividad surge al resolver contradicciones internas. Evaluación: `peer_rubric`, trabajos en constelación (grupos con roles: curador, sintetizador, hacker), donde la contradicción productiva es el objeto. Resistencia: alta (proceso grupal situado).

### 3.3 Self-Determination Theory (Deci & Ryan)

Motivación autónoma = autonomía + competencia + relación. Evaluación: feedback informativo no controlador (nunca punitivo), elección de recorrido, y —clave para el pod de progreso— hacer visible la competencia creciente. El camino de postas no es gamificación infantil: es la satisfacción estructural de la necesidad de competencia bajo condiciones (crisis, "no future") donde el horizonte temporal se ha desplomado. Resistencia: n/a (es capa motivacional, atraviesa todos los tipos).

### 3.4 Creatividad sistémica (Csikszentmihalyi; Sawyer)

La creatividad no es generar ideas sino validarlas dentro de un campo (individuo × dominio × campo social). Evaluación: paneles públicos y estigmergia —las producciones dejan rastro visible (nube de conceptos, ejemplos anónimos de buenas respuestas, patches compartidos)—; el "modo atlas" de [Evaluation-self](Evaluation-self.md). La nota MIM del vault opera aquí. Resistencia: alta (validación en campo real de pares).

### 3.5 Modelo 4C (Kaufman & Beghetto)

Cuatro niveles: mini-c (personal), little-c (cotidiana), Pro-c (experta), Big-C (eminente). Evaluación: rúbricas escaladas que no exigen genialidad; distinguen el avance personal (mini-c) del logro experto (Pro-c). Antídoto contra la rúbrica binaria. Instrumenta el escalado de `passScore` y niveles de rúbrica en `short_ai`/`peer_rubric`. Resistencia: media.

### 3.6 Enfoque sociocultural relacional (Glăveanu)

Creatividad distribuida en relaciones entre actores, artefactos y contextos históricos. Evaluación: portfolios narrativos, evaluación situada que atiende la mediación material. Encaja con el registro longitudinal y con narrar el recorrido, no solo puntuarlo. Resistencia: alta.

### 3.7 IA y aprendizaje aumentativo (Luckin)

La creatividad como co-producción humano-máquina; analítica de aprendizaje, tutores que apoyan metacognición. Evaluación: `short_ai`/`patch_ai` como amigo crítico (no mentor blando ni policía), corrección IA en dos capas (diagnóstico IA + nota docente revisable). Riesgo declarado: la co-producción puede volverse sustitución. La IA correctora debe explicitar el concepto ausente, no reescribir la respuesta. Resistencia: media, con gobernanza obligatoria.

### 3.8 Taxonomía SOLO (Biggs)

Cinco niveles de estructura de la respuesta: pre-estructural → uni-estructural → multi-estructural → relacional → abstracto-extendido. Es la mejor rúbrica para respuestas abiertas y —literalmente— el modelo del pod de progreso: el paso de nodos aislados (multi-estructural, aditivo) a estructura conectada (relacional) es lo que la animación del connectoma debe visualizar. No se llena un depósito de puntos: crece densidad de conexión. Instrumenta la `rubric` de `short_ai`/`essay_ai`. Resistencia: media (pero la rúbrica SOLO detecta la respuesta-LLM genérica, que suele quedar en multi-estructural sin integración propia).

### 3.9 Cadena DIKW

Data → información → conocimiento → sabiduría. Escala de referencia paralela a SOLO para pensar métricas: el sistema tiene datos (submissions) e información (métricas); el salto a conocimiento y sabiduría exige los ítems de resistencia alta.

## 4. La matriz tácito-performativa-distribuida

Un segundo bloque de edu MOC —Dewey, Ingold, Schön, Polanyi, Gibson, Hutchins, Varela— converge en una tesis: buena parte del saber es tácito (Polanyi), se educa como atención (Ingold), se despliega en la práctica reflexiva (Schön), está distribuido (Hutchins) y es enactivo (Varela-Thompson-Rosch). Esto es, exactamente, el saber musical.

Consecuencia evaluativa: lo tácito no se mide por opción múltiple. Se evalúa por ejecución testimoniada (witnessed performance), por la educación de la atención (tareas de escucha analítica cronometrada, que en musiki cruzan con [[modos de escucha]] y transmisión auditiva), y por la práctica reflexiva (bitácora, defensa). Es el núcleo de resistencia alta y el que ancla la nota real. La [[playability]] es aquí criterio y prueba: un instrumento —o un concepto instrumentado— se valida cuando alguien lo juega y el juego revela algo antes inaccesible.

## 5. Gestión del acto evaluativo (pragmática de aula)

De edu MOC (Goffman, Bernstein, Austin-Searle): el feedback es un acto de habla. Riesgo a evitar: que un acto ilocutivo (clarificar una condición académica) se deslice a un acto perlocutivo conflictivo (confrontación personal, lenguaje valorativo fuerte). En el sistema esto se traduce en: el feedback IA y docente describe la brecha respecto del criterio, nunca califica a la persona. El cold-calling amable se instrumenta con `poll`/`wordcloud` en vivo (participación distribuida, no exposición individual punitiva). La explicitación de criterios (Biggs) es un requisito, no un adorno: rúbricas y objetivos visibles antes de responder.

## 6. Síntesis operativa

Tres modos de curso, cada uno con su paradigma dominante y su relación con el error:

- Modo estudio: `mcq` + `short_ai` en repetición espaciada. Paradigma: cognición de la memoria (retrieval practice). Error = dato de calibración. Resistencia baja: formativo.
- Modo proyecto: `peer_rubric` + `patch_ai` + ensayo. Paradigma: actividad (Engeström) + 4C. Error = contradicción a elaborar. Resistencia alta: sumativo.
- Modo atlas: producciones con rastro público (estigmergia). Paradigma: creatividad sistémica (Csikszentmihalyi) + conectivismo. Error = variación visible del campo. Resistencia alta.

La nota final se compone privilegiando proyecto y atlas; estudio es andamiaje. Este reparto es la respuesta concreta a la era agéntica: mover el peso desde lo que la máquina hace trivialmente hacia lo que exige cuerpo, tiempo real, red y testigo.

## 7. Notas vinculadas

- [Evaluation MOC](Evaluation%20MOC.md) — hub esquemático que consume esta fundamentación.
- [Evaluation-self](Evaluation-self.md) — autoevaluación, coevaluación, IA correctora, estigmergia.
- [Evaluation-realtime](Evaluation-realtime.md) — tipologías en vivo (activación de aula).
- [edu MOC](edu%20MOC.md) — fuente de los paradigmas.
- Conceptos del vault: [[playability]], [[liveness]], [[performatividad]], [[instrumentalidad]], [[modos de escucha]].

## 8. Referencias

```bibtex
@article{siemens2005connectivism,
  author  = {Siemens, George},
  title   = {Connectivism: A Learning Theory for the Digital Age},
  journal = {International Journal of Instructional Technology and Distance Learning},
  volume  = {2},
  number  = {1},
  pages   = {3--10},
  year    = {2005}
}

@book{engestrom2015learning,
  author    = {Engeström, Yrjö},
  title     = {Learning by Expanding: An Activity-Theoretical Approach to Developmental Research},
  edition   = {2nd},
  publisher = {Cambridge University Press},
  address   = {Cambridge},
  year      = {2015}
}

@book{ryanDeci2017sdt,
  author    = {Ryan, Richard M. and Deci, Edward L.},
  title     = {Self-Determination Theory: Basic Psychological Needs in Motivation, Development, and Wellness},
  publisher = {Guilford Press},
  address   = {New York},
  year      = {2017}
}

@book{csikszentmihalyi1996creativity,
  author    = {Csikszentmihalyi, Mihaly},
  title     = {Creativity: Flow and the Psychology of Discovery and Invention},
  publisher = {HarperCollins},
  address   = {New York},
  year      = {1996}
}

@article{kaufmanBeghetto2009fourc,
  author  = {Kaufman, James C. and Beghetto, Ronald A.},
  title   = {Beyond Big and Little: The Four C Model of Creativity},
  journal = {Review of General Psychology},
  volume  = {13},
  number  = {1},
  pages   = {1--12},
  year    = {2009}
}

@book{glaveanu2014distributed,
  author    = {Glăveanu, Vlad Petre},
  title     = {Distributed Creativity: Thinking Outside the Box of the Creative Individual},
  publisher = {Springer},
  address   = {Cham},
  year      = {2014}
}

@book{luckin2018machine,
  author    = {Luckin, Rose},
  title     = {Machine Learning and Human Intelligence: The Future of Education for the 21st Century},
  publisher = {UCL Institute of Education Press},
  address   = {London},
  year      = {2018}
}

@book{biggsTang2011solo,
  author    = {Biggs, John and Tang, Catherine},
  title     = {Teaching for Quality Learning at University},
  edition   = {4th},
  publisher = {Open University Press},
  address   = {Maidenhead},
  year      = {2011}
}

@book{polanyi1966tacit,
  author    = {Polanyi, Michael},
  title     = {The Tacit Dimension},
  publisher = {University of Chicago Press},
  address   = {Chicago},
  year      = {1966}
}

@book{ingold2000perception,
  author    = {Ingold, Tim},
  title     = {The Perception of the Environment: Essays on Livelihood, Dwelling and Skill},
  publisher = {Routledge},
  address   = {London},
  year      = {2000}
}

@book{schon1983reflective,
  author    = {Schön, Donald A.},
  title     = {The Reflective Practitioner: How Professionals Think in Action},
  publisher = {Basic Books},
  address   = {New York},
  year      = {1983}
}

@book{hutchins1995cognition,
  author    = {Hutchins, Edwin},
  title     = {Cognition in the Wild},
  publisher = {MIT Press},
  address   = {Cambridge, MA},
  year      = {1995}
}

@book{varela1991embodied,
  author    = {Varela, Francisco J. and Thompson, Evan and Rosch, Eleanor},
  title     = {The Embodied Mind: Cognitive Science and Human Experience},
  publisher = {MIT Press},
  address   = {Cambridge, MA},
  year      = {1991}
}

@article{cao2025tmsa,
  author  = {Cao, Y. and Yan, Z. and Yang, L. and Panadero, E. and Chen, C.},
  title   = {Technology-mediated Self-assessment in Higher Education: A Critical Review},
  journal = {Contemporary Educational Technology},
  volume  = {17},
  number  = {3},
  year    = {2025}
}
```
