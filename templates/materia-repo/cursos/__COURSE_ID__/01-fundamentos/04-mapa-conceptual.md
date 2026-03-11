---
type: app-dataviewjs
title: "04 - Concept Map App"
status: draft
chapter: "01-fundamentos"
order: 4
slug: concept-map-app
---

# Concept Map App

Use `app-dataviewjs` for interactive notes that belong to the course.

```dataviewjs
const rows = [
  ["course note", "private teaching context"],
  ["public note", "edited output for a wider scope"],
  ["draft", "incubator or staging material"],
];

dv.table(["node", "role"], rows);
```
