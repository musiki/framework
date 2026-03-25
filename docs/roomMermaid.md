# Room LiveKit — Architecture Map

> Wireframe diagram of all connections, technologies and data flows in the Musiki live room system.

```mermaid
%%{init: {
  "theme": "dark",
  "themeVariables": {
    "background":        "#08080f",
    "primaryColor":      "#0d1117",
    "primaryTextColor":  "#c9d1d9",
    "primaryBorderColor":"#00ffc8",
    "lineColor":         "#00ffc8",
    "secondaryColor":    "#0d1117",
    "tertiaryColor":     "#0d1117",
    "edgeLabelBackground":"#0d1117",
    "clusterBkg":        "#0d1117",
    "clusterBorder":     "#1a2a3a",
    "titleColor":        "#00ffc8",
    "nodeTextColor":     "#e0e0ff"
  },
  "flowchart": { "curve": "basis", "padding": 20 }
}}%%

flowchart TD

  %% ─────────────────────────────────────────────────────────
  %% BROWSER
  %% ─────────────────────────────────────────────────────────
  subgraph BROWSER["  🌐  Browser — Client"]
    direction TB

    subgraph UI["  ConferenceLayout.astro — UI Shell"]
      direction LR

      STAGE["**Stage**\n╔═══════════╗\n║ presentation║\n║ teacher cam ║\n║ screenshare ║\n║ grid        ║\n╚═══════════╝\ndata-panel=*"]

      SBL["**Left Sidebar**\nFM Synth controls\nGravity Ball\nMixer 5ch\nFX: Reverb / Comp\nHand Tracking UI"]

      SBR["**Right Sidebar**\nRoom + Identity setup\nDevice selectors\nSession Control ①\nINVITAR ①\nChat 💬\nParticipant list"]

      BAR["**Bottom Bar**\nConnect / Disconnect\nParticipant count\nReactions 🎉\nHand raise ✋\nRecord ⏺"]
    end

    subgraph ENGINE["  livekit-room.ts — Room Engine  (10 000+ lines)"]
      direction TB

      subgraph AUDIO_E["Audio Engine"]
        SYNTH["FMSynthVoice\ncarrier · mod · distortion\nreverb · compressor"]
        GBALL["GravityBallFoley\nphysics + WebGL\nGravityBallRenderer"]
      end

      subgraph VIDEO_E["Video Engine"]
        BLUR["BackgroundBlur\nVideoProcessor\nCanvas API"]
        HAND["Hand Tracking\nMediaPipe\nHandLandmarker"]
        REC["Recording\nMediaRecorder\nPresets: 1080 / Story / TikTok"]
      end

      subgraph RT["Real-time Core"]
        LKROOM["LiveKit Room SDK\nTrack pub / sub\nParticipant events"]
        DC["Data Channel\nConferenceMessage\nRELIABLE · binary"]
        PERF["Presentation\niframe controller\npostMessage ↔ Reveal"]
        DRAG["setupDraggable\ncircle-move broadcast\ncoord normalisation"]
        VPS_TICK["handleVpsStatsTick\n↻ 5 s"]
      end

      subgraph MSG_TYPES["ConferenceMessage types"]
        direction LR
        M1["layout\ngraph\npresentation"]
        M2["session-control\nsession-leader\nsession-setup"]
        M3["chat\nreaction\nmute-all"]
        M4["slide-state\npresentation-zoom\ncircle-move"]
      end
    end

    subgraph INLINE_JS["  ConferenceLayout inline scripts"]
      DRAG_LOCAL["initDraggableCircle\n(local-only fallback)"]
      STATS_LOCAL["initStats\nRAF CPU · WebRTC bw\n↻ 2 s"]
      INVITE_SW["initInviteSwitch\nexternal ↔ student"]
      TRACKED_PC["TrackedRTCPeerConnection\npatches window.RTCPeerConnection"]
    end

    REVEAL_IF["**Reveal.js iframe**\n/cursos/slides/{courseId}/{lessonId}\ntheme: zztt.css / custom\nindex h · v · f · zoom"]
  end

  %% ─────────────────────────────────────────────────────────
  %% SERVER
  %% ─────────────────────────────────────────────────────────
  subgraph SERVER["  ⚡  Astro SSR Server — Hostinger VPS"]
    direction TB

    PAGE["**room.astro**\nSSR · prerender=false\nresolves role · invite · courseId\ninjects props → ConferenceLayout"]

    subgraph TOKEN_LAYER["Token & Auth"]
      TOKEN_API["/api/token\n/api/create-live-kit-token\nlivekit-token.ts"]
      ACCESS_LIB["access.ts\nresolveLiveParticipantRole\nresolveLiveManageAccess"]
      INVITE_API["/api/live/invite\nGET · POST\nscrypt password hash"]
      INVITE_LIB["invite.ts\nupsert · verify · revoke\nstudent | external"]
    end

    subgraph LIVE_APIS["Live Interaction APIs"]
      LIVE_START["/api/live/start\nstartLiveInteraction"]
      LIVE_END["/api/live/end\nendLiveInteraction"]
      LIVE_UPD["/api/live/update\nprompt · timer · results"]
      LIVE_RESP["/api/live/respond\nsubmitLiveResponse"]
      LIVE_ACTIVE["/api/live/active\ngetLiveSnapshot"]
      SSE_ROUTE["/sse/live\nServer-Sent Events\nheartbeat ↻ 25 s"]
    end

    subgraph WEBHOOK_LAYER["Webhooks & VPS"]
      WEBHOOK["/api/livekit/webhook\nwebhook signature verify\nparticipant_joined\ntrack_published …"]
      VPS_API["/api/internal/vps-stats\nos.loadavg · /proc/net/dev\nCPU % · TX Mbps"]
    end

    subgraph STORE["server-store.mjs\n(in-memory)"]
      STORE_N["interactions Map\nresponses Map\nroom presences Map\nSSE listeners Set"]
    end
  end

  %% ─────────────────────────────────────────────────────────
  %% EXTERNAL
  %% ─────────────────────────────────────────────────────────
  subgraph EXT["  ☁️  External Services"]
    direction LR

    LK_SRV["**LiveKit Server**\nwss://live.musiki.org.ar\nSFU · WebRTC\nRooms API"]

    SUPA["**Supabase**\nPostgres\nUser · Enrollment\nLiveKitWebhookEvent\nInvite records"]

    R2["**Cloudflare R2**\nMedia / chat assets\nR2_PUBLIC_URL"]
  end

  %% ─────────────────────────────────────────────────────────
  %% EDGES — Server flow
  %% ─────────────────────────────────────────────────────────
  PAGE -->|"session + invite\nresolve role"| ACCESS_LIB
  PAGE -->|"props: livekitUrl\ndefaultRole · room"| UI

  ACCESS_LIB -->|"User · Enrollment\nquery"| SUPA

  TOKEN_API -->|"AccessToken()\nmetadata: role · courseId"| LK_SRV
  TOKEN_API --> ACCESS_LIB
  TOKEN_API -->|"ensureDbUser"| SUPA

  INVITE_API --> INVITE_LIB
  INVITE_LIB -->|"invite rows"| SUPA

  WEBHOOK -->|"LIVEKIT_API_SECRET\nverifyWebhookSignature"| LK_SRV
  WEBHOOK -->|"persist event"| SUPA

  LIVE_START & LIVE_END & LIVE_UPD & LIVE_RESP --> STORE_N
  LIVE_ACTIVE --> STORE_N
  SSE_ROUTE -->|"subscribe / push"| STORE_N

  VPS_API -->|"os · fs\n/proc/net/dev"| SERVER

  %% ─────────────────────────────────────────────────────────
  %% EDGES — Client ↔ Server
  %% ─────────────────────────────────────────────────────────
  LKROOM -->|"GET /api/token\nroom · identity · invite"| TOKEN_API
  LKROOM -->|"WebRTC / WSS\nconnect(url, token)"| LK_SRV
  LK_SRV -->|"POST webhook\nevents"| WEBHOOK

  ENGINE -->|"GET /api/live/invite\nload · generate · revoke"| INVITE_API
  ENGINE -->|"GET /sse/live\nSSE stream"| SSE_ROUTE
  VPS_TICK -->|"GET /api/internal/vps-stats\n↻ 5 s"| VPS_API

  %% ─────────────────────────────────────────────────────────
  %% EDGES — Intra-client
  %% ─────────────────────────────────────────────────────────
  UI --> ENGINE
  LKROOM --> DC
  DC --> MSG_TYPES
  DC -->|"broadcast to\nall participants"| LK_SRV

  PERF -->|"postMessage\nslide-state sync"| REVEAL_IF
  REVEAL_IF -->|"postMessage\nindexH · indexV · zoom"| PERF

  HAND -->|"landmark coords\n→ FM params"| SYNTH
  GBALL -->|"audio trigger"| SYNTH
  BLUR -->|"processed\nvideo track"| LKROOM

  DRAG -->|"circle-move msg"| DC
  TRACKED_PC -->|"track instances"| STATS_LOCAL

  SBL -->|"synth controls\nmixer levels"| SYNTH
  SBL -->|"gravity toggle"| GBALL
  BAR -->|"connect / record / react"| ENGINE
  SBR -->|"session setup\ndevice selection"| ENGINE

  %% ─────────────────────────────────────────────────────────
  %% STYLES
  %% ─────────────────────────────────────────────────────────
  classDef neonCyan    fill:#020f0f,stroke:#00ffc8,stroke-width:2px,color:#00ffc8,rx:6
  classDef neonMagenta fill:#0f020f,stroke:#ff00cc,stroke-width:2px,color:#ff88ee,rx:6
  classDef neonLime    fill:#020f04,stroke:#00ff66,stroke-width:2px,color:#88ffaa,rx:6
  classDef neonOrange  fill:#0f0800,stroke:#ff8800,stroke-width:2px,color:#ffbb44,rx:6
  classDef neonBlue    fill:#02020f,stroke:#4488ff,stroke-width:2px,color:#88aaff,rx:6
  classDef neonYellow  fill:#0f0f02,stroke:#ffe000,stroke-width:2px,color:#ffee66,rx:6
  classDef neonRed     fill:#0f0202,stroke:#ff4466,stroke-width:2px,color:#ff8899,rx:6
  classDef ghost       fill:#0d1117,stroke:#2a3a4a,stroke-width:1px,color:#667788,rx:4

  class STAGE,BAR          neonCyan
  class SBL                neonLime
  class SBR                neonMagenta
  class SYNTH,GBALL        neonLime
  class BLUR,HAND,REC      neonOrange
  class LKROOM,DC,DRAG     neonCyan
  class PERF,REVEAL_IF     neonBlue
  class MSG_TYPES,M1,M2,M3,M4 ghost
  class VPS_TICK,STATS_LOCAL,DRAG_LOCAL,INVITE_SW,TRACKED_PC ghost
  class PAGE,ACCESS_LIB    neonCyan
  class TOKEN_API          neonYellow
  class INVITE_API,INVITE_LIB neonMagenta
  class LIVE_START,LIVE_END,LIVE_UPD,LIVE_RESP,LIVE_ACTIVE,SSE_ROUTE neonBlue
  class WEBHOOK            neonRed
  class VPS_API            neonOrange
  class STORE_N            ghost
  class LK_SRV             neonCyan
  class SUPA               neonBlue
  class R2                 neonOrange
```

---

## Legend

| Color                    | Layer                                         |
| ------------------------ | --------------------------------------------- |
| 🟢 **Cyan** `#00ffc8`    | Core LiveKit path — room, tokens, WebRTC      |
| 🟢 **Lime** `#00ff66`    | Audio engine — FM Synth, Gravity Ball         |
| 🟣 **Magenta** `#ff00cc` | UI / Right sidebar — session, chat, invites   |
| 🟠 **Orange** `#ff8800`  | Video engine — blur, hand tracking, recording |
| 🔵 **Blue** `#4488ff`    | Presentation, SSE, Supabase queries           |
| 🟡 **Yellow** `#ffe000`  | Token generation API                          |
| 🔴 **Red** `#ff4466`     | Webhooks — incoming events from LiveKit       |
| ⬛ **Ghost** `#2a3a4a`    | Internal state, helpers, minor nodes          |

---

## Key data flows

```
Teacher joins
  → room.astro resolves role (Supabase)
  → ConferenceLayout renders with defaultRole="teacher"
  → livekit-room.ts fetches /api/token → LiveKit JWT
  → room.connect(wss://live.musiki.org.ar, jwt)
  → teacher publishes camera + audio tracks

Student joins (invite link)
  → /api/live/invite verifies code + scrypt password
  → room.astro hydrates with role="student"
  → JWT has canPublish=true, canSubscribe=true
  → session-control hidden (display:none for students)

Teacher drags circle
  → setupDraggable pointerMove
  → publishMessage({ type:"circle-move", x:0.4, y:0.3, identity:"focus-slot" })
  → LiveKit Data Channel RELIABLE broadcast
  → all participants receive → target.style.transform = translate(...)

Presentation sync
  → teacher selects slide → schedulePresentationLoad()
  → publishMessage({ type:"presentation", href:"/cursos/slides/..." })
  → all: iframe.src = href
  → Reveal postMessage → slide-state events back
  → publishMessage({ type:"slide-state", indexH, indexV, zoom })
  → all participants scroll to same slide

VPS stats
  → handleVpsStatsTick every 5 s
  → GET /api/internal/vps-stats
  → reads os.loadavg() + /proc/net/dev
  → [data-stat-cpu] and [data-stat-bw] updated with data-risk level
```



> ① SESSION CONTROL and INVITAR only visible to `role="teacher"` — `sessionControlsField.hidden = localRole !== 'teacher'`
