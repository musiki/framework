# SA/SV Fixes & Features — Design Spec
**Fecha:** 2026-05-08  
**Scope:** Sonic Analyzer (SA) + Sonic Visualizer (SV) pods  
**Approach elegido:** B — Fixes + análisis progresivo + sync completo

---

## 1. Bug Fixes: Play/Stop, Loop, SEG

### 1.1 Play/Stop

**Síntoma:** clicking el botón ▶ mientras el audio reproduce no detiene el audio.  
**Causa hipotética:** re-inicialización del `SonicVisualizerController` sin limpiar event listeners → dos handlers concurrentes se cancelan.  
**Fix:**
- Reemplazar closures de `addEventListener` por un `AbortController` cuya signal se cancela en `dispose()`. Un solo handler activo por ciclo de vida del controller.
- Semántica: **play/pause** (pausa en posición actual, no rebobina).
- Estado visual: botón muestra `▶` parado, `⏸` reproduciendo via `data-active` + `updatePlayBtn()`.

### 1.2 Loop — feedback visual en tiempo real

**Síntoma:** arrastrar en el canvas no produce ningún overlay visible hasta soltar el mouse.  
**Causa:** `drawLoopOverlay()` solo se llama cuando `loopEnabled === true`, pero `loopEnabled` se activa en `pointerup`.  
**Fix:** dibujar el overlay también cuando `isLoopDragging && loopOut > loopIn` — preview en tiempo real durante el drag.

### 1.3 Loop — restart "jumpy"

**Síntoma:** el loop salta erráticamente en vez de reiniciar limpiamente.  
**Causa:** el RAF a ~60fps puede disparar `startPlayback(loopIn)` múltiples veces consecutivas cuando `getCurrentPosition() >= loopOut - 0.05`.  
**Fix:** guardar `lastLoopRestartAt: number` (en `audioCtx.currentTime`). Skipear restart si `audioCtx.currentTime - lastLoopRestartAt < 0.15`.

### 1.4 Interacción canvas — separación click / drag / SEG

Nueva tabla de interacciones (reemplaza la lógica actual):

| Acción del puntero | Resultado |
|--------------------|-----------|
| `pointerdown` + `pointerup` sin mover (< 5px) sobre un SEG | Snap loop al segmento. Segundo click sobre mismo SEG = quitar loop |
| `pointerdown` + `pointerup` sin mover (< 5px) fuera de SEG | Seek a esa posición |
| `pointerdown` + move > 5px (cualquier zona) | Loop drag libre: overlay en tiempo real. Al soltar, activa loop si `loopOut > loopIn` |
| `Escape` | Quitar loop |

Implementación: el SEG snap se evalúa en `pointerup` si `!isDragging && !isLoopDragging`, no en `pointerdown`. Esto elimina la competencia entre snap y drag.

---

## 2. Pipeline de Análisis Progresivo

### 2.1 Problema actual

SA carga Essentia → analiza → manda todo junto → SV espera ~2 minutos sin feedback. SV no puede reproducir hasta recibir `sa:file-ready`.

### 2.2 Nuevo pipeline (3 fases)

```
FILE DROP en SA
   │
   ├─ FASE 1 (< 1s): decodeAudioData()
   │     Evento nuevo: sa:file-decoded { audioBuffer, fileName, duration }
   │     SV recibe: dibuja waveform, habilita ▶/seek, status = "listo"
   │     Layer buttons (SPEC/ENR/BRT/MOT/GRV/TEN/SEG): disabled + 50% opacity
   │
   ├─ FASE 2 (background, segundos/minutos): computeVizFeatures()
   │     Eventos de progreso: sa:analysis-progress { phase, percent }
   │     phases: 'melspec' → 'chroma' → 'pitch' → 'segments'
   │     SV status bar: "Analizando… melspec 25%" progresivamente
   │
   └─ FASE 3 (completo): sa:file-ready (evento existente)
         SV: activa overlays, habilita layer buttons
```

### 2.3 Cambios en SA `loadFile()`

```ts
// 1. Decode inmediato
this.fileBuffer = await ctx.decodeAudioData(await file.arrayBuffer());
window.dispatchEvent(new CustomEvent('sa:file-decoded', {
  detail: { buffer: this.fileBuffer, fileName: file.name }
}));

// 2. Análisis en background (no awaiteado bloqueo)
if (this.essentia) void this.computeVizFeatures(); // emite progress + file-ready
else this.setStatus(`file ready · ${file.name}`);
```

### 2.4 Progress events en `computeVizFeatures()`

Emitir `sa:analysis-progress` después de cada phase:
- `{ phase: 'melspec', percent: 25 }` — tras computar melspectrograma
- `{ phase: 'chroma', percent: 50 }` — tras extraer chroma
- `{ phase: 'pitch', percent: 75 }` — tras extraer pitch/key/bpm
- `{ phase: 'segments', percent: 100 }` — justo antes de `sa:file-ready`

### 2.5 SA activa/inactiva no bloquea decode

El decode corre siempre al dropear un archivo (SA activa o no). `computeVizFeatures()` solo corre si Essentia está cargado. Si SA no está activa, el análisis se lanza en cuanto el usuario activa SA y ya hay un `fileBuffer` cargado.

---

## 3. Sync SA/SV — Espejo Completo Teacher → Students

### 3.1 SA on/off

**Problema:** `applyRemoteState(active)` solo actualiza el status text.  
**Fix:**
```ts
public applyRemoteState(active: boolean): void {
  if (active === this.active) return;
  void this.toggle(); // espejo completo: carga Essentia, analiza audio propio
}
```

### 3.2 Sync al join

Cuando un participant se conecta, el teacher publica:
- `sa-state` (ya existe en línea 12145 de livekit-room.ts)
- `sv-layer` para cada layer activo (nuevo)
- `sv-loop` si hay un loop activo (nuevo)
- `sv-playback` con el offset actual (nuevo)

Patrón: igual al `publishTeacherState()` existente, agregar SA/SV al bloque.

### 3.3 Modelo de permisos

```
localRole === 'teacher'   → controla SA y SV siempre
localRole === 'student'   →
    allowStudents === true  → puede emitir mensajes SA/SV (controla)
    allowStudents === false → recibe sync, no puede emitir (read-only)
```

`allowStudents` se toma del flag existente del pod RE. SA y SV exponen:
```ts
public setAllowStudents(allow: boolean): void { this.allowStudents = allow; }
private canControl(): boolean {
  return this.localRole === 'teacher' || this.allowStudents;
}
```

Antes de cada `publish()` en SA y SV: `if (!this.canControl()) return;`  
Los botones permanecen visibles en read-only pero no disparan acciones de red.

### 3.4 Tabla de mensajes actualizada

| Mensaje | Se envía | Se aplica | Cambio |
|---------|----------|-----------|--------|
| `sa-state` | ✅ | ❌ solo status | **Fix: activar/desactivar SA real** |
| `sa-file-sync` | ✅ | ✅ | sin cambios |
| `sa:analysis-progress` | window event (local) | N/A | nuevo evento local |
| `sv-playback` | ✅ | ✅ (bug loop) | fix loop restart |
| `sv-layer` | ✅ | ✅ | + sync al join |
| `sv-loop` | ✅ | ✅ | + sync al join |
| sv sync al join | ❌ | ❌ | **nuevo: publishSVState()** |

---

## 4. Tooltips con MathJax — 4 capas

### 4.1 Implementación técnica

- `title` HTML no soporta MathJax.
- Implementar tooltip CSS puro con `data-tip` attribute + elemento `.sv-tip-content` oculto.
- Al primer hover, llamar `MathJax.typesetPromise([tipEl])` (lazy render).
- MathJax ya está disponible en las páginas de room.
- SV layer buttons: tooltip compacto (2 capas: fórmula + atribución).
- SA descriptores: tooltip completo (4 capas).

### 4.2 Estructura por descriptor (4 capas)

```
① Nombre + fórmula compacta (LaTeX inline)
② Explicación matemática desplegada (2-3 oraciones)
③ Ejemplo perceptual/musical
④ "Desarrollado por X, Año, Institución/Lab"
```

### 4.3 Contenido — SV layer buttons

| Botón | Capa ① | Capa ② resumida | Atribución |
|-------|--------|-----------------|------------|
| **SPEC** | `\|X(f,t)\|^2` STFT | Intensidad espectral por ventana temporal | Gabor, 1946; STFT popularizado en MIR por Serra, 1989, IRCAM |
| **WAV** | `x(t)` forma de onda | Amplitud instantánea normalizada | Shannon, 1948, Bell Labs |
| **ENR** | `E=\sqrt{\frac{1}{N}\sum x_i^2}` | RMS frame por frame | Parseval, 1799 |
| **BRT** | `C=\frac{\sum f\cdot\|X(f)\|}{\sum\|X(f)\|}` | Centro de masa espectral | Grey & Gordon, 1978, Stanford CCRMA |
| **MOT** | `F=\sum(\|X_t\|-\|X_{t-1}\|)^2` | Cambio de energía espectral entre frames | Scheirer & Slaney, 1997, MIT Media Lab |
| **GRV** | centroide ponderado por energía acumulada | "peso" armónico en el registro | Lerch, 2012, TU Berlin |
| **TEN** | `T=\frac{(\prod\|X(f)\|)^{1/N}}{\frac{1}{N}\sum\|X(f)\|}` | Flatness: 0=tonal, 1=ruido blanco | Johnston, 1988, AT&T Bell Labs |
| **SEG** | boundary detection por cambios de timbre | Segmentación automática de secciones | Foote, 1999, FX Palo Alto Lab |

### 4.4 Contenido — SA descriptores (4 capas completas)

**Pitch (YIN)**
① `f_0` estimado via `d'(\tau)=1-\frac{2}{W\cdot d(\tau)}\sum_{j=1}^{W}[x_j - x_{j+\tau}]^2`  
② El algoritmo YIN calcula la diferencia cuadrática entre la señal y su versión retrasada `τ`. Normaliza la función de diferencia acumulada para evitar falsos mínimos en armónicos. El pitch es el `τ` donde la función cruza un umbral (~0.1) por primera vez.  
③ *Una nota La4 (440 Hz) produce un mínimo en τ ≈ 2.27ms. Si hay ruido de fondo, YIN puede reportar el doble de la frecuencia real (octave error).*  
④ Desarrollado por Alain de Cheveigné & Hideki Kawahara, 2002, IRCAM / ATR Japan.

**RMS / dB**
① `L = 20\log_{10}\sqrt{\frac{1}{N}\sum_{n=0}^{N-1}x[n]^2}`  
② La potencia media de una ventana de `N` muestras se calcula como la raíz del promedio de cuadrados (RMS). Convertir a dB con `20·log₁₀` da una escala perceptualmente uniforme: cada 6 dB equivale a duplicar la amplitud, cada 20 dB a multiplicar por 10.  
③ *Una señal de -6 dBFS tiene la mitad de amplitud que una de 0 dBFS. El umbral de audición humana está ~0 dB SPL; la conversación normal ~60 dB SPL.*  
④ Escala dB: Alexander Graham Bell, 1920s. RMS en audio digital: formalizado en AES17, 1998.

**LUFS M/S/I (BS.1770)**
① `L_K = -0.691 + 10\log_{10}\sum_i G_i \cdot \overline{z_i^2}`  
② El estándar ITU-R BS.1770 define loudness integrado aplicando un filtro K-weighting (preénfasis en altas frecuencias + ponderación RLB) y promediando sobre ventanas de 400ms (M=momentáneo), 3s (S=short-term) e integrado (I). Los pesos `Gᵢ` compensan la diferente percepción de canales surround.  
③ *El streaming (Spotify, YouTube) normaliza a -14 LUFS I. Una pista mastered "loudness war" puede llegar a -6 LUFS I con mucha compresión.*  
④ Desarrollado por Thomas Lund & Florian Camerer, 2006, ITU-R / EBU R128.

**ZCR (Zero-Crossing Rate)**
① `ZCR = \frac{1}{N}\sum_{n=1}^{N}|\text{sgn}(x[n]) - \text{sgn}(x[n-1])|`  
② Cuenta cuántas veces la señal cruza el eje cero por unidad de tiempo. Señales tonales (sinusoides puras) tienen ZCR proporcional a su frecuencia. Señales ruidosas o percusivas tienen ZCR alto e irregular. Es un descriptor simple pero efectivo para distinguir voiced/unvoiced en voz.  
③ *Una sinusoide de 440 Hz en 44100 Hz tiene ZCR ≈ 880/44100 ≈ 0.02. Ruido blanco tiene ZCR ≈ 0.5. Las consonantes fricativas (/s/, /f/) tienen ZCR alto; las vocales, bajo.*  
④ Formalizado por Rabiner & Schafer, 1978, Bell Labs. "Digital Processing of Speech Signals."

**Centroide Espectral**
① `C = \frac{\sum_{k=0}^{N/2} f_k \cdot |X[k]|}{\sum_{k=0}^{N/2} |X[k]|}`  
② El centroide es el promedio ponderado de las frecuencias del espectro, donde cada frecuencia contribuye proporcionalmente a su magnitud. Cuando la energía migra hacia frecuencias altas (ataque de un piano, cuerda pizzicato), el centroide sube; al decaer los armónicos agudos, baja. Correlaciona fuertemente con la percepción de "brillo" tímbrico.  
③ *Un violín en fortissimo agudo tiene centroide ~4-6 kHz; un contrabajo en arco tiene centroide ~300-800 Hz. El centroide de una voz cantando "ahhh" cae cuando pasa de forte a piano.*  
④ Grey & Gordon, 1978, Stanford CCRMA. "Perceptual effects of spectral modifications on musical timbres."

**Spread Espectral**
① `S = \sqrt{\frac{\sum_k (f_k - C)^2 \cdot |X[k]|}{\sum_k |X[k]|}}`  
② El spread es la desviación estándar del espectro respecto al centroide. Un valor alto indica que la energía está distribuida en un rango amplio de frecuencias (sonido complejo, ruidoso); un valor bajo indica concentración en frecuencias cercanas (sonido tonal, puro). Complementa al centroide: mismo centroide puede tener spread muy distinto.  
③ *Un acorde de piano con muchos armónicos tiene spread alto; una flauta en registro medio tiene spread bajo. El noise burst de una caja de batería tiene spread mayor que el tono de un bombo.*  
④ Peeters et al., 2004, IRCAM. "A large set of audio features for sound description."

**Skewness Espectral**
① `Sk = \frac{\sum_k (f_k - C)^3 \cdot |X[k]|}{S^3 \cdot \sum_k |X[k]|}`  
② El tercer momento estadístico del espectro. Skewness positiva indica que la cola del espectro se extiende más hacia las frecuencias altas (energía concentrada en graves, cola hacia agudos). Negativa: el peso espectral está hacia los agudos. Cero: distribución simétrica alrededor del centroide.  
③ *Un bajo eléctrico con distorsión tiene skewness positiva (graves dominan, armónicos agudos forman la cola). Un platillo de hi-hat tiene skewness negativa (energía concentrada en frecuencias medias-altas).*  
④ Peeters et al., 2004, IRCAM.

**Kurtosis Espectral**
① `K = \frac{\sum_k (f_k - C)^4 \cdot |X[k]|}{S^4 \cdot \sum_k |X[k]|}`  
② El cuarto momento estadístico. Kurtosis alta ("leptocúrtica") indica un espectro con picos muy pronunciados y colas delgadas — sonido con armónicos bien definidos. Kurtosis baja ("platicúrtica") indica un espectro plano y distribuido. Relacionada con la "claridad" o "impureza" del timbre.  
③ *Una flauta con vibrato tiene kurtosis alta (parciales nítidos). Un chelo con mucho arco y col legno tiene kurtosis baja. Ruido blanco tiene kurtosis = 3 (distribución normal).*  
④ Peeters et al., 2004, IRCAM.

**Spectral Slope**
① `Sl = \frac{\sum_k (f_k - \bar{f})(|X[k]| - \overline{|X|})}{\sum_k (f_k - \bar{f})^2}`  
② Pendiente de la regresión lineal del espectro en magnitud vs frecuencia. Slope negativo (la mayoría de los sonidos): la energía decae con la frecuencia, conforme a la ley de potencia de Fourier. Slope más negativo = decaimiento más rápido = sonido más "oscuro" o "suave". Menos negativo = mayor riqueza armónica en agudos.  
③ *Una voz operática en registro grave tiene slope muy negativo. Un violín en sul ponticello (arco cerca del puente) tiene slope menos negativo — más energía en armónicos altos.*  
④ Dubnov, 1996, Ben-Gurion University. Popularizado en MIR por Peeters, 2004, IRCAM.

**Spectral Flux**
① `F_t = \sum_k \left(\max(|X_t[k]| - |X_{t-1}[k]|, 0)\right)^2`  
② Mide cuánto cambia el espectro entre frames consecutivos. La versión half-wave rectificada (solo cambios positivos) detecta ataques: cuando un instrumento empieza a sonar, el espectro aumenta bruscamente y el flux pica. Es la base de los algoritmos de onset detection (detección de notas).  
③ *El flux tiene picos muy altos en el ataque de cada nota de piano y en cada golpe de percusión. En una nota de flauta sostenida, el flux es casi cero. Comparar el flux de un arpeggio vs un acorde: el arpeggio tiene picos separados, el acorde un solo pico.*  
④ Scheirer & Slaney, 1997, MIT Media Lab. "Construction and evaluation of a robust multifeature speech/music discriminator."

**Tristimulus**
① `T_1=\frac{A_1}{\sum A_h};\; T_2=\frac{A_2+A_3+A_4}{\sum A_h};\; T_3=\frac{\sum_{h=5}^{\infty}A_h}{\sum A_h}`  
② Analogía tímbrica al modelo de color RGB: descompone la energía armónica en tres grupos — fundamental (T1), segundos-terceros-cuartos armónicos (T2), y el resto (T3). Si T1 es alto, el sonido es "hueco" o "flautístico"; T2 alto indica "quintal" o "clarinete"; T3 alto indica riqueza armónica "brillante".  
③ *Una flauta tiene T1 alto, T2 y T3 bajos. Un oboe tiene T2 alto. Un violín con arco fuerte tiene T3 alto. Un triángulo resonando tiene T1 ≈ 0, T3 ≈ 1.*  
④ Pollard & Jansson, 1982, KTH Royal Institute of Technology. "A tristimulus method for the specification of musical timbre."

**HNR (Harmonic-to-Noise Ratio)**
① `HNR = 10\log_{10}\frac{E_{\text{arm}}}{E_{\text{total}} - E_{\text{arm}}}`  
② Relación entre la energía de los componentes armónicos (periódicos) y el ruido residual (aperiódico). Se calcula estimando el pitch, sumando la energía en los múltiplos del fundamental (armónicos), y dividiendo por la energía no armónica. HNR alto = sonido muy periódico, voceado, "limpio". HNR bajo = voz ronca, fricativas, ruido.  
③ *Una voz cantando "ahhh" tiene HNR ~20-30 dB. Una voz susurrada tiene HNR ~0-5 dB. Un violín bien afinado en arco tiene HNR ~25 dB; col legno ~8 dB. Cuerdas rozadas irregularmente tienen HNR negativo.*  
④ Yumoto, Gould & Baer, 1982, University of Wisconsin. "Harmonics-to-noise ratio as an index of the degree of hoarseness."

**MFCC (13 coeficientes)**
① `c_n = \sum_{m=1}^{M} \log S_m \cdot \cos\left[n\left(m-\frac{1}{2}\right)\frac{\pi}{M}\right]`  
② Los MFCC se calculan en 3 pasos: (1) aplicar banco de filtros triangulares en escala Mel (que imita la resolución frecuencial del oído), (2) tomar el logaritmo de las energías de cada filtro, (3) aplicar la DCT para decorrelacionar los coeficientes. Los primeros coeficientes capturan la "forma" del espectro (timbre global); los coeficientes altos capturan detalles finos. Son el descriptor tímbrico más usado en reconocimiento de habla y música.  
③ *Los MFCC de un violín y un oboe tocando la misma nota difieren claramente en c2-c5 (envolvente espectral). Los MFCCs son tan discriminativos que permiten identificar hablantes, instrumentos, y géneros musicales. c0 (a veces incluido) es proporcional al nivel de energía total.*  
④ Davis & Mermelstein, 1980, Bell Labs. "Comparison of parametric representations for monosyllabic word recognition in continuously spoken sentences."

---

## 5. Archivos a modificar

| Archivo | Cambios |
|---------|---------|
| `src/scripts/room/sonic-visualizer/controller.ts` | Fix play/stop (AbortController), loop drag feedback, loop restart debounce, nueva lógica click/drag/SEG, tooltips SV, `canControl()`, `setAllowStudents()`, publish SV state al join |
| `src/scripts/room/sonic-analyzer/controller.ts` | `applyRemoteState` activa SA real, `sa:file-decoded` event, progress events en `computeVizFeatures`, `canControl()`, `setAllowStudents()` |
| `src/components/room/panels/sonic-visualizer/SonicVisualizerPanel.astro` | `data-tip` attributes en layer buttons, CSS tooltip component |
| `src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro` | `data-tip` attributes en descriptores SA |
| `src/scripts/livekit-room.ts` | `publishSVState()` al join, wiring `allowStudents` → SA/SV controllers, rx `sa:analysis-progress` (optional status) |

## 6. Fuera de scope (próxima iteración)

- Mover `computeVizFeatures` a Web Worker (Approach C)
- Broadcast de `sa:analysis-progress` a otros participantes
- Tooltip para `data-sa-bpm`, `data-sa-key` (SA header)
