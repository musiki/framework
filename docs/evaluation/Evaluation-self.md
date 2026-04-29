Evaluation-slf


## todo
MCQ
RBAC Role-Based Access Control
Liveblocks > ai support
MCC Marcar como completado, luego de cada párrafo informativo. (luego en el sidebar aparece un circulo con tilde verde con los completados), podria ser que cada 
	- extension 300-900 palabaras.
	- acto de cierre .
	- estructura simple: ej, 1 parrafo asertivo y luego : "Para el final de esta sección seras capaz de: 3 objetivos"
	- cuando se cliqeua cambia a completado y muestra el siguiente problema.
	-

DDS (Drag & drop Sorting) o Interactive Categorization Exercise 
   - 3 campos, en general uno positivo, otro de dificultad,, y otro negativo (ej: AF predicts, AF struggles with, AF doesn't predict)
   - luego un check button dice x de x , pinta de verde las correectas y de rojo las incorrectas.el boton Retry, resetea todo en la posición inicial randomica.
   - formato de md 



```markdow
 { id: 1, text: "Predicts protein structures with high accuracy", category: "strength" }, 
 { id: 2, text: "Does not model protein dynamics", category: "limitation" },
  { id: 3, text: "Accelerates structural biology research", category: "strength" }
```


materia	unidades
		concepto (muchas veces el titulo es una pregunta o dos integradas) 
			parrafo1 sintesis.
			pregunta 1 desglose

---
En didáctica se distingue entre:
1. Autoevaluación clásica: el estudiante estima su propio rendimiento con apoyo de criterios o rúbricas.
2. Evaluación automática: el sistema corrige respuestas (MCQ, numéricas, código, texto).
3. Autoevaluación mediada por tecnología: el sistema no solo corrige, sino que guía, visualiza progreso, propone repeticiones, sugiere recursos.

# Recent Sources
Una revisión crítica reciente sobre “**technology-mediated self-assessment”** en educación superior muestra que:
- las mejores experiencias combinan *1. feedback inmediato* + *2. reflexión guiada* + *3. posibilidad de reintento*;
- la clave no es el tipo de ítem, sino la **alineación** con objetivos de aprendizaje y la **transparencia** de criterios;
- la tecnología sirve para hacer visible el progreso y para dar feedback “diagnóstico”, no solo nota.
    En paralelo, la literatura de computer-assisted assessment sigue marcando como ejes: 
	    1. preguntas objetivas, 
	    2. preguntas abiertas auto-correctadas, y 
	    3. mecanismos de auto y **coevaluación en grupo.**
Traducción a tu LMS: más que “tipos de pregunta”, tenés que diseñar “modos de relación con el error”: auto-chequeo rápido, práctica espaciada, escritura reflexiva, trabajo entre pares, etc.
# Tipos de autoevaluación
## 2.1 Multiple choice y preguntas objetivas
  (checklists tipo - [ ] / - [x]) está totalmente en línea con cómo ya funcionan plugins de quiz en Obsidian y herramientas tipo Anki/Quizlet.
### +:
- corrección exacta,
- buen soporte para spaced repetition,
- bajo costo cognitivo para el sistema.
- usar MCQ para conceptos nucleares (**definiciones**, **relaciones**, **pequeñas inferencias**),
> [!tip] complementar siempre con explicación o ejemplo abierto.### -:
- si no se diseña bien, refuerza reconocimiento superficial y no comprensión.
## 2.2 Respuesta corta y ensayo con IA
Lo que se investiga hoy se agrupa bajo:
- ASAS (Automatic Short Answer Scoring)
- AES (Automated Essay Scoring)
Las aproximaciones actuales:
1. Modelos de similitud semántica: embeddings tipo SBERT que miden qué tan cerca está la respuesta del estudiante de una o varias respuestas de referencia.
2. Modelos transformer entrenados para predecir una nota o etiqueta a partir del texto (regresión/clasificación).
3. Combinación de modelos generativos (LLM) + métricas: el modelo propone una nota y justificación, se contrastan aspectos estructurados (mención de conceptos clave, precisión terminológica, etc.).
La evidencia empírica reciente:
- muestra que modelos tipo SBERT y algunos LLM calibrados pueden correlacionar bastante bien con el profesorado en preguntas conceptuales cortas;
- pero hay riesgos claros de sesgo y de sobreconfianza, así que la recomendación es “IA como co-corrector” y no como juez único.
# dos capas
## 1. Capa “diagnóstico IA”:
 - El modelo decide entre categorías grosas: correcto / parcialmente correcto / incorrecto / fuera de tema.
 - Marca conceptos ausentes o mal usados.
2. Capa “nota oficial”:
    - Docente ve la predicción, la explicación y la respuesta del alumno.
    - Puede aceptar o ajustar.
Y a nivel autoevaluación:
- el estudiante ve de inmediato:
    - “parece correcto, pero no mencionaste X ni Y”,
    - “tu explicación es muy vaga, intentá precisar A/B/C”.
2.3 Autoevaluación como spaced repetition y práctica de recuperación
Lo que llamás “space repetition escalado” es básicamente integración de spaced repetition + retrieval practice dentro del curso.
Training Data:
La evidencia en psicología cognitiva es muy robusta: espaciar las prácticas y pedir recuperación activa (no releer) genera mejores aprendizajes a largo plazo que repasos masivos.
Recent Sources:
Se está trabajando en:
- sistemas que usan IA para ajustar los intervalos de repetición según el rendimiento del estudiante;
- quizzes adaptativos que intercalan contenido nuevo y antiguo para mantener la curva de olvido en niveles óptimos.
Para CyM podés pensar:
- micro-quizzes al final de cada unidad, que se reactivan solos con intervalos crecientes;
- preguntas que reaparecen pero en contextos nuevos (ejemplo: Uexküll reaparece en Generatividad, luego en Bioarte, luego en Agentes);
- autoevaluaciones donde el alumno indica su confianza (0–100 %) y el sistema usa esa metacognición para ajustar futuros ejercicios.
2.4 Evaluación de código y patches (Max/MSP, M4L, Pd)
Aquí hablamos de autoevaluación estructural, no solo de “el patch compila”.
Training Data:
En patchers tipo Max/Pd, el patch es en esencia un grafo de objetos y conexiones.
Lo que se hace en code grading en computer science:
- test unitarios de comportamiento (entra X, debe salir Y);
- análisis estático de estructura (presencia de ciertas funciones, patrones, smells);
- comparación con soluciones de referencia (distancia de edit, árboles de sintaxis, etc.).
Para patches musicales, tu lógica podría ser:
1. Normalizar patch:
    - parsear el .maxpat (JSON) o .pd (texto),
    - extraer grafo: nodos = objetos; aristas = cables.
2. Reglas estructurales:
    - ¿aparece [cycle~] conectado a [*] antes de [dac]?
    - ¿hay feedback donde debe haberlo?
    - ¿se usan [send~]/[receive~] según consigna?
3. Tests de comportamiento:
    - cargar el patch en headless,
    - enviar un estímulo (por ejemplo ruido blanco o un click),
    - medir propiedades simples de la salida (nivel RMS, presencia de modulación, respuesta en frecuencia, etc.).
Y como autoevaluación:
- el sistema puede decirle al alumno:
    - “faltan conexiones entre X e Y”,
    - “el patch responde pero con un nivel demasiado bajo/alto”,
    - “tu solución es funcional pero no respeta el esquema de routing pedido”.
2.5 Autoevaluación cooperativa, empatía y estigmergia
Recent Sources:
Las experiencias más potentes en evaluación innovadora mezclan:
- autoevaluación,
- coevaluación (entre pares),
- re-evaluación (posibilidad de corregir y mejorar).
Hay software como CASPAR para self- and peer-assessment que:
- recoge evaluaciones que hacen los estudiantes de su propio aporte y el de sus compañeros;
- analiza las discrepancias y genera feedback metacognitivo (sobreestimas vs subestimas tu trabajo).
Para tu LMS:
- podés diseñar “trabajos en constelación”: grupos pequeños donde cada integrante:
    - se autoevalúa según rúbrica,
    - evalúa a sus compañeros,
    - recibe un resumen de coincidencias y diferencias;
- podés usar IA solo para:
    - detectar patrones de texto (por ejemplo, vocabulario técnico, alusión a autores, grado de especificidad),
    - pero dejar la evaluación ética/expresiva en manos del grupo.
La estigmergia aparece si:
- las producciones y autoevaluaciones dejan “rastros” visibles en el LMS:
    - paneles con ejemplos de buenas respuestas (anonimizadas),
    - nube de conceptos más recurrentes en las reflexiones,
    - badges que representan roles en el grupo (curador, sintetizador, hacker, etc.).
3. Diseñar tu gramática de evaluación en Obsidian
La idea es tener un “bloque de evaluación” único, con un campo type que indique el modo, y dentro una mini-sintaxis distinta.
3.1 Bloque genérico

Algo así (pseudo-gramática que Astro parsea):
```eval
id: cym1-u1-q1
type: mcq         # mcq | short_ai | essay_ai | code | patch | spaced | peer_rubric
mode: self        # self | graded | peer
points: 1
prompt: >
  ¿Cuál de las siguientes opciones describe mejor el concepto de Umwelt en Uexküll?
options:
  - [ ] El mundo objetivo descrito por la física clásica.
  - [x] El mundo circundante tal como es vivido por un organismo particular.
  - [ ] El conjunto de estímulos auditivos de una especie.
explanation: >
  Texto opcional que se muestra luego de la respuesta, con aclaración filosófica.
```
En Obsidian lo podés conservar como fenced code block con lenguaje eval (no interfiere con el render), y Astro lo parsea como YAML+lista.
3.2 Short answer con IA
```eval
id: cym1-u1-q2
type: short_ai
mode: self
points: 2
prompt: >
  Explicá en 3 a 5 líneas la diferencia entre Umwelt y mundo físico newtoniano.
reference_answers:
  - >
    El Umwelt es el mundo tal como se da a un organismo específico, filtrado
    por su aparato sensorial y sus significados biológicos, mientras que el
    mundo físico newtoniano es una descripción abstracta, independiente del
    observador, regida por leyes mecánicas universales.
rubric:
  - "Menciona el rol del organismo o sujeto."
  - "Distingue entre experiencia vivida y descripción física."
  - "Evita confundir Umwelt con mero 'entorno geográfico'."
ai_scoring:
  model: "text-embedding + LLM"
  thresholds:
    correct: 0.80
    partial: 0.55
```
El motor:
- calcula similitud semántica con reference_answers,
- verifica presencia de elementos de la rúbrica (con prompts al LLM),
- devuelve categoría y feedback textual.
3.3 Autoevaluación como spaced repetition
No es tanto un tipo de ítem distinto, sino un “scheduler”. Podés marcar ejercicios como candidatos a repetición:
```eval
id: cym1-u1-q3
type: mcq
mode: self
spaced:
  enabled: true
  deck: "cym-paradigmas"
  initial_interval_days: 2
  growth_factor: 2.5
```
Tu backend:
- guarda la “curva de memoria” del alumno para ese ítem,
- reprograma la aparición según éxito/fracaso y confianza declarada.
- 
**3.4 Evaluación de código / patch**
Podés separar descripción didáctica y reglas técnicas:
```eval
id: cym2-u3-max1
type: patch
mode: self
prompt: >
  Diseñá un patch en Max que tome audio de entrada, lo procese con un delay
  modulable y lo envíe a la salida estéreo, usando objetos básicos.
submission:
  kind: "file"
  format: ".maxpat"
checks:
  structural:
    required_objects: ["adc~", "tapin~", "tapout~", "dac~"]
    forbidden_objects: ["ezadc~"]
    required_connections:
      - from: "adc~"
        to: "tapin~"
      - from: "tapout~"
        to: "dac~"
  behavioral:
    tests:
      - name: "latencia-aproximada"
        input: "impulso"
        expect:
          metric: "peak_delay_ms"
          range: [90, 110]
```
El sistema:
- parsea el .maxpat a JSON,
- genera el grafo,
- aplica checks de estructura;
- opcionalmente corre un test headless en un servidor Max o Pd.
3.5 Auto/coevaluación con rúbricas
```eval
id: cym1-u4-ensayo1
type: peer_rubric
mode: peer
prompt: >
  Escribí una página sobre el rol de la vida artificial en la música generativa.
rubric_dimensions:
  - id: "claridad"
    label: "Claridad conceptual"
    levels:
      - 1: "Confuso, términos sin definir"
      - 2: "Algunas ideas claras, pero mal articuladas"
      - 3: "Claridad general con leves imprecisiones"
      - 4: "Conceptos claros, bien ejemplificados"
  - id: "profundidad"
    label: "Profundidad filosófica"
    levels:
      - 1: "Descripción superficial"
      - 2: "Discusión básica de uno o dos autores"
      - 3: "Integra múltiples perspectivas"
      - 4: "Articula una posición propia informada"
workflow:
  self_assessment: true
  peer_reviews: 2
  aggregation: "median"
feedback:
  ai_summarize: true
```
La autoevaluación aquí es que el estudiante:
- se puntúa a sí mismo,
- puntúa a dos pares,
- recibe un resumen de cómo se ve a sí mismo vs cómo lo ven les demás.
4. Innovación + empatía + estigmergia
Si mirás en conjunto la literatura reciente:
- lo verdaderamente innovador no es un nuevo tipo de ítem, sino:
    1. combinar auto/coevaluación con feedback rico;
    2. usar IA como “mentor” y no como policía;
    3. diseñar paneles donde el grupo ve su propia cultura cognitiva emergiendo (conceptos que más aparecen, dificultades recurrentes, etc.).
Para CyM yo apuntaría a:
1. Un “modo estudio” con MCQ + short_ai en spaced repetition.
2. Un “modo proyecto” con rúbricas auto/peer, ensayo y código/patch.
3. Un “modo atlas” donde las autoevaluaciones dejan rastros:
    - mapa de conceptos más difíciles,
    - ejemplos de buenas respuestas,
    - patches interesantes compartidos, etiquetados por les estudiantes.
Eso te da un LMS que no es solo corrector, sino laboratorio de pensamiento.



# Referencias 
```
@article{cao2025tmsa,
  author  = {Cao, Y. and Yan, Z. and Yang, L. and Panadero, E. and Chen, C.},
  title   = {Technology-mediated self-assessment in higher education: A critical review},
  journal = {Contemporary Educational Technology},
  year    = {2025},
  volume  = {17},
  number  = {3},
  pages   = {n/a},
  note    = {State-of-the-art review on tech-mediated self-assessment}
}
@article{conole2005caa,
  author  = {Conole, Grainne and Warburton, Bill},
  title   = {A review of computer-assisted assessment},
  journal = {Research in Learning Technology},
  year    = {2005},
  volume  = {13},
  number  = {1},
  pages   = {17--31}
}
@article{kang2016spaced,
  author  = {Kang, Sean H. K.},
  title   = {Spaced Repetition Promotes Efficient and Effective Learning},
  journal = {Policy Insights from the Behavioral and Brain Sciences},
  year    = {2016},
  volume  = {3},
  number  = {1},
  pages   = {12--19}
}
@article{carpenter2022spacingretrieval,
  author  = {Carpenter, Shana K. and others},
  title   = {The science of effective learning with spacing and retrieval practice},
  journal = {npj Science of Learning},
  year    = {2022},
  volume  = {7},
  number  = {1},
  pages   = {1--10}
}
@article{huang2025aiSpacing,
  author  = {Huang, Mengqi},
  title   = {Spaced Repetition and Retrieval Practice: Efficient Learning Mechanisms and Their Empowerment by AI},
  journal = {n/a},
  year    = {2025},
  pages   = {n/a}
}
@article{ross2018adaptivequizzes,
  author  = {Ross, Brenda and others},
  title   = {Adaptive quizzes to increase motivation, engagement and learning in higher education},
  journal = {International Journal of Educational Technology in Higher Education},
  year    = {2018},
  volume  = {15},
  number  = {28},
  pages   = {1--20}
}
@article{li2025aiGrading,
  author  = {Li, Y. and others},
  title   = {Can AI support human grading? Examining machine-generated scores for short-answer questions},
  year    = {2025},
  volume  = {210},
  pages   = {n/a}
}
@article{condor2020bertShortAnswer,
  author  = {Condor, A. and others},
  title   = {Exploring Automatic Short Answer Grading as a Tool to Support Human Graders},
  journal = {BMC Medical Education},
  year    = {2020},
  volume  = {20},
  number  = {1},
  pages   = {1--10}
}
@article{ludwig2021aesTransformer,
  author  = {Ludwig, S. and others},
  title   = {Automated Essay Scoring Using Transformer Models},
  journal = {arXiv preprint arXiv:2110.06874},
  year    = {2021},
  pages   = {1--14}
}
@article{osaka2025shortAnswer,
  author  = {Osaka, J. and others},
  title   = {Reliable and efficient automated short-answer scoring for a large cohort},
  journal = {Interactive Learning Environments},
  year    = {2025},
  pages   = {n/a}
}
@article{pecuchova2025openEndedAI,
  author  = {Pecuchova, J. and others},
  title   = {Automated Grading of Open-Ended Questions in Higher Education with Generative AI and Embedding Models},
  journal = {International Journal of Artificial Intelligence in Education},
  year    = {2025},
  pages   = {n/a}
}
@article{maslim2024shortAnswer,
  author  = {Maslim, M. and others},
  title   = {A Trustworthy Automated Short-Answer Scoring System},
  journal = {International Journal of Interactive Multimedia and Artificial Intelligence},
  year    = {2024},
  volume  = {8},
  number  = {7},
  pages   = {n/a}
}
@article{mesny2026innovativeAssessment,
  author  = {Mesny, A. and others},
  title   = {Innovative assessment and grading practices in higher education},
  journal = {Teaching and Teacher Education},
  year    = {2026},
  pages   = {n/a}
}
@article{zacharis2010innovative,
  author  = {Zacharis, Nickos Z.},
  title   = {Innovative assessment for learning enhancement: Issues and practices},
  journal = {International Journal of Instructional Technology and Distance Learning},
  year    = {2010},
  volume  = {7},
  number  = {8},
  pages   = {19--34}
}
@inproceedings{caspar2025selfPeer,
  author  = {Yan, Z. and others},
  title   = {Computer assisted self and peer assessment: Applications, challenges and opportunities},
  booktitle = {Conference on Educational Technology},
  year    = {2025},
  pages   = {n/a}
}
@article{cao2025tmsaShort,
  author  = {Cao, Y. and others},
  title   = {Technology-mediated self-assessment in higher education: A critical review},
  journal = {Contemporary Educational Technology},
  year    = {2025},
  volume  = {17},
  number  = {3},
  pages   = {n/a}
}
``````