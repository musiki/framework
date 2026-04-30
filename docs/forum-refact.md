# estado de foro 

## Opción A — Actualizaciones optimistas (mejor UX): 
  al hacer una acción, mutás forumState en memoria inmediatamente (ej: filtrás el post borrado del array, actualizás el texto editado, agregás el reply nuevo) y llamás solo renderPosts() o renderThreadList() localmente, sin fetch. La llamada al servidor va en paralelo. Si falla, revertís el estado y mostrás el error. Resultado: cero latencia perceptible.

## Opción B — Re-fetch selectivo (más seguro, menos cambio): 
  en vez de siempre llamar loadThreads() (que recarga todo), usás una función reloadCurrentThread() que solo hace el GET de los posts del hilo activo.
  Solo acciones que afectan la lista de hilos (crear/borrar hilo) llaman  loadThreads(). Reduce el problema ~80% con poco riesgo.
  
## Opción C — Edición in-place sin re-render:
para ediciones de texto y borrado de posts, ni siquiera re-renderizás — encontrás el nodo DOM del
post afectado por data-post-id y lo mutás o removés directamente.

  Mi recomendación: B primero, C para delete. Son cambios quirúrgicos que


# 260430 Forum refaction to gain speed and portin to FORO POD

## El problema de raíz

  El foro hace loadThreads() después de cada acción — eso re-fetcha tody
  reconstruye el DOM desde cero. Discord nunca hace eso: cada mensaje que
  llega o se borra es una operación quirúrgica sobre el DOM. La percepción
  de solidez viene de que el estado visual nunca "desaparece y reaparece".

### Lo que ya tenés a favor

  forumState ya existe como objeto en memoria con threads[] y posts[]. El
  problema es que se trata como un caché descartable (siempre se
  sobreescribe desde el servidor) en lugar de la fuente de verdad. El
  cambio conceptual es: las mutaciones van primero al estado, el servidor
  confirma después.

  Lo que realmente necesitás para sentirse como Discord

  No es full option A genérica — es tres cosas concretas:

  1. Append para posts nuevos: cuando enviás un mensaje, construís el card
  localmente con un ID temporal, lo insertás al final de la lista, mandás
  al servidor. Cuando el servidor responde con el ID real, swapeás el
  temporal. Si falla, removés el card y mostrás error. Cero re-render del
  resto.
  2. Remove in-place para delete: encontrás el nodo por data-post-id, lo
  removés del DOM y de forumState.posts, mandás DELETE al servidor. Si
  falla, lo reinsertas. No tocás nada más.
  3. Update in-place para edit: encontrás el nodo, actualizás el contenido
  del body, mandás PATCH. Si falla, revertís el texto. El resto del árbol
  no se toca.

  Los hilos siguen el mismo patrón pero son menos frecuentes.

  Lo que NO necesitás hacer

  - No necesitás rollback sofisticado con snapshots profundos
  - No necesitás optimismo en las acciones de moderación (pin, etc.) — esas
   son raras
  - loadThreads completo sigue existiendo para la carga inicial y para un
  botón de refresh manual

  ---
###   Para el pod en el room

  Dos opciones reales:

  Iframe `(<iframe src="/foro">)` — más simple, funciona hoy, auth por
  cookies, zero código duplicado. La contra: si querés que el room
  reaccione a eventos del foro (ej: mostrar notificación de mensaje nuevo
  en la barra del room), necesitás postMessage. Aceptable.

  Componente embebido — extraer la lógica del foro de foro.astro a un
  módulo JS instanciable, y montar una instancia dentro del pod. Más limpio
   a largo plazo, permite compartir estado con el room, pero requiere
  refactorizar el foro primero (que igual conviene hacer para las
  actualizaciones optimistas). Es el camino correcto si el foro va a estar
  vivo en el room, no solo visible.


  
### Mi sugerencia de secuencia

  1. Refactorizar el foro para que la lógica viva en un módulo exportable
  (no un script inline gigante en foro.astro) — esto desbloquea tanto las
  actualizaciones in-place como el embedding en el pod
  2. Implementar las tres mutaciones in-place (append, remove, update)
  3. Montar el módulo en el pod

## Arquitectura de la extracción

### Archivos nuevos:
  - src/scripts/forum-reader.ts — toda la lógica JS del foro exportada como
   mountForumReader(root, config). Retorna un controller con destroy().
  - src/styles/forum-reader.css — CSS del foro con selector raíz cambiado
  de #forum-reader-root a [data-forum-root] (permite múltiples instancias).

### Cambios en foro.astro:
  - HTML: reemplazar los 22 id="forum-xxx" por data-forum-xxx (los IDs
  únicos rompen múltiples instancias)
  - CSS` <style>:` borrar y reemplazar por import al nuevo archivo CSS
  - `<script is:inline>:` borrar, reemplazar por `<script>import {
  mountForumReader } from `'../scripts/forum-reader.ts'</script>
  - La página queda como wrapper thin (~400 líneas en vez de 4100)

###  Mutaciones in-place (dentro del módulo):
  - removePostOptimistic(postId) → filtra forumState.posts, hace .remove()
  en el DOM
  - appendPostOptimistic(post) → agrega a state, construye el card
  (reutilizando la función de render existente para un nodo), inserta al
  final
  - updatePostOptimistic(postId, newBody, newRendered) → actualiza staty
  el nodo .forum-post-body
  - removeThreadOptimistic(threadId) → igual para hilos
  - Todos con rollback: si el fetch falla, revierten el cambio de estady
  re-renderizan solo lo afectado

###  Pod en room:
  únicos rompen múltiples instancias)
  - CSS `<style>`: borrar y reemplazar por import al nuevo archivo CSS
  - `<script is:inline>`: borrar, reemplazar por `<script>import {
  mountForumReader } from ../scripts/forum-reader.ts`</script>`
  - La página queda como wrapper thin (~400 líneas en vez de 4100)

###  Mutaciones in-place (dentro del módulo):
  - `removePostOptimistic(postId)` → filtra forumState.posts, hace
`  .remove() `en el DOM   
  - appendPostOptimistic(post) → agrega a state, construye el card
  (reutilizando la función de render existente para un nodo), inserta al   final
  - updatePostOptimistic(postId, newBody, newRendered) → actualiza state
   y el nodo .forum-post-body
  - removeThreadOptimistic(threadId) → igual para hilos
  - Todos con rollback: si el fetch falla, revierten el cambio de estado y re-renderizan solo lo afectado

### Pod en room:
  - Nuevo pod template [data-pod-template="forum"] en PodTemplates.astro
  - HTML idéntico al de foro.astro pero con root data-forum-root
  - CSS override en `<style is:global>`: [data-pod-template="forum"]
  [data-forum-root] → fondo negro, texto más grande, scroll contenido    
   - En livekit-room.ts: onForumInit(container) → llama
  mountForumReader(container.querySelector('[data-forum-root]'), config)
  - config viene del room state (courseId, canModerate, etc.)

### Media modal: 
 se crea dinámicamente en JS (.appendChild to
  document.body), se limpia en destroy(). Esto es imprescindible para
  que el pod no tenga un modal flotante permanente en el DOM.

---
  Es trabajo importante pero bien delimitado. La extracción a módulo y
  el CSS son independientes entre sí y los puedo hacer en paralelo.
