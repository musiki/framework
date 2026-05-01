# Orf Next Steps

## Objetivo

Ordenar la evolucion inmediata de Orf despues del primer MVP funcional en el room.

La prioridad es reducir alucinaciones, concentrar respuestas en contexto verificable y preparar el corpus LilyPond sin sobredisenar fine tuning antes de tener ejemplos validados.

## Secuencia acordada

1. Parchear Orf para que deje de alucinar vault/RAG y no muestre JSON crudo.
2. Agregar RAG textual minimo sobre markdown.
3. Definir esquema y corpus LilyPond en `public/lilypond`.

## 1. Parche inmediato de Orf

Problemas observados:

- Orf responde como si hubiera leido notas del curso aunque el MVP todavia no tiene retrieval real.
- Orf inventa cantidades, autores o fuentes cuando el usuario pregunta por el vault.
- A veces el modelo devuelve JSON como texto visible, especialmente cuando el contenido LilyPond contiene backslashes no escapados.
- El template LilyPond inicial no fue suficientemente compilable ni idiomatico.

Reglas nuevas:

- Si el usuario pide una nota, autores citados, cantidad de notas o contenido del vault, Orf debe declarar que todavia no tiene lectura RAG activa.
- Puede ofrecer preparar la busqueda o generar una pregunta guia, pero no debe inventar resultados.
- Para LilyPond debe preferir snippets minimos completos con `\version`.
- Si devuelve acciones, el mensaje visible debe ser humano; el JSON nunca debe aparecer como respuesta final.

## 2. RAG textual minimo

Antes de embeddings, implementar retrieval textual simple.

Scope inicial:

- curso activo, por ejemplo `s123`;
- nota activa si existe;
- rutas `public/**` y `cursos/**` permitidas;
- excluir borradores o contenido privado;
- limitar cantidad de fragmentos.

Indice minimo:

```ts
type TextChunk = {
  id: string;
  courseId?: string;
  sourcePath: string;
  title?: string;
  headings: string[];
  tags: string[];
  content: string;
  visibility: 'public' | 'course';
};
```

Respuesta esperada:

- incluir fuentes usadas;
- separar "segun las notas" de inferencias;
- si no hay resultados, decirlo.

No hacer todavia:

- embeddings;
- vector DB;
- escritura automatica en vault;
- claims sin `sourcePath`.

## 3. Corpus LilyPond

Ruta canonica:

```txt
public/lilypond/
```

Estructura recomendada:

```txt
public/lilypond/
  recipes/
  patterns/
  errors/
  style/
  reference/
  summaries/
```

Principio editorial:

```txt
1 nota = 1 problema LilyPond
1 problema = 1 snippet minimo compilable
1 snippet = 1 regla para Orf
```

Tipos:

- `lilypond_recipe`: como escribir X.
- `lilypond_pattern`: patron reutilizable.
- `lilypond_error_case`: error frecuente y reparacion.
- `lilypond_style_rule`: convencion Musiki.
- `lilypond_reference`: explicacion conceptual larga.

Frontmatter minimo:

```yaml
id: lily-scale-c-major-001
type: lilypond_recipe
title: "Como escribir una escala de Do mayor"
instrument: generic
technique: scale
level: beginner
lilypond_version: "2.24"
status: draft
tags:
  - lilypond
  - scale
  - c-major
input_intents:
  - "escala de Do mayor en LilyPond"
  - "template minimo LilyPond"
compile:
  expected: true
```

Secciones:

```md
## Problem
## Use when
## Minimal snippet
## Explanation
## Variants
## Common mistakes
## Agent instruction
```

## 4. Manual agregado

Antes de fine tuning real, generar:

```txt
public/lilypond/summaries/lilypond-agent-manual.md
```

Funcion:

- compactar reglas activas;
- proveer snippets canonicos;
- alimentar prompt de Orf cuando detecte intencion LilyPond;
- servir como puente hacia RAG y despues dataset JSONL.

## Decision

El siguiente trabajo tecnico debe empezar por el parche de Orf y luego construir retrieval textual minimo. El corpus LilyPond se puede iniciar en paralelo, pero Orf no debe afirmar que lo leyo hasta que el retrieval lo entregue explicitamente como contexto.
