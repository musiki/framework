# sA — Sonic Analyzer Pod

## Overview

Pod de análisis de audio en tiempo real para el room de Musiki. Corre solo cuando el usuario lo activa (switch LED verde). Utiliza Essentia.js (WASM) cargado de forma lazy al encenderse, para no penalizar la carga del room.

---

## Pod Registration

Agregar a `POD_TYPES` en `src/scripts/room/workspace/RoomWorkspaceManager.ts`:

```ts
{ id: 'sonic-analyzer', title: 'SA', icon: 'Sa', atomic: 19, color: '#45D384', cat: 'tools' }
```

---

## Archivos

```
src/components/room/panels/sonic-analyzer/
  SonicAnalyzerPanel.astro      — HTML del pod (switch, source selector, fps slider, view tabs)
  sonic-analyzer.css            — estilos wireframe monospace

src/scripts/room/sonic-analyzer/
  controller.ts                 — lógica principal: on/off, lazy-load, audio tap, dispatch a views
  essentia-worklet.ts           — AudioWorkletProcessor con Essentia.js
  views/
    text-view.ts                — vista TEXT: tabla ASCII coloreada
    spectrum-view.ts            — vista SPECTRUM: barras ASCII (▁▂▃▄▅▆▇█)
    timbre-view.ts              — vista TIMBRE: descriptores + MFCC inline
    lufs-view.ts                — vista LUFS: medidores M/S/I + historia ASCII
  index.ts
```

---

## Switch LED

Usa el patrón existente `.conference-mixer-led` con `data-active='true'/'false'` en un button wrapper. En estado `false` el pod está en el workspace pero no corre nada — cero CPU, cero WASM cargado.

Al pasar a `true`:
1. Mostrar estado `loading…` en el pod
2. Lazy-load Essentia.js WASM (`import('essentiajs')`)
3. Registrar y conectar el AudioWorklet
4. Tapear la fuente seleccionada
5. Arrancar el loop de render a la FPS configurada

---

## Fuentes de Audio (selector)

| Valor | Descripción |
|---|---|
| `master` (default) | Nuevo `AnalyserNode` en paralelo al `masterMeterAnalyser` existente, tapeado después de `masterPanNode` en `livekit-room.ts` |
| `mic:local` | `getUserMedia` → `createMediaStreamSource` → analyser sA |
| `participant:<id>` | MediaStreamTrack del participante via callback `onAudioMount` → analyser sA |

El selector se puebla dinámicamente: `master` siempre presente, los participantes se agregan/quitan cuando entran/salen del room.

---

## AudioWorklet — `essentia-worklet.ts`

Corre en hilo separado. Recibe frames de audio de 1024 samples (a 48kHz = ~21ms). Calcula:

### Tier básico (MIR simple)
- `pitch` — YIN o PitchYIN de Essentia
- `rms` → `dB` — 20·log10(rms)
- `lufs_m` — Momentary LUFS (BS.1770, ventana 400ms)
- `lufs_s` — Short-term LUFS (ventana 3s)
- `lufs_i` — Integrated LUFS (acumulado desde que se encendió)
- `zcr` — Zero Crossing Rate

### Tier tímbrico
- `spectral_centroid`
- `spectral_spread`
- `spectral_skewness`
- `spectral_kurtosis`
- `spectral_slope`
- `spectral_flux`
- `tristimulus` — [T1, T2, T3]
- `harmonicity` — HNR (Harmonic to Noise Ratio)
- `mfcc` — 13 coeficientes

### Tier espectral
- `fft_magnitude` — Float32Array de 512 bins para la vista SPECTRUM

Postea resultados al main thread vía `port.postMessage` cada N frames según FPS configurado.

---

## Update Rate

Slider `1–30 fps`, default `10 fps`. El worklet siempre procesa a frame-rate de audio; el throttle de UI se hace en el controller del main thread — acumula resultados y renderiza al intervalo configurado.

---

## Vistas (4 subtabs)

### TEXT
Tabla monospace, fuente fija, valores en columnas alineadas. Color por rango:
- Verde `#45D384` — nominal
- Amarillo `#FFD966` — atención (ej. dB > -6)
- Rojo `#E06666` — clip/distorsión (ej. dB > -1)

Ejemplo visual (inspiración strudel.cc / gibber):
```
pitch      ·  261.6 Hz   C4
dB         · -18.3 dBFS
lufs_m     · -16.1 LUFS
lufs_s     · -17.4 LUFS
lufs_i     · -19.0 LUFS
centroid   ·   1842 Hz
spread     ·    934 Hz
hnr        ·   8.4 dB
zcr        ·   0.12
```

### SPECTRUM
FFT como barras ASCII de 64 bins usando caracteres de bloque `▁▂▃▄▅▆▇█`. Cabe en el ancho del pod sin scroll. Opcionalmente una segunda línea con escala de frecuencias.

```
▁▁▂▃▄▆█▇▅▄▃▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
20Hz                              1kHz                          20kHz
```

### TIMBRE
Grid de descriptores con valor numérico + mini-barra inline ASCII. MFCC como 13 valores en fila o como mini-barras.

```
centroid  ████░░░░  1842 Hz
spread    ██░░░░░░   934 Hz
skewness  ███░░░░░    1.2
kurtosis  █░░░░░░░    3.4
slope     ██████░░  -0.04
flux      ███░░░░░    0.3
T1/T2/T3  0.6 / 0.3 / 0.1
HNR       ████░░░░   8.4 dB

MFCC  -8·12·-3·6·-1·2·0·1·-2·3·-1·0·1
```

### LUFS
Medidores M/S/I en grande + historia temporal como envelope ASCII (ventana de ~10s):

```
M  -16.1  S  -17.4  I  -19.0  LUFS
─────────────────────────────────────
  ._.-‾‾‾-._..-‾‾-._.-‾-._.._.-‾‾‾_.
```

---

## Integración con el Room

- El controller `sA` se instancia en `RoomWorkspaceManager` igual que el de ORF/Hyperpiano, al spawnear el pod.
- Para el tap en `master`: `RoomWorkspaceManager` o el `LivekitRoom` expone un método `getAnalyserTap(): AnalyserNode` que crea un nodo en paralelo sobre `masterPanNode`.
- Para `mic:local` y `participant:X`: el controller de sA se suscribe al bus de eventos del room (`room:audio-mount`).

---

## Decisiones de diseño

| Decisión | Razón |
|---|---|
| Essentia.js WASM (no Meyda) | Cobertura completa: LUFS, HNR, TTB. Lazy-load justifica el peso. |
| AudioWorklet (no ScriptProcessor) | No bloquea main thread. Estándar moderno. |
| Throttle en main thread (no en worklet) | El worklet procesa siempre a audio-rate; la UI dibuja solo cuando el slider lo permite. |
| ASCII/monospace para todas las vistas | Coherencia con estética glicol/strudel/gibber. Sin librerías de gráficos. |
| 4 vistas fijas en v1 (no detachables aún) | Detachable es infraestructura de dockview; se agrega en v2 sin cambiar el core. |
