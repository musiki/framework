// src/scripts/course/dockview-shell.ts
import type { DockviewComponent } from 'dockview-core';

export type NoteMode = 'preview' | 'edit';

export function injectWorkspaceCss(containerId: string) {
  if (document.querySelector('[data-cnw-ws-css]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-cnw-ws-css', '1');
  style.textContent = `
    /* Apply workspace sizing only while Dockview owns the content area. */
    #${containerId}.content-area {
      --dv-sash-color: var(--c-border, rgba(120,120,140,0.35));
      --dv-active-sash-color: var(--c-link, #3b82f6);
    }
    #${containerId}.content-area.is-dockview-active {
      padding: 0 !important;
      overflow: hidden !important;
    }
    /* Hide ALL native dockview tabs — scoped to our container */
    #${containerId} .dv-header,
    #${containerId} .dv-tab-container,
    #${containerId} .dv-tab,
    #${containerId} .dv-tab-divider,
    #${containerId} .dv-tab-separator,
    #${containerId} .dv-tabs-and-actions-container {
      height: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      border: none !important;
      visibility: hidden !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Keep separator for split functionality */
    #${containerId} .dv-separator {
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      background: var(--c-border, rgba(120,120,140,0.15)) !important;
    }

    /* DIY Shell */
    .cnw-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      overflow: hidden;
      background: var(--c-bg);
      position: relative;
      border: 1px solid var(--c-border, rgba(120,120,140,0.18));
      border-radius: 4px;
      box-sizing: border-box;
    }
    .cnw-shell.cnw-drag-over,
    .cnw-shell.cnw-external-drag-over {
      outline: 2px solid color-mix(in srgb, var(--c-link, #3b82f6) 62%, transparent);
      outline-offset: -2px;
      background: color-mix(in srgb, var(--c-link, #3b82f6) 7%, var(--c-bg));
    }

    /* Transparent header — the drag zone */
    .cnw-header {
      position: relative;
      width: 100%;
      height: 22px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      background: transparent;
      cursor: grab;
      user-select: none;
      padding: 0 6px;
      box-sizing: border-box;
      gap: 6px;
    }
    .cnw-header:active { cursor: grabbing; }
    .cnw-header.is-dragging { opacity: .4; }

    /* Drag handle — six dots grid */
    .cnw-handle {
      display: inline-grid;
      grid-template-columns: repeat(2, 3px);
      grid-template-rows: repeat(3, 3px);
      gap: 2px;
      opacity: 0.7;
      flex-shrink: 0;
      pointer-events: none;
    }
    .cnw-handle span {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--c-fg-dim, currentColor);
      display: block;
    }

    /* Note title — subtle but always visible */
    .cnw-title {
      font-size: 12.65px;
      color: var(--c-fg);
      opacity: 0.8;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: 0.02em;
      pointer-events: none;
    }

    /* Status dot */
    .cnw-status {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 300ms, background 200ms;
    }
    .cnw-status.pending { background: var(--c-fg-dim); opacity: 1; }
    .cnw-status.saving  { background: var(--c-link, #3b82f6); opacity: 1; animation: cnw-pulse 800ms infinite; }
    .cnw-status.error   { background: #c87e7e; opacity: 1; }
    @keyframes cnw-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }

    /* Header icon buttons: pencil, split, close */
    .cnw-mode-btn {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--c-fg-dim);
      opacity: 0;
      line-height: 1;
      font-size: 13.8px;
      transition: opacity 160ms, color 160ms;
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .cnw-shell:hover .cnw-mode-btn { opacity: 0.6; }
    .cnw-mode-btn:hover { opacity: 1 !important; color: var(--c-fg); }
    .cnw-close-btn:hover { color: #c87e7e !important; }
    .cnw-mode-btn.is-active { opacity: 1 !important; color: var(--c-link, #3b82f6) !important; }

    /* HUD icon buttons — cohesive with ribbon flat style */
    .cnw-hud-icon-btn {
      border: none;
      background: none;
      cursor: pointer;
      padding: 0 3px;
      color: inherit;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 1;
      flex-shrink: 0;
      position: relative;
      transition: color 120ms;
    }
    .cnw-hud-icon-btn:hover { color: var(--c-fg); }
    .cnw-hud-icon-btn.is-active { color: var(--c-link, #3b82f6) !important; }
    /* CSS tooltip — floats above the button, inside panel bounds */
    .cnw-hud-icon-btn::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 6px);
      right: 0;
      background: color-mix(in srgb, var(--c-bg, #111) 93%, var(--c-fg) 7%);
      border: 1px solid var(--c-border, rgba(120,120,140,.3));
      color: var(--c-fg, #e5e5e5);
      font-size: .713rem;
      white-space: nowrap;
      padding: 3px 7px;
      border-radius: 4px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 140ms 180ms;
      z-index: 200;
      font-family: var(--font-ui, system-ui, sans-serif);
    }
    .cnw-hud-icon-btn:hover::after { opacity: 1; }
    .cnw-hud-download {
      position: relative;
      display: flex;
      align-items: center;
    }
    .cnw-hud-download-menu {
      position: absolute;
      right: 0;
      bottom: calc(100% + 6px);
      min-width: 148px;
      padding: 4px;
      border: 1px solid var(--c-border, rgba(120,120,140,.3));
      border-radius: 4px;
      background: color-mix(in srgb, var(--c-bg, #111) 94%, var(--c-fg) 6%);
      box-shadow: 0 8px 22px rgba(0,0,0,.22);
      z-index: 260;
      display: none;
    }
    .cnw-hud-download.is-open .cnw-hud-download-menu {
      display: grid;
      gap: 2px;
    }
    .cnw-hud-download-menu button {
      width: 100%;
      border: none;
      background: transparent;
      color: var(--c-fg);
      text-align: left;
      font: inherit;
      font-size: .74rem;
      padding: 5px 7px;
      border-radius: 3px;
      cursor: pointer;
      white-space: nowrap;
    }
    .cnw-hud-download-menu button:hover {
      background: color-mix(in srgb, var(--c-link, #3b82f6) 16%, transparent);
    }

    /* Panel body */
    .cnw-body {
      flex: 1;
      overflow: auto;
      min-height: 0;
      position: relative;
    }

    /* Recovery banner */
    .cnw-recovery {
      position: absolute;
      top: 0; left: 0; right: 0;
      background: var(--c-bg-surface, var(--c-bg-mute));
      border-bottom: 1px solid var(--c-border);
      padding: 6px 12px;
      font-size: 12.65px;
      color: var(--c-fg);
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 10;
    }
    .cnw-recovery button {
      font-size: 12.65px;
      padding: 2px 8px;
      border-radius: 3px;
      border: 1px solid var(--c-border);
      background: none;
      color: var(--c-fg);
      cursor: pointer;
    }

    /* Unified prose-editor — no border box, CM looks like a document */
    .cnw-body .cm-editor { background: transparent !important; height: 100%; }
    .cnw-body .cm-scroller { padding: 1.2rem 0.5rem 1.2rem 1.5rem !important; font-size: calc(var(--font-size-base, 1rem) * 1.15); line-height: 1.72; overflow: auto; }
    .cnw-body .cm-content { caret-color: var(--c-link, #3b82f6) !important; }
    .cnw-body .cm-focused { outline: none !important; }
    /* The shell owns the title row; the YAML strip remains available below it. */
    .cnw-body #nie-editor-panel > div:first-child { display: none !important; }
    .cnw-body #nie-editor-panel { flex: 1; height: 100%; }

    /* TraceCode Help Modal Styles */
    .trace-info-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 220ms ease;
    }
    .trace-info-modal-backdrop.is-active {
      opacity: 1;
      pointer-events: auto;
    }
    .trace-info-modal-container {
      width: min(840px, 92vw);
      max-height: 85vh;
      background: var(--c-bg, #1e1e24);
      border: 1px solid var(--c-border, rgba(120,120,140,0.25));
      border-radius: 8px;
      box-shadow: 0 20px 45px rgba(0,0,0,0.35);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform: scale(0.96) translateY(12px);
      transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .trace-info-modal-backdrop.is-active .trace-info-modal-container {
      transform: scale(1) translateY(0);
    }
    .trace-info-modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.18));
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .trace-info-modal-title {
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--c-fg);
      margin: 0;
    }
    .trace-info-modal-close-btn {
      background: none;
      border: none;
      color: var(--c-fg-dim);
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 120ms;
    }
    .trace-info-modal-close-btn:hover {
      color: var(--c-fg);
    }
    .trace-info-modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 24px 28px;
      color: var(--c-fg);
      font-size: 0.94rem;
      line-height: 1.68;
    }
    .trace-info-modal-body h2 {
      font-size: 1.28rem;
      margin-top: 1.8rem;
      margin-bottom: 0.8rem;
      font-weight: 600;
      color: var(--c-fg);
      border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.12));
      padding-bottom: 6px;
    }
    .trace-info-modal-body h3 {
      font-size: 1.06rem;
      margin-top: 1.4rem;
      margin-bottom: 0.5rem;
      font-weight: 600;
      color: var(--c-link, #3b82f6);
    }
    .trace-info-modal-body p {
      margin-bottom: 1rem;
      opacity: 0.9;
    }
    .trace-info-modal-body ul {
      margin-bottom: 1.2rem;
      padding-left: 20px;
    }
    .trace-info-modal-body li {
      margin-bottom: 0.5rem;
      opacity: 0.9;
    }
    .trace-info-modal-body code {
      font-family: var(--font-mono, monospace);
      background: rgba(0,0,0,0.15);
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 0.88rem;
    }
    .trace-info-modal-body pre {
      font-family: var(--font-mono, monospace);
      background: rgba(0,0,0,0.22);
      padding: 14px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.85rem;
      line-height: 1.4;
      margin-bottom: 1.2rem;
      border: 1px solid var(--c-border, rgba(120,120,140,0.15));
    }
    .trace-info-modal-body table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
      margin-bottom: 1.5rem;
      font-size: 0.88rem;
    }
    .trace-info-modal-body th, .trace-info-modal-body td {
      border: 1px solid var(--c-border, rgba(120,120,140,0.2));
      padding: 8px 12px;
      text-align: left;
    }
    .trace-info-modal-body th {
      background: rgba(0,0,0,0.15);
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);
}

// Define global helper for TraceCode info modal
(window as any).openTraceInfoModal = function openTraceInfoModal() {
  let backdrop = document.getElementById('trace-info-modal');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'trace-info-modal';
    backdrop.className = 'trace-info-modal-backdrop';

    const container = document.createElement('div');
    container.className = 'trace-info-modal-container';

    const header = document.createElement('div');
    header.className = 'trace-info-modal-header';
    header.innerHTML = `
      <h2 class="trace-info-modal-title">Manual de Referencia: TraceCode</h2>
      <button class="trace-info-modal-close-btn" aria-label="Cerrar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    const body = document.createElement('div');
    body.className = 'trace-info-modal-body';
    body.innerHTML = `
      <p>Este monitor es un <strong>editor de traza temática (thematic trace editor)</strong> diseñado para hacer visible la estructura conceptual y funcional del texto a nivel de párrafo a medida que se escribe. <strong>No utiliza Inteligencia Artificial (IA) ni Procesamiento de Lenguaje Natural (PLN) por defecto</strong> (o lo hace únicamente en herramientas específicas y autorizadas explícitamente por el usuario bajo un contrato de <strong>Escritura Asimilativa y Atención Sostenida (EAAS)</strong>, un modelo ético de composición académica que protege la atención profunda, la no-dispersión cognitiva, la asimilación reflexiva de las ideas al razonamiento humano, su mutación orgánica y la re-inyección subjetiva del pensamiento del autor); en su lugar, valida el modelo de datos unificado de TraceCode demostrando la utilidad de la interfaz de margen antes de incorporar modelos probabilísticos externos.</p>
      
      <p>Su propósito principal es asistir al escritor en la detección de patrones estructurales:</p>
      <ul>
        <li><strong>Roles retóricos:</strong> Determina qué función cumple cada párrafo dentro del género discursivo (p. ej., definición, contraste, ejemplo, síntesis).</li>
        <li><strong>Progresión conceptual:</strong> Identifica cómo se introducen, reúsan, transforman o abandonan los conceptos.</li>
        <li><strong>Brechas discursivas:</strong> Señala anomalías lógicas, tales como conceptos que se introducen pero nunca se vuelven a retomar (huérfanos), o saltos temáticos demasiado abruptos.</li>
      </ul>

      <h2>Bases Teóricas y Conceptos Clave</h2>
      <p>El marco conceptual de TraceCode integra cuatro teorías clásicas del análisis textual y la lingüística sistémico-funcional, adecuadas para el nivel de posgrado:</p>

      <h3>1. Progresión Temática (Daneš, 1974)</h3>
      <p>Describe el flujo y desarrollo de la información en el texto a través del enlace entre el <strong>Tema</strong> (información conocida) y el <strong>Rema</strong> (información nueva) [Danes74]. Permite estructurar la progresión mediante tres métodos principales:</p>
      <ul>
        <li><em>Progresión Lineal Simple:</em> El rema de una oración se convierte en el tema de la siguiente.</li>
        <li><em>Progresión con Tema Constante:</em> Oraciones sucesivas comparten el mismo tema pero introducen remas distintos.</li>
        <li><em>Progresión con Temas Derivados (Hipertema):</em> Los temas de las oraciones derivan de un tema general común u organizador de mayor orden.</li>
      </ul>

      <h3>2. Rhetorical Structure Theory (RST) (Mann & Thompson, 1988)</h3>
      <p>Analiza la organización jerárquica y funcional de los textos a través de relaciones funcionales entre segmentos [Mann88]. Los métodos identifican cómo los segmentos se vinculan mediante:</p>
      <ul>
        <li><em>Relación Núcleo-Satélite:</em> El Núcleo contiene la aserción central esencial, mientras que el Satélite ofrece información de soporte (p. ej., <em>Evidencia</em>, <em>Causa</em>, <em>Elaboración</em>).</li>
        <li><em>Relaciones Esquematicas Multinucleares:</em> Elementos de igual peso retórico coordinados sin subordinación (p. ej., <em>Contraste</em>, <em>Lista</em>).</li>
      </ul>

      <h3>3. Análisis de Cohesión (Halliday & Hasan, 1976)</h3>
      <p>Estudia los mecanismos semánticos (lazos cohesivos) que permiten que un texto sea percibido como una unidad coherente y no como oraciones aisladas [Halliday76]. Sus métodos clasifican la cohesión en:</p>
      <ul>
        <li><em>Cohesión Léxica:</em> Reiteración de términos (repetición exacta, sinonimia, hiponimia) y colocación.</li>
        <li><em>Cohesión Gramatical:</em> Dispositivos como referencia (anafórica/catafórica), sustitución, elipsis y conectores conjuntivos.</li>
      </ul>

      <h3>4. Movimientos de Género (Swales, 1990)</h3>
      <p>Considera el texto como una estructura retórica dividida en pasos comunicativos u orientados a un propósito ("moves") dentro de una comunidad académica o disciplinar [Swales90]. Sus métodos guían la progresión retórica por secuencias estandarizadas, p. ej., el modelo CARS (Creating a Research Space):</p>
      <ul>
        <li><em>Move 1:</em> Establecer el territorio (relevancia del tema).</li>
        <li><em>Move 2:</em> Establecer el nicho (indicar la brecha o pregunta de investigación).</li>
        <li><em>Move 3:</em> Ocupar el nicho (presentar el estudio actual o la contribución).</li>
      </ul>

      <h3>5. Escritura Creativa y Narratología (Labov, 1972)</h3>
      <p>Aplica un análisis estructural a textos no argumentativos (como en el modo <em>Lit Art</em>) basándose en la estructura de la narrativa personal descrita por William Labov [Labov72]. En lugar de argumentos lógicos, se estudian los elementos constituyentes de la experiencia narrada:</p>
      <ul>
        <li><strong>Apertura de escena e Imagen:</strong> Establecen la orientación espacial, temporal y el tono sensorial.</li>
        <li><strong>Introducción y Retorno de Motivo:</strong> Rastrean la recurrencia de elementos simbólicos u objetos conductores (leitmotivs).</li>
        <li><strong>Cambio de voz e Interrupción:</strong> Marcan transiciones de focalización o quiebres formales.</li>
      </ul>
      <p>Roles retóricos disponibles en el modo <strong>Lit Art</strong>:</p>
      <table>
        <thead>
          <tr>
            <th>Rol</th>
            <th>Código</th>
            <th>Definición</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Apertura de escena</td><td>APE</td><td>Sitúa espacio, tiempo, atmósfera o condiciones iniciales de una escena.</td></tr>
          <tr><td>Imagen</td><td>IMG</td><td>Construye una imagen sensorial, simbólica o perceptiva dominante.</td></tr>
          <tr><td>Introducción de motivo</td><td>INT</td><td>Introduce un objeto, gesto, palabra, sonido, figura o imagen que puede retornar después.</td></tr>
          <tr><td>Retorno de motivo</td><td>RET</td><td>Retoma un motivo anterior, de forma idéntica, desplazada o transformada.</td></tr>
          <tr><td>Variación</td><td>VAR</td><td>Repite un elemento con diferencia de tono, escala, perspectiva, función o intensidad.</td></tr>
          <tr><td>Cambio de voz</td><td>VOZ</td><td>Modifica la voz narrativa, focalización, registro, distancia o posición enunciativa.</td></tr>
          <tr><td>Interrupción</td><td>ITR</td><td>Corta una continuidad narrativa, perceptiva, sintáctica o argumental.</td></tr>
          <tr><td>Descripción</td><td>DES</td><td>Detiene el avance para precisar cualidades de lugar, cuerpo, objeto, atmósfera o textura.</td></tr>
          <tr><td>Acción</td><td>ACC</td><td>Hace avanzar una secuencia mediante eventos, movimientos o transformaciones.</td></tr>
          <tr><td>Memoria</td><td>MEM</td><td>Introduce una temporalidad retrospectiva, una evocación o una capa de recuerdo.</td></tr>
          <tr><td>Diálogo</td><td>DIA</td><td>Organiza intercambio verbal, pseudo-verbal o polifónico entre voces.</td></tr>
          <tr><td>Tensión</td><td>TEN</td><td>Acumula conflicto, expectativa, contradicción, amenaza o inestabilidad.</td></tr>
          <tr><td>Giro</td><td>GIR</td><td>Produce un cambio semántico, narrativo, perceptivo o afectivo.</td></tr>
          <tr><td>Elipsis</td><td>ELI</td><td>Omite una transición o acontecimiento, dejando una discontinuidad significativa.</td></tr>
          <tr><td>Montaje</td><td>MON</td><td>Yuxtapone fragmentos, imágenes, tiempos o materiales sin subordinarlos a una linealidad explícitamente lógica.</td></tr>
          <tr><td>Resonancia</td><td>RES</td><td>Hace que un elemento anterior reaparezca como eco, atmósfera o asociación.</td></tr>
          <tr><td>Cierre</td><td>CIE</td><td>Cierra una escena, motivo, secuencia o etapa del proceso.</td></tr>
          <tr><td>Reflexión</td><td>REF</td><td>Suspende la acción o interpreta críticamente una experiencia o hallazgo.</td></tr>
        </tbody>
      </table>

      <h3>6. Investigación Artística y Práctica como Investigación (Borgdorff, 2012)</h3>
      <p>En el modo de <em>Investigación Artística</em>, el texto opera en la frontera entre la práctica artística y la reflexión académica, caracterizándose por el valor epistémico de la práctica misma [Borgdorff12]. Las trazas no miden coherencia lógica tradicional, sino el registro y análisis crítico de la toma de decisiones:</p>
      <ul>
        <li><strong>Nota de proceso y Observación material:</strong> Documentan los acontecimientos del taller/estudio y el comportamiento de los materiales o soportes.</li>
        <li><strong>Decisiones y Descartes:</strong> Mapean el rumbo del proceso y la argumentación de las elecciones.</li>
        <li><strong>Feedback e Iteración:</strong> Rastrean las respuestas del entorno (pares o modelos de IA) y su asimilación en la obra.</li>
      </ul>
      <p>Roles retóricos disponibles en el modo <strong>Investigación Artística</strong>:</p>
      <table>
        <thead>
          <tr>
            <th>Rol</th>
            <th>Código</th>
            <th>Definición</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Nota de proceso</td><td>NOT</td><td>Registra una sesión, paso o momento del desarrollo artístico.</td></tr>
          <tr><td>Pregunta artística</td><td>PRE</td><td>Formula el problema, hipótesis o tensión que orienta la práctica.</td></tr>
          <tr><td>Observación material</td><td>OBS</td><td>Describe cómo responde un sonido, cuerpo, objeto, interfaz, imagen, texto o dispositivo.</td></tr>
          <tr><td>Restricción técnica</td><td>RST</td><td>Identifica una limitación de medio, herramienta, soporte, código, espacio o dispositivo.</td></tr>
          <tr><td>Decisión</td><td>DEC</td><td>Explicita una elección compositiva, performativa, técnica o conceptual.</td></tr>
          <tr><td>Descarte</td><td>DES</td><td>Registra una posibilidad abandonada y la razón de su abandono.</td></tr>
          <tr><td>Variante</td><td>VRT</td><td>Compara versiones, alternativas o configuraciones de un mismo material.</td></tr>
          <tr><td>Método</td><td>MET</td><td>Procedimiento de trabajo, prueba, análisis, composición o montaje.</td></tr>
          <tr><td>Documentación</td><td>DOC</td><td>Vincula el proceso con evidencia: audio, imagen, video, partitura, patch, código, bitácora o registro.</td></tr>
          <tr><td>Ejemplo</td><td>EJE</td><td>Presenta un caso de estudio o ilustración concreta.</td></tr>
          <tr><td>Reflexión</td><td>REF</td><td>Suspende la acción o interpreta críticamente una experiencia o hallazgo.</td></tr>
          <tr><td>Análisis</td><td>ANA</td><td>Examina relaciones entre materiales, decisiones, efectos y resultados.</td></tr>
          <tr><td>Feedback de pares</td><td>PAR</td><td>Incorpora observaciones, críticas o comentarios de otras personas.</td></tr>
          <tr><td>Feedback IA</td><td>FIA</td><td>Registra una sugerencia, diagnóstico o clasificación producida por un modelo.</td></tr>
          <tr><td>Revisión</td><td>REV</td><td>Describe una modificación realizada después de feedback, prueba o comparación.</td></tr>
          <tr><td>Síntesis</td><td>SIN</td><td>Integra materiales, decisiones, problemas y resultados en una formulación general.</td></tr>
          <tr><td>Artefacto público</td><td>ART</td><td>Presenta o describe una salida: obra, prototipo, demo, concierto, instalación, publicación o entrega.</td></tr>
          <tr><td>Cierre</td><td>CIE</td><td>Cierra una escena, motivo, secuencia o etapa del proceso.</td></tr>
        </tbody>
      </table>

      <h3>Auditoría Textual y Concordancia</h3>
      <ul>
        <li><strong>Frecuencia Léxica (Word-Freq):</strong> Calcula la distribución y recurrencia de los términos clave para diagnosticar la centralidad conceptual de la nota.</li>
        <li><strong>Concordancia KWIC (Key Word In Context):</strong> Permite auditar en tiempo real la consistencia del uso conceptual, proyectando las palabras clave centradas con su contexto lingüístico inmediato a la izquierda y derecha.</li>
        <li><strong>NLP Pure Functions / Mirror NLP Functions (Futuro):</strong> Implementación de análisis sintáctico local y el Code Bar CM6 Extension en <code>trace-margin.ts</code> para renderizar la densidad retórica en el propio gutter del editor.</li>
      </ul>

      <h2>Herramientas y Arquitectura Técnica</h2>
      <p>La implementación actual y planificada en Musiki consta de los siguientes componentes:</p>
      <ol>
        <li><strong>Paragraph Segmenter:</strong> Algoritmo de lógica determinista que descompone el flujo de Markdown en párrafos lógicos mediante dobles saltos de línea e identificadores estables, validado rigurosamente mediante pruebas unitarias (p. ej., controlando acentos, caracteres en español y marcas estructurales).</li>
        <li><strong>Frequency Panel:</strong> Extractor que tabula las palabras clave con mayor peso conceptual, omitiendo automáticamente las palabras vacías (stopwords).</li>
        <li><strong>Concordance Panel:</strong> Interfaz interactiva de alineación KWIC para explorar la concordancia de términos en contexto.</li>
        <li><strong>Event Wiring:</strong> Sistema reactivo de mensajería (a través de eventos globales y CustomEvents del DOM) que sincroniza el editor de Markdown en tiempo real con las vistas analíticas colindantes.</li>
        <li><strong>State Management:</strong> Arquitectura de mapas y cachés que preserva el estado conceptual de los paneles y editores activos en el Dockview Workspace.</li>
        <li><strong>Orphan Detection (Detección de Huérfanos):</strong> Diagnóstico visual que resalta con un tinte distintivo rojo/translúcido las etiquetas o códigos aplicados a un único párrafo que carecen de continuación o relación asociativa.</li>
        <li><strong>Suggestion Chips (Chips de Sugerencia):</strong> Sugeridores automatizados que asisten en la codificación de temas detectando cadenas léxicas repetidas.</li>
        <li><strong>Self Review (Autorevisión):</strong> Flujo interactivo que permite al estudiante verificar y clasificar críticamente su propio avance temático.</li>
        <li><strong>LLM Assisted Classification (Futuro):</strong> Mapeo inteligente asistido por modelos de lenguaje locales para agilizar el etiquetado de roles retóricos y moves discursivos.</li>
        <li><strong>UAM Corpus Tool Export (Futuro):</strong> Exportación a formatos XML estándares compatibles con herramientas académicas de anotación de corpus (como UAM Corpus Tool).</li>
        <li><strong>TAACO Integration (Futuro):</strong> Incorporación de métricas cuantitativas automáticas inspiradas en TAACO (Tool for the Automatic Analysis of Cohesion) para evaluar cohesión local, global y enlaces sinónimos.</li>
      </ol>

      <h2>Referencias Bibliográficas (BibTeX)</h2>
      <pre>@incollection{Danes74,
  author    = {Dane{\\v{s}}, Franti{\\v{s}}ek},
  title     = {Functional sentence perspective and the organization of the text},
  booktitle = {Papers on functional sentence perspective},
  pages     = {106--128},
  year      = {1974},
  publisher = {Academia}
}

@book{Mann88,
  author    = {Mann, William C. and Thompson, Sandra A.},
  title     = {Rhetorical Structure Theory: Toward a functional theory of text organization},
  journal   = {Text-Interdisciplinary Journal for the Study of Discourse},
  volume    = {8},
  number    = {3},
  pages     = {243--281},
  year      = {1988}
}

@book{Halliday76,
  author    = {Halliday, Michael A. K. and Hasan, Ruqaiya},
  title     = {Cohesion in English},
  year      = {1976},
  publisher = {Longman}
}

@book{Swales90,
  author    = {Swales, John M.},
  title     = {Genre analysis: English in academic and research settings},
  year      = {1990},
  publisher = {Cambridge University Press}
}

@book{Labov72,
  author    = {Labov, William},
  title     = {Language in the Inner City: Studies in the Black English Vernacular},
  year      = {1972},
  publisher = {University of Pennsylvania Press}
}

@book{Borgdorff12,
  author    = {Borgdorff, Henk},
  title     = {The Conflict of the Faculties: Perspectives on Artistic Research and Academia},
  year      = {2012},
  publisher = {Leiden University Press}
}</pre>
    `;

    container.appendChild(header);
    container.appendChild(body);
    backdrop.appendChild(container);
    document.body.appendChild(backdrop);

    // Close events
    const closeBtn = header.querySelector('.trace-info-modal-close-btn');
    closeBtn?.addEventListener('click', () => {
      backdrop.classList.remove('is-active');
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('is-active');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop.classList.contains('is-active')) {
        backdrop.classList.remove('is-active');
      }
    });
  }

  // Force a reflow before adding the active class for smooth transition
  void backdrop.offsetWidth;
  backdrop.classList.add('is-active');
};

export function buildShell(
  panelId: string,
  slug: string,
  title: string,
  dockview: DockviewComponent,
  showHud = false,
): { shell: HTMLElement; bodyEl: HTMLElement; statusDot: HTMLElement; pencilBtn: HTMLButtonElement; splitRightBtn: HTMLButtonElement; splitBelowBtn: HTMLButtonElement; traceBtn: HTMLButtonElement; downloadBtn: HTMLButtonElement; downloadMenu: HTMLElement } {
  const shell = document.createElement('div');
  shell.className = 'cnw-shell';
  shell.dataset.panelId = panelId;

  // Header
  const header = document.createElement('div');
  header.className = 'cnw-header';

  // 6-dot drag handle
  const handle = document.createElement('span');
  handle.className = 'cnw-handle';
  for (let i = 0; i < 6; i++) {
    const dot = document.createElement('span');
    handle.appendChild(dot);
  }
  header.appendChild(handle);

  const titleEl = document.createElement('span');
  titleEl.className = 'cnw-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  const statusDot = document.createElement('span');
  statusDot.className = 'cnw-status';
  header.appendChild(statusDot);

  const pencilBtn = document.createElement('button');
  pencilBtn.className = 'cnw-mode-btn';
  pencilBtn.title = 'Alternar modo edición / vista previa';
  pencilBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  header.appendChild(pencilBtn);

  const splitRightBtn = document.createElement('button');
  splitRightBtn.className = 'cnw-mode-btn';
  splitRightBtn.title = 'Dividir a la derecha';
  splitRightBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`;
  header.appendChild(splitRightBtn);

  const splitBelowBtn = document.createElement('button');
  splitBelowBtn.className = 'cnw-mode-btn';
  splitBelowBtn.title = 'Dividir abajo';
  splitBelowBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="12" x2="21" y2="12"/></svg>`;
  header.appendChild(splitBelowBtn);

  const traceBtn = document.createElement('button');
  traceBtn.className = 'cnw-hud-icon-btn cnw-hud-trace-btn';
  traceBtn.title = 'Monitor de análisis';
  traceBtn.dataset.tooltip = 'Monitor — Trace, Léxico, Zipf y QA';
  traceBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><circle cx="7" cy="7" r="1.3" fill="currentColor" stroke="none"/></svg>`;

  const downloadWrap = document.createElement('span');
  downloadWrap.className = 'cnw-hud-download';
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'cnw-hud-icon-btn cnw-hud-download-btn';
  downloadBtn.type = 'button';
  downloadBtn.title = 'Descargar nota';
  downloadBtn.dataset.tooltip = 'Descargar';
  downloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`;
  const downloadMenu = document.createElement('div');
  downloadMenu.className = 'cnw-hud-download-menu';
  downloadMenu.innerHTML = `
    <button type="button" data-download-format="markdown">Bajar como Markdown</button>
    <button type="button" data-download-format="latex">Bajar como LaTeX</button>
    <button type="button" data-download-format="latex-template" data-latex-template="asignacion-seminario">Bajar LaTeX: asignación-seminario</button>
    <button type="button" data-download-format="latex-template" data-latex-template="tesina-seminario">Bajar LaTeX: tesina-seminario</button>
    <button type="button" data-download-format="pdf">Bajar como PDF</button>
  `;
  downloadWrap.append(downloadBtn, downloadMenu);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'cnw-mode-btn cnw-close-btn';
  closeBtn.title = 'Cerrar panel';
  closeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = dockview.getGroupPanel(panelId);
    if (panel) dockview.removePanel(panel);
  });
  header.appendChild(closeBtn);

  // Drag behaviour on header
  header.draggable = true;
  header.addEventListener('dragstart', e => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('musiki/panel-id', panelId);
    e.dataTransfer.setData('text/plain', panelId);
    e.dataTransfer.effectAllowed = 'move';
    header.classList.add('is-dragging');
  });
  header.addEventListener('dragend', () => header.classList.remove('is-dragging'));

  const resolveShellDropPosition = (e: DragEvent): 'left' | 'right' | 'top' | 'bottom' => {
    const rect = shell.getBoundingClientRect();
    const xRatio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const yRatio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    if (yRatio < 0.32) return 'top';
    if (yRatio > 0.68) return 'bottom';
    return xRatio < 0.5 ? 'left' : 'right';
  };

  // Drop target on shell (same pattern as room workspace)
  shell.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types.includes('musiki/panel-id')) return;
    e.preventDefault();
    shell.classList.add('cnw-drag-over');
  });
  shell.addEventListener('dragleave', e => {
    if (!shell.contains(e.relatedTarget as Node)) shell.classList.remove('cnw-drag-over');
  });
  shell.addEventListener('drop', e => {
    shell.classList.remove('cnw-drag-over');
    const srcId = e.dataTransfer?.getData('musiki/panel-id');
    if (!srcId || srcId === panelId) return;
    e.preventDefault();
    const srcPanel = dockview.getGroupPanel(srcId);
    const tgtPanel = dockview.getGroupPanel(panelId);
    if (srcPanel && tgtPanel) {
      dockview.moveGroupOrPanel({
        from: { groupId: srcPanel.group.id, panelId: srcId },
        to: { group: tgtPanel.group, position: resolveShellDropPosition(e) },
      });
    }
  });

  shell.appendChild(header);

  const body = document.createElement('div');
  body.className = 'cnw-body';
  shell.appendChild(body);

  if (showHud) {
    const hud = document.createElement('div');
    hud.className = 'cnw-hud';
    hud.style.cssText = 'display:flex;align-items:center;padding:0 .6rem;height:20px;flex-shrink:0;gap:8px;';

    const stats = document.createElement('span');
    stats.className = 'cnw-hud-stats';
    stats.style.cssText = 'font-size:.784rem;opacity:.7;font-family:var(--font-mono,monospace);flex:1';
    hud.appendChild(stats);
    hud.appendChild(downloadWrap);
    hud.appendChild(traceBtn);

    const infoBtn = document.createElement('button');
    infoBtn.className = 'cnw-hud-icon-btn cnw-hud-info-btn';
    infoBtn.title = 'Ayuda e Información Teórica de TraceCode';
    infoBtn.style.cssText = 'background:none;border:none;color:var(--c-fg);opacity:.6;cursor:pointer;padding:0 4px;font-family:var(--font-mono,monospace);font-weight:bold;font-size:14px;line-height:16px;display:flex;align-items:center;justify-content:center;';
    infoBtn.innerHTML = '?';
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof (window as any).openTraceInfoModal === 'function') {
        (window as any).openTraceInfoModal();
      }
    });
    hud.appendChild(infoBtn);

    shell.appendChild(hud);
  }

  return { shell, bodyEl: body, statusDot, pencilBtn, splitRightBtn, splitBelowBtn, traceBtn, downloadBtn, downloadMenu };
}
