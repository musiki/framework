# Room LiveKit — Architecture Map

> Wireframe diagram of all connections, technologies and data flows in the Musiki live room system.

```mermaid
flowchart LR

  subgraph BROWSER["Browser — Client"]
    direction TB

    subgraph UI["ConferenceLayout.astro — UI Shell"]
      direction LR
      STAGE["Stage\nPresentation · Teacher cam\nScreenshare · Grid"]
      SBL["Left Sidebar\nFM Synth · Gravity Ball\nMixer 5ch · FX · Hand Tracking"]
      SBR["Right Sidebar\nRoom · Identity · Devices\nSession Control · Chat · Participants"]
      BAR["Bottom Bar\nConnect · Disconnect\nReactions · Hand raise · Record"]
    end

    subgraph ENGINE["livekit-room.ts — Room Engine"]
      direction TB

      subgraph AUDIO_E["Audio Engine"]
        SYNTH["FMSynthVoice\ncarrier · mod · distortion\nreverb · compressor"]
        GBALL["GravityBallFoley\nphysics · WebGL · Renderer"]
      end

      subgraph VIDEO_E["Video Engine"]
        BLUR["BackgroundBlur\nVideoProcessor · Canvas API"]
        HAND["Hand Tracking\nMediaPipe · HandLandmarker"]
        REC["Recording\nMediaRecorder\n1080 · Story · TikTok"]
      end

      subgraph RT["Real-time Core"]
        LKROOM["LiveKit Room SDK\nTrack pub/sub · Participant events"]
        DC["Data Channel\nConferenceMessage · RELIABLE · binary"]
        PERF["Presentation\niframe controller · postMessage Reveal"]
        DRAG["setupDraggable\ncircle-move broadcast · coord normalisation"]
        VPS_TICK["handleVpsStatsTick\n5 s interval"]
      end

      subgraph MSG_TYPES["ConferenceMessage types"]
        direction LR
        M1["layout · graph · presentation"]
        M2["session-control · session-leader · session-setup"]
        M3["chat · reaction · mute-all"]
        M4["slide-state · presentation-zoom · circle-move"]
      end
    end

    subgraph INLINE_JS["ConferenceLayout inline scripts"]
      DRAG_LOCAL["initDraggableCircle\nlocal-only fallback"]
      STATS_LOCAL["initStats\nRAF CPU · WebRTC bw · 2 s"]
      INVITE_SW["initInviteSwitch\nexternal vs student"]
      TRACKED_PC["TrackedRTCPeerConnection\npatches window.RTCPeerConnection"]
    end

    REVEAL_IF["Reveal.js iframe\n/cursos/slides/courseId/lessonId\ntheme: zztt.css · index h·v·f·zoom"]
  end

  subgraph SERVER["Astro SSR Server — Hostinger VPS"]
    direction TB

    PAGE["room.astro\nSSR · prerender=false\nresolves role · invite · courseId"]

    subgraph TOKEN_LAYER["Token & Auth"]
      TOKEN_API["/api/token\n/api/create-live-kit-token\nlivekit-token.ts"]
      ACCESS_LIB["access.ts\nresolveLiveParticipantRole\nresolveLiveManageAccess"]
      INVITE_API["/api/live/invite\nGET · POST · scrypt hash"]
      INVITE_LIB["invite.ts\nupsert · verify · revoke\nstudent · external"]
    end

    subgraph LIVE_APIS["Live Interaction APIs"]
      LIVE_START["/api/live/start"]
      LIVE_END["/api/live/end"]
      LIVE_UPD["/api/live/update\nprompt · timer · results"]
      LIVE_RESP["/api/live/respond\nsubmitLiveResponse"]
      LIVE_ACTIVE["/api/live/active\ngetLiveSnapshot"]
      SSE_ROUTE["/sse/live\nServer-Sent Events · heartbeat 25 s"]
    end

    subgraph WEBHOOK_LAYER["Webhooks & VPS"]
      WEBHOOK["/api/livekit/webhook\nsignature verify\nparticipant_joined · track_published"]
      VPS_API["/api/internal/vps-stats\nos.loadavg · /proc/net/dev\nCPU % · TX Mbps"]
    end

    subgraph STORE["server-store.mjs — in-memory"]
      STORE_N["interactions Map · responses Map\nroom presences Map · SSE listeners Set"]
    end
  end

  subgraph EXT["External Services"]
    direction LR
    LK_SRV["LiveKit Server\nwss://live.musiki.org.ar\nSFU · WebRTC · Rooms API"]
    SUPA["Supabase\nPostgres · User · Enrollment\nLiveKitWebhookEvent · Invite"]
    R2["Cloudflare R2\nMedia · chat assets\nR2_PUBLIC_URL"]
  end

  PAGE -->|"resolve role"| ACCESS_LIB
  PAGE -->|"props: livekitUrl · role · room"| UI
  ACCESS_LIB -->|"User · Enrollment query"| SUPA
  TOKEN_API -->|"AccessToken · role · courseId"| LK_SRV
  TOKEN_API --> ACCESS_LIB
  TOKEN_API -->|"ensureDbUser"| SUPA
  INVITE_API --> INVITE_LIB
  INVITE_LIB -->|"invite rows"| SUPA
  WEBHOOK -->|"verifyWebhookSignature"| LK_SRV
  WEBHOOK -->|"persist event"| SUPA
  LIVE_START & LIVE_END & LIVE_UPD & LIVE_RESP --> STORE_N
  LIVE_ACTIVE --> STORE_N
  SSE_ROUTE -->|"subscribe · push"| STORE_N
  LKROOM -->|"GET /api/token"| TOKEN_API
  LKROOM -->|"WebRTC · WSS connect"| LK_SRV
  LK_SRV -->|"POST webhook events"| WEBHOOK
  ENGINE -->|"GET /api/live/invite"| INVITE_API
  ENGINE -->|"GET /sse/live"| SSE_ROUTE
  VPS_TICK -->|"GET /api/internal/vps-stats"| VPS_API
  UI --> ENGINE
  LKROOM --> DC
  DC --> MSG_TYPES
  DC -->|"broadcast to all participants"| LK_SRV
  PERF -->|"postMessage slide-state sync"| REVEAL_IF
  REVEAL_IF -->|"postMessage indexH · indexV · zoom"| PERF
  HAND -->|"landmark coords to FM params"| SYNTH
  GBALL -->|"audio trigger"| SYNTH
  BLUR -->|"processed video track"| LKROOM
  DRAG -->|"circle-move msg"| DC
  TRACKED_PC -->|"track instances"| STATS_LOCAL
  SBL -->|"synth controls · mixer levels"| SYNTH
  SBL -->|"gravity toggle"| GBALL
  BAR -->|"connect · record · react"| ENGINE
  SBR -->|"session setup · device selection"| ENGINE

  style STAGE    fill:none,stroke:#00ffc8,stroke-width:2px,color:#00ffc8
  style BAR      fill:none,stroke:#00ffc8,stroke-width:2px,color:#00ffc8
  style LKROOM   fill:none,stroke:#00ffc8,stroke-width:2px,color:#00ffc8
  style DC       fill:none,stroke:#00ffc8,stroke-width:2px,color:#00ffc8
  style DRAG     fill:none,stroke:#00ffc8,stroke-width:2px,color:#00ffc8
  style PAGE     fill:none,stroke:#00ffc8,stroke-width:2px,color:#00ffc8
  style ACCESS_LIB fill:none,stroke:#00ffc8,stroke-width:2px,color:#00ffc8
  style LK_SRV   fill:none,stroke:#00ffc8,stroke-width:2px,color:#00ffc8

  style SBL      fill:none,stroke:#00ff66,stroke-width:2px,color:#88ffaa
  style SYNTH    fill:none,stroke:#00ff66,stroke-width:2px,color:#88ffaa
  style GBALL    fill:none,stroke:#00ff66,stroke-width:2px,color:#88ffaa

  style SBR      fill:none,stroke:#ff00cc,stroke-width:2px,color:#ff88ee
  style INVITE_API fill:none,stroke:#ff00cc,stroke-width:2px,color:#ff88ee
  style INVITE_LIB fill:none,stroke:#ff00cc,stroke-width:2px,color:#ff88ee

  style BLUR     fill:none,stroke:#ff8800,stroke-width:2px,color:#ffbb44
  style HAND     fill:none,stroke:#ff8800,stroke-width:2px,color:#ffbb44
  style REC      fill:none,stroke:#ff8800,stroke-width:2px,color:#ffbb44
  style VPS_API  fill:none,stroke:#ff8800,stroke-width:2px,color:#ffbb44

  style PERF     fill:none,stroke:#4488ff,stroke-width:2px,color:#ffaaff
  style REVEAL_IF fill:none,stroke:#4488ff,stroke-width:2px,color:#ffaaff
  style LIVE_START fill:none,stroke:#4488ff,stroke-width:2px,color:#88aaff
  style LIVE_END fill:none,stroke:#4488ff,stroke-width:2px,color:#88aaff
  style LIVE_UPD fill:none,stroke:#4488ff,stroke-width:2px,color:#88aaff
  style LIVE_RESP fill:none,stroke:#4488ff,stroke-width:2px,color:#88aaff
  style LIVE_ACTIVE fill:none,stroke:#4488ff,stroke-width:2px,color:#88aaff
  style SSE_ROUTE fill:none,stroke:#4488ff,stroke-width:2px,color:#88aaff
  style SUPA     fill:none,stroke:#4488ff,stroke-width:2px,color:#88aaff

  style TOKEN_API fill:none,stroke:#ffe000,stroke-width:2px,color:#ffee66

  style WEBHOOK  fill:none,stroke:#ff4466,stroke-width:2px,color:#ff8899

  style M1       fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788
  style M2       fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788
  style M3       fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788
  style M4       fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788
  style STORE_N  fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788
  style VPS_TICK fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788
  style STATS_LOCAL fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788
  style DRAG_LOCAL fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788
  style INVITE_SW fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788
  style TRACKED_PC fill:none,stroke:#2a3a4a,stroke-width:1px,color:#667788

  style R2       fill:none,stroke:#ff8800,stroke-width:2px,color:#ffbb44
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
