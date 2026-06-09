export function initMediaViewer() {
  let modal = document.querySelector(".media-viewer");
  const isNewModal = !modal;

  if (isNewModal) {
    modal = document.createElement("div");
    modal.className = "media-viewer";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Image viewer");
    modal.innerHTML = `
      <div class="media-viewer__fog" data-close></div>
      <div class="media-viewer__stage">
        <div class="media-viewer__content"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const content = modal.querySelector(".media-viewer__content");
  const fog = modal.querySelector("[data-close]");

  // We store the state on the modal element so that it persists and is shared
  // if the script runs again on client-side page transitions.
  if (!modal.state) {
    modal.state = {
      isOpen: false,
      scale: 1,
      minScale: 1,
      maxScale: 6,
      x: 0,
      y: 0,
      isDragging: false,
      lastX: 0,
      lastY: 0,
      activePointers: new Map(),
      initialPinchDistance: 0,
      initialScale: 1,
      didMove: false,
    };
  }

  const state = modal.state;

  function applyTransform() {
    content.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
  }

  function resetTransform() {
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    applyTransform();
  }

  function cloneMedia(el) {
    const tagName = el.tagName.toLowerCase();
    if (tagName === "img") {
      const clone = document.createElement("img");
      clone.src = el.currentSrc || el.src;
      clone.alt = el.alt || "";
      clone.setAttribute("draggable", "false");
      return clone;
    }
    
    // SVG or Mermaid container (contains SVG)
    const clone = el.cloneNode(true);
    
    // Remove fixed dimensions so it scales cleanly with CSS
    if (clone.tagName.toLowerCase() === "svg") {
      clone.removeAttribute("width");
      clone.removeAttribute("height");
    } else {
      const svgs = clone.querySelectorAll("svg");
      svgs.forEach((svg) => {
        svg.removeAttribute("width");
        svg.removeAttribute("height");
      });
    }
    return clone;
  }

  function openViewer(sourceElement) {
    content.innerHTML = "";
    const clone = cloneMedia(sourceElement);
    content.appendChild(clone);

    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    state.isOpen = true;
    resetTransform();
  }

  function closeViewer() {
    modal.classList.remove("is-open");
    document.body.style.overflow = "";
    state.isOpen = false;
    state.activePointers.clear();
    resetTransform();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getDistance(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function zoomAt(clientX, clientY, nextScale) {
    const rect = content.getBoundingClientRect();
    const previousScale = state.scale;
    nextScale = clamp(nextScale, state.minScale, state.maxScale);
    if (nextScale === previousScale) return;

    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const ratio = nextScale / previousScale;
    state.x -= dx * (ratio - 1);
    state.y -= dy * (ratio - 1);
    state.scale = nextScale;
    if (state.scale <= 1.01) {
      resetTransform();
    } else {
      applyTransform();
    }
  }

  function isEligible(el) {
    if (el.classList.contains("no-viewer") || 
        el.classList.contains("no-media-viewer") || 
        el.classList.contains("icon") || 
        el.classList.contains("logo") ||
        el.dataset.contentMediaIgnore === "true") {
      return false;
    }
    if (el.closest("header, nav, footer, a, button, [data-content-media-ignore]")) {
      return false;
    }
    return true;
  }

  function findZoomableMedia(target) {
    if (!target) return null;
    
    // 1. Check if it's an image
    const img = target.closest("img");
    if (img && img.closest("article, .content, .markdown-body, .content-area")) {
      return img;
    }
    
    // 2. Check if it's a mermaid container
    const mermaid = target.closest(".mermaid");
    if (mermaid && mermaid.closest("article, .content, .markdown-body, .content-area")) {
      return mermaid;
    }
    
    // 3. Check if it's a standalone SVG
    const svg = target.closest("svg");
    if (svg && svg.closest("article, .content, .markdown-body, .content-area")) {
      if (svg.closest("a, button, .mermaid, [data-content-media-ignore]")) return null;
      return svg;
    }
    
    return null;
  }

  // Bind single event-delegated listener once on document
  if (isNewModal || !modal.dataset.mediaViewerDelegated) {
    modal.dataset.mediaViewerDelegated = "true";

    document.addEventListener("click", (event) => {
      const media = findZoomableMedia(event.target);
      if (!media) return;
      if (!isEligible(media)) return;

      const rect = media.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 120) return;

      event.preventDefault();
      event.stopPropagation();
      openViewer(media);
    });
  }

  // Bind modal event listeners once
  if (isNewModal || !modal.dataset.mediaViewerEventsBound) {
    modal.dataset.mediaViewerEventsBound = "true";

    fog.addEventListener("click", closeViewer);

    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.classList.contains("media-viewer__stage")) {
        closeViewer();
      }
    });

    modal.addEventListener("wheel", (event) => {
      if (!state.isOpen) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const factor = direction > 0 ? 1.12 : 0.88;
      zoomAt(event.clientX, event.clientY, state.scale * factor);
    }, { passive: false });

    content.addEventListener("pointerdown", (event) => {
      if (!state.isOpen) return;
      event.preventDefault();
      content.setPointerCapture(event.pointerId);
      state.activePointers.set(event.pointerId, event);
      state.didMove = false;

      if (state.activePointers.size === 1) {
        state.isDragging = true;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        content.classList.add("is-dragging");
      }
      if (state.activePointers.size === 2) {
        const points = Array.from(state.activePointers.values());
        state.initialPinchDistance = getDistance(points[0], points[1]);
        state.initialScale = state.scale;
      }
    });

    content.addEventListener("pointermove", (event) => {
      if (!state.isOpen || !state.activePointers.has(event.pointerId)) return;
      state.activePointers.set(event.pointerId, event);

      if (state.activePointers.size === 2) {
        const points = Array.from(state.activePointers.values());
        const distance = getDistance(points[0], points[1]);
        if (state.initialPinchDistance > 0) {
          state.scale = clamp(
            state.initialScale * (distance / state.initialPinchDistance),
            state.minScale,
            state.maxScale
          );
          state.didMove = true;
          applyTransform();
        }
        return;
      }

      if (state.isDragging && state.scale > 1) {
        const dx = event.clientX - state.lastX;
        const dy = event.clientY - state.lastY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          state.didMove = true;
        }
        state.x += dx;
        state.y += dy;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        applyTransform();
      }
    });

    content.addEventListener("pointerup", (event) => {
      state.activePointers.delete(event.pointerId);
      state.isDragging = false;
      content.classList.remove("is-dragging");
    });

    content.addEventListener("pointercancel", (event) => {
      state.activePointers.delete(event.pointerId);
      state.isDragging = false;
      content.classList.remove("is-dragging");
    });

    content.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.didMove) {
        state.didMove = false;
        return;
      }
      if (state.scale > 1.05) {
        resetTransform();
      } else {
        closeViewer();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (!state.isOpen) return;
      if (event.key === "Escape") closeViewer();
    });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initMediaViewer);
  document.addEventListener("astro:page-load", initMediaViewer);
}
