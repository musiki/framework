# Arquitectura de Layout basado en Pods (Dockview Core)

## Introducción
Este documento describe la migración del sistema de layout estático de la Sala Performativa de Musiki hacia un sistema dinámico basado en mosaicos (Pods). La tecnología central utilizada es **Dockview Core**, una librería agnóstica de gestión de ventanas en TypeScript.

## Objetivos
1.  **Flexibilidad**: Permitir a los usuarios (especialmente profesores) organizar su espacio de trabajo arrastrando y soltando paneles.
2.  **Sincronización**: Transmitir la configuración del layout del profesor a todos los estudiantes en tiempo real.
3.  **Extensibilidad**: Sentar las bases para una interfaz "estilo Obsidian" en todo el sitio web de Musiki.

## Componentes Desacoplados
Los siguientes paneles han sido transformados de elementos estáticos del sidebar a componentes registrados en Dockview:
*   **Stage**: El escenario principal (donde ocurre la presentación/LilyPond/Mermaid).
*   **Chat**: Interfaz de comunicación en tiempo real.
*   **Notas**: Editor de notas colaborativo.
*   **Grid**: Mosaico de participantes y cámaras.
*   **Clase**: Material de apoyo y navegación de lecciones.

## Sincronización (LiveKit)
El flujo de sincronización utiliza el mensaje `session-workspace`:
1.  **Captura**: El profesor mueve un panel -> Dockview dispara `onLayoutChange`.
2.  **Transmisión**: Se extrae el JSON del layout y se envía via LiveKit Data Channel.
3.  **Recepción**: Los estudiantes reciben el JSON y ejecutan `fromJSON()`.

## Workspaces y Presets
Se implementa un gestor de Workspaces en el sidebar operacional (derecho) que permite:
*   Cargar presets configurados por el sistema (ej. "Modo Debate", "Modo Taller").
*   Guardar la disposición actual como un Workspace personalizado.

## Guía de Desarrollo
Para añadir un nuevo Pod:
1.  Crear el componente `.astro` de forma aislada.
2.  Registrar el componente en el mapa de fábricas de `RoomWorkspaceManager.ts`.
3.  Añadir el identificador único a la lógica de inicialización.

## Extensibilidad (Estilo Obsidian)
Para llevar esta tecnología a otras partes de Musiki (ej. la vista de Notas general):
1.  **Reutilización**: La clase `RoomWorkspaceManager.ts` puede generalizarse a una base `DockviewManager.ts`.
2.  **Múltiples Pestañas**: En la vista de notas, se puede usar Dockview para abrir múltiples archivos `.md` en pestañas paralelas o mosaicos divididos, simplemente inyectando el ID del contenido de la nota en el panel.
3.  **Persistencia**: El sistema ya está preparado para guardar el estado del layout en `localStorage`, lo que permite que el usuario recupere su "mosaico personalizado" al volver a visitar la página.

