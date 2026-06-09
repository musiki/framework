export function initMediaViewer() {
  const selector = "article img, .content img, .markdown-body img, .content-area img";

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
        <img class="media-viewer__image" alt="" draggable="false">
      </div>
    `;
    document.body.appendChild(modal);
  }

  const image = modal.querySelector(".media-viewer__image");
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
    image.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
  }

  function resetTransform() {
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    applyTransform();
  }

  function openViewer(sourceImage) {
    image.src = sourceImage.currentSrc || sourceImage.src;
    image.alt = sourceImage.alt || "";
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
    const rect = image.getBoundingClientRect();
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

  function isEligible(img) {
    if (img.classList.contains("no-viewer") || 
        img.classList.contains("no-media-viewer") || 
        img.classList.contains("icon") || 
        img.classList.contains("logo")) {
      return false;
    }
    if (img.closest("header, nav, footer, a, button, [data-content-media-ignore]")) {
      return false;
    }
    return true;
  }

  function setupImage(img) {
    if (img.dataset.mediaViewerBound === "true") return;
    if (!isEligible(img)) return;

    function applyEligibleCursor() {
      if (img.width >= 120 && img.height >= 120) {
        img.style.cursor = "zoom-in";
        img.dataset.mediaViewerBound = "true";
        img.addEventListener("click", onClick);
      }
    }

    function onClick() {
      openViewer(img);
    }

    if (img.complete) {
      applyEligibleCursor();
    } else {
      img.addEventListener("load", applyEligibleCursor, { once: true });
    }
  }

  // Bind to existing images
  document.querySelectorAll(selector).forEach(setupImage);

  // Re-run setup for dynamic images via MutationObserver
  if (isNewModal || !modal.observer) {
    const observer = new MutationObserver(() => {
      document.querySelectorAll(selector).forEach(setupImage);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    modal.observer = observer;
  }

  // Bind modal event listeners once
  if (isNewModal || !modal.dataset.mediaViewerEventsBound) {
    modal.dataset.mediaViewerEventsBound = "true";

    fog.addEventListener("click", closeViewer);

    modal.addEventListener("wheel", (event) => {
      if (!state.isOpen) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const factor = direction > 0 ? 1.12 : 0.88;
      zoomAt(event.clientX, event.clientY, state.scale * factor);
    }, { passive: false });

    image.addEventListener("pointerdown", (event) => {
      if (!state.isOpen) return;
      event.preventDefault();
      image.setPointerCapture(event.pointerId);
      state.activePointers.set(event.pointerId, event);
      state.didMove = false;

      if (state.activePointers.size === 1) {
        state.isDragging = true;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        image.classList.add("is-dragging");
      }
      if (state.activePointers.size === 2) {
        const points = Array.from(state.activePointers.values());
        state.initialPinchDistance = getDistance(points[0], points[1]);
        state.initialScale = state.scale;
      }
    });

    image.addEventListener("pointermove", (event) => {
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

    image.addEventListener("pointerup", (event) => {
      state.activePointers.delete(event.pointerId);
      state.isDragging = false;
      image.classList.remove("is-dragging");
    });

    image.addEventListener("pointercancel", (event) => {
      state.activePointers.delete(event.pointerId);
      state.isDragging = false;
      image.classList.remove("is-dragging");
    });

    image.addEventListener("click", (event) => {
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
