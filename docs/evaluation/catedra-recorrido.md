# Cátedra-recorrido: rúbrica-portafolio y recorrido elegido

Última actualización: 2026-07-01
Estado: propuesta de arquitectura (deriva de [paradigmas-evaluacion](paradigmas-evaluacion.md) y alimenta el pod de progreso)

## 1. La inversión

La cátedra tradicional fija un recorrido único (unidades en orden, un examen final) y mide cobertura. Acá se invierte: el curso es un universo de conceptos navegable y el alumno elige su recorrido dentro de él, acreditando un portafolio de logros de distinto tipo. Cada tipo de logro instrumenta un paradigma de aprendizaje distinto (ver [paradigmas-evaluacion](paradigmas-evaluacion.md)) y tiene su propia visualización en el pod de progreso. No se evalúa un camino, se evalúa una composición de capacidades.

Esto no es flexibilización blanda: es alineación (Biggs) entre modos de aprender y modos de acreditar, y respuesta directa a la era agéntica —el peso se corre hacia logros de alta resistencia a la delegación (conexión autorada, coloquio en video, obra), no hacia lo que un agente resuelve solo—.

## 2. Los dos extremos del recorrido

Punto de partida (nivel base): consumir un concepto o clase. Leer, escuchar, mirar. Se refleja en el pod por el llenado de las figuras geométricas y su porcentaje. Paradigma: educación de la atención (Ingold), cognición de la memoria. Resistencia a la delegación: baja (es andamiaje, no acredita).

Punto de llegada: la realización acabada del proyecto u obra. Es el ápice y, transversal a todas las materias, se mide con una escala estándar 4C (Kaufman & Beghetto): mini-c (avance personal) → little-c (obra cotidiana lograda) → Pro-c (obra de nivel experto) → Big-C queda fuera del aula. La medida 4C es única; la visualización cambia según el tipo de obra (composición, instalación, patch, objeto de diseño). En el pod: un halo creciente cuyo radio codifica el nivel 4C.

## 3. El medio: los logros y su gramática visual

Entre consumir y crear, cuatro modos de logro. Cada uno = un paradigma + un glifo.

### 3.1 Conexión (conectivismo, Siemens)

El alumno enlaza una nota con otra dentro del universo del curso: el saber se prueba como capacidad de tejer red, no de recitar. Glifo: un rayo que le sale al concepto cuando el alumno autoró un enlace desde esa nota. Métrica: número de conexiones autoradas y justificadas. Resistencia: alta si la conexión exige contenido propio en ambos extremos (no link vacío).

### 3.2 Self-determination / coloquio (Deci & Ryan)

El alumno sube un video (p. ej. YouTube) explicando un concepto: cita fuentes, arma presentación y gráficos, expone. Es el viejo coloquio, ahora asincrónico y público (o semipúblico). Satisface autonomía + competencia + relación. Glifo: marca de reproducción (triángulo) con halo sonoro. Resistencia: muy alta (explicar en cuerpo y voz, con fuentes, no se delega).

### 3.3 Estigmergia / pares (creatividad sistémica, Csikszentmihalyi; amigo crítico)

El alumno evalúa y es evaluado por pares (`peer_rubric`) o corre un ciclo de amigo crítico. El conocimiento se valida en el campo social; las producciones dejan rastro visible que orienta al grupo (estigmergia). Glifo: nodo con marca de reciprocidad (dos arcos). Resistencia: alta.

### 3.4 Aporte a musiki público (Glăveanu / creatividad sistémica)

El alumno produce un `essay_ai` o una nota-concepto atómica que se incorpora a la wiki pública de musiki. Su aprendizaje se vuelve contribución al dominio. Glifo: estrella que se integra al grafo público. Resistencia: media-alta.

## 4. La rúbrica-recorrido (portafolio mínimo por materia)

Te pedimos, para acreditar la materia:

- 1 proyecto (obra acabada, medida 4C).
- 5 conexiones (enlaces autorados y justificados).
- 2 self-determinations (coloquios en video).
- 1 estigmergia (amigo crítico o `peer_rubric`).
- 1 essay_ai o nota-concepto aportada a musiki público.

Con eso, el alumno arma su propio recorrido dentro del universo del curso. Los números son de arranque, calibrables por materia. La nota no premia orden ni cobertura, premia la composición lograda de estos logros.

## 5. 4C como medida estándar, visualización variable

El 4C es la vara común que hace comparables recorridos distintos (el problema clásico de la evaluación por portafolio: ¿cómo calificar caminos diferentes con justicia?). Cada logro reporta un nivel 4C; el pod los agrega. La visualización difiere por tipo —halo para la obra, intensidad del rayo para la conexión, tamaño del glifo de coloquio— pero la escala subyacente es una. Esto ancla la equidad sin uniformar la experiencia.

## 6. Contrato de datos (qué necesita la integración)

Cada logro debe emitir un registro persistible. Estado por concepto en el pod y fuente:

- leído: cliente (localStorage) — nivel base.
- completado: `Completion`/MCC (payload.completed) vía `/api/progress/me`.
- evaluado: existe `Submission` no-mcc vía `/api/progress/me`.
- conexión: enlace autorado por el alumno (wikilink en nota propia) → requiere derivar del grafo de notas personales, no solo del canónico.
- coloquio: nuevo tipo `eval` (video URL + rúbrica) — a implementar en parser/backend.
- estigmergia: `peer_rubric` (planificado) o ciclo amigo crítico (`short_ai`/`patch_ai` con revisión de pares).
- proyecto (4C): `Submission` con campo de nivel 4C — a agregar a la rúbrica de proyecto.

Aristas del connectoma: del grafo canónico (`buildGraphData`, relaciones `connect`/`hyper`/`hypo`); una arista se enciende cuando el alumno tiene ambos extremos en estado ≥ completado. La densidad resultante materializa el salto SOLO de multi-estructural a relacional.

## 7. Tensiones y riesgos (autocrítica)

No comprar la propia retórica de la revolución sin guardarraíles:

- Gaming de conexiones: contar enlaces incentiva el link-spam. Mitigación: la conexión acredita solo si ambos extremos tienen contenido propio mínimo y una justificación breve del vínculo (una frase que explique por qué conectan). Conexión ≠ hipervínculo, es argumento.
- Carga y privacidad del coloquio-video: subir a YouTube expone al alumno; ofrecer opción no listada o alojamiento interno, y valorar la exposición pública como elección, no requisito.
- Comparabilidad de recorridos: caminos distintos con la misma nota exigen que el 4C esté anclado con ejemplos calibrados (exemplars) por materia; sin anclaje, el 4C se vuelve arbitrario.
- Acreditación institucional: una cátedra por portafolio debe mapear a la reglamentación de UNTREF (nota numérica, regularidad, final). El portafolio compone la nota; no la reemplaza administrativamente.
- Sobrecarga docente: 5 tipos de logro multiplican la corrección. Por eso la IA como amigo crítico (diagnóstico, no nota) y la coevaluación son estructurales, no accesorias.
- Dispersión del alumno: la libertad de recorrido puede reproducir la dispersión del docente. Antídoto: un núcleo chico de conceptos-espinazo obligatorios dentro del universo, sobre los que sí o sí deben caer algunas conexiones y el proyecto.

## 8. Notas vinculadas

- [paradigmas-evaluacion](paradigmas-evaluacion.md) — fundamentación de cada logro.
- [Evaluation MOC](Evaluation%20MOC.md) — hub del sistema.
- [Evaluation-self](Evaluation-self.md) — peer_rubric, amigo crítico, estigmergia.
- Prototipo visual: `pod-progreso-prototipo.html`.
- Conceptos del vault: [[playability]], [[performatividad]], [[nueva organología]].

## 9. Referencias

```bibtex
@article{kaufmanBeghetto2009fourc,
  author  = {Kaufman, James C. and Beghetto, Ronald A.},
  title   = {Beyond Big and Little: The Four C Model of Creativity},
  journal = {Review of General Psychology},
  volume  = {13},
  number  = {1},
  pages   = {1--12},
  year    = {2009}
}

@article{siemens2005connectivism,
  author  = {Siemens, George},
  title   = {Connectivism: A Learning Theory for the Digital Age},
  journal = {International Journal of Instructional Technology and Distance Learning},
  volume  = {2},
  number  = {1},
  pages   = {3--10},
  year    = {2005}
}

@book{ryanDeci2017sdt,
  author    = {Ryan, Richard M. and Deci, Edward L.},
  title     = {Self-Determination Theory: Basic Psychological Needs in Motivation, Development, and Wellness},
  publisher = {Guilford Press},
  address   = {New York},
  year      = {2017}
}

@article{biggsCollis1982solo,
  author    = {Biggs, John B. and Collis, Kevin F.},
  title     = {Evaluating the Quality of Learning: The SOLO Taxonomy},
  publisher = {Academic Press},
  address   = {New York},
  year      = {1982}
}
```
