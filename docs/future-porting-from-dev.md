# Arquitectura de Portabilidad y Patrones de V2 (Future Porting from Dev)

Este documento resume las decisiones de diseño, patrones y tecnologías de la arquitectura de la V2 (`musiki-dev`) que están destinadas a ser incorporadas progresivamente en la versión actual de **Musiki** (`musiki.org.ar`) para jubilar la deuda técnica heredada de la V1.

---

## 1. Portabilidad (Portability)

El objetivo de portabilidad en la V2 es desacoplar el núcleo de Musiki de la plataforma de ejecución (Navegador, Desktop o Mobile) para facilitar la distribución nativa.

### Principio Híbrido: Web Authority First
*   **Remote Shell First**: En lugar de empaquetar bases de datos y servidores locales pesados en el dispositivo del cliente, los clientes nativos (Tauri y Capacitor) actúan como **wrappers delgados** apuntando a la autoridad web de producción (`pwa.musiki.org.ar`).
*   **Beneficios**:
    *   Tamaño mínimo de descarga en tiendas nativas.
    *   Ciclos de actualización inmediatos (se actualiza la web y se refleja automáticamente en la app nativa).
    *   Diferimiento de la sincronización offline compleja hasta que el modelo transaccional y la persistencia de Postgres estén consolidados.

### Desacoplamiento del Entorno: Workspace Controller
*   Para evitar que las vistas o páginas llamen directamente a APIs del sistema operativo o del motor de diseño, se introduce una API semántica unificada (`WorkspaceController`):
    ```ts
    interface WorkspaceController {
      openPod(podId: string, options?: OpenPodOptions): Promise<void>;
      openDocument(documentId: string, options?: OpenPodOptions): Promise<void>;
      serializeWorkspace(): Promise<unknown>;
      restoreWorkspace(snapshot: unknown): Promise<void>;
    }
    ```
*   Toda llamada a layouts mutables o servicios del host se canaliza a través de este controlador, permitiendo cambiar el backend de renderizado (ej. cambiar entre Tauri y un navegador web estándar) sin alterar el código de los componentes.

---

## 2. Ligereza (Lightness)

La ligereza arquitectónica se logra reduciendo el costo de carga inicial de scripts y bloqueando el consumo descontrolado de recursos de hardware en segundo plano.

### El Sistema de Pods (Pod System)
*   Las capacidades del sistema (ej. chat, foro, visualizador de partituras, instrumentos, audio-analyzer) se modelan como **Pods independientes** descriptos por un manifiesto ligero.
*   **Lazy Loading Real**:
    *   Al iniciar la aplicación, solo se carga el manifiesto de los pods disponibles (peso en bytes casi nulo).
    *   La interfaz de usuario del Pod se importa dinámicamente (`import()`) únicamente cuando el usuario decide abrirlo.
*   **Activación Bajo Demanda**:
    *   Abrir un pod pesado no inicia sus servicios subyacentes. 
    *   Los recursos pesados (cámaras, audio, WebRTC, workers de detección, MediaPipe) permanecen en estado inactivo (`suspended`) hasta que el pod recibe foco explícito o el usuario concede consentimiento para su uso. Al cerrar el pod, se ejecuta el método `.dispose()` liberando la memoria.

### Headless Data Views (Adiós a Tabulator)
*   Se rechaza la dependencia de grids monolíticos y pesados (como `Tabulator`) que absorben el dominio de la aplicación.
*   Se adopta una aproximación **headless** (ej. TanStack Table): la lógica de filtrado, paginación y ordenamiento está totalmente desacoplada del renderizado. Las tablas nativas ligeras consumen esta lógica, reduciendo drásticamente el peso del bundle CSS/JS.

---

## 3. Edición en Vivo (Live Editing)

La V2 cambia el paradigma de edición tradicional (formularios grandes, modales obstructivos y botones de guardar) por una interfaz fluida inspirada en Notion u Obsidian.

### Edición Inline-First e In-Place
*   **Edición Directa**: Los campos de texto, títulos y descripciones son editables directamente al hacer foco.
*   **Autoguardado (Autosave)**: Cada cambio se persiste inmediatamente en segundo plano.
*   **Popovers Contextuales**: En lugar de modales gigantes para cambiar una etiqueta, categoría o estado, se utilizan pequeños popovers flotantes cerca de la acción.
*   **Paneles Laterales (Right Rails)**: Para metadatos densos o configuraciones complejas, se desliza un panel lateral que no interrumpe la lectura del documento central.

### Persistencia Basada en Patches (Patch-Based Persistence)
*   En lugar de enviar un objeto completo al servidor en cada edición, la aplicación envía un "patch" JSON con los campos específicos modificados:
    ```json
    {
      "op": "replace",
      "path": "/title",
      "value": "Nuevo título de partitura"
    }
    ```
*   Esto minimiza el ancho de banda, reduce la contención de transacciones en la base de datos (PostgreSQL) y mejora notablemente la velocidad percibida.

---

## 4. Rendereado en Tauri (Tauri Rendering)

El empaquetado desktop nativo requiere de reglas claras para estructurar las ventanas de la aplicación y coordinar el renderizado sin penalizar el rendimiento.

### Shells Estables vs. Espacios Mutables
*   Musiki divide su interfaz en contenedores lógicos superiores denominados **Shells**:
    *   `DocumentShell`: Orientada al estudio documental. Contiene un sidebar izquierdo jerárquico fijo, área de lectura/escritura central estable y un panel de metadatos derecho. Diseñado para tener scroll independiente por columnas, bloqueando el scroll global de la ventana del navegador.
    *   `RoomShell`: Orientada a clases y conferencias en vivo. Alberga el entorno espacial mutable de Dockview.
*   **Dockview Reencuadrado**:
    *   En lugar de usar `Dockview` como la shell global de toda la app (lo que causaba lentitud al inicializar y sobrecargaba pantallas simples), Dockview se encapsula únicamente dentro de `RoomShell` mediante un adaptador (`DockviewAdapter`).
    *   Esto garantiza que el renderizado de lectura de documentos (`DocumentShell`) sea sumamente ligero y libre del costo computacional de un motor de docking.

### Optimizaciones del Viewport Nativo
*   **Safe Areas e Integración de Ventanas**: El diseño CSS implementa variables de safe areas para integrarse de forma fluida con las dimensiones del WebView nativo en iOS y macOS (evitando colisiones con barras de estado o muescas físicas).
*   **Custom Scrollbars**: Se configuran scrollbars delgados y visualmente consistentes con el tema oscuro de Musiki, evitando los scrollbars por defecto de los WebViews del sistema que rompen la estética de la app.

---

## 5. Ideas Grosas para Optimizar Musiki (Futura V2)

Estas directrices conceptuales y metodológicas definen la ontología operativa y la experiencia de usuario (UX) avanzada de la V2, pensadas para optimizar la interacción, la pedagogía y la performance.

### A. Musiki como un Instrumento Musical Expandido
*   **La escritura como acto performático**: La escritura de texto no es solo soporte editorial, sino un acto performático en sí mismo. La integración en Markdown de sintaxis compactas de síntesis y audio ejecutables directamente en la nota (ej. bloques ` ```syno ` y ` ```glip ` sobre Web Audio) transforma la notación/lectura en producción sonora directa.
*   **Zonas de UX ("Presentation Readiness")**: El diseño visual de la UX debe responder a los principios de un "Blank Stage" (estilo Notion/Obsidian), donde la left sidebar es un rack de instrumentos replegable. El sistema está siempre listo para presentarse, proyectarse o tocarse en vivo (`fullscreen` nativo como ciudadano de primera clase).

### B. Pedagogía del "Estudio con Trazas" y Trazabilidad Cognitiva
*   **Persistencia selectiva**: No capturar clics o scrolls indiscriminados (ruido de telemetría). Registrar únicamente eventos con valor cognitivo y peso pedagógico:
    *   `session`: Layout actual e instrumentos abiertos para recuperación instantánea.
    *   `trace`: Comparación de variantes, referencias abiertas, replays.
    *   `evaluation`: Respuestas, confianza (`confidence rating`), uso de pistas (hints).
*   **Evaluación basada en autopercepción**: Integrar la medición de la confianza (`0-100%`) en cada respuesta/ejercicio para detectar zonas donde la seguridad declarada y la precisión real no coinciden (desajustes de calibración).

### C. Keyboard Routing & Shortcut Manager
*   **Normalización y Scopes DOM**: Evitar listeners dispersos por instrumento y colisiones con el shell (ej. tocar un piano QWERTY con `zsxdcvgbhnjmk` vs atajos globales).
*   **Enrutador Jerárquico**: El `ShortcutManager` resuelve el scope caminando por el árbol DOM hacia arriba desde el target activo (`event.target`). Si el foco está en un instrumento de scope `exclusive`, el enrutador inhibe los comandos globales del shell automáticamente sin necesidad de prender/apagar flags globales de forma manual.

### D. Orquestación de Eventos y Comandos Transversales
*   **Interaction Protocol**: Implementar un contrato unificado bajo la nomenclatura `domain.object.verb` (ej. `note.block.inserted`, `eval.response.submitted`) que desacople la comunicación entre los pods.
*   **Commands comunes**: Modularizar capacidades del sistema como comandos transversales (`focus.instrument`, `enter.fullscreen`, `save.session`, `summon.agent`) para que los pods no los implementen de manera aislada.

### E. Ecología de Agentes IA Especializados y Límites Humanos
*   **Agentes de propósito específico**: Remplazar el chat flotante de IA genérico por agentes integrados en interfaces puntuales:
    *   *Agente Copista-Crítico*: Debugging LilyPond y legibilidad.
    *   *Agente Oído-Estructura*: Alineación de partitura, audio y marcas de escucha activa.
    *   *Agente Dialógico*: Cuestionamiento conceptual de notas y justificación de decisiones.
*   **Momentos "Intensamente Humanos"**: Diseñar flujos pedagógicos que restrinjan la asistencia de la IA en etapas de exploración (ej. estados `first_listen_alone` y `blind_response_before_assistance`), garantizando que la IA actúe como amplificadora de contraste cognitivo y no como sustituta de la responsabilidad estética del alumno.

### F. Evaluaciones Embebidas (Bloques `eval`)
*   **Contratos ASCII**: Las evaluaciones se escriben en bloques estructurados YAML dentro de Markdown (` ```eval `), lo que mantiene el contenido compatible con Obsidian, portable y versionable mediante Git. Postgres funciona como un replicador que almacena respuestas, submissions y trazas, acelerando las búsquedas y reportes sin secuestrar la verdad editorial de los archivos.

