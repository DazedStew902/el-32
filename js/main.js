/* =====================================================================
   main.js — El 32 Landing Scripts (Performance Pass)
   Structure:
   1) Ambient Light Field Driver (Performance Patch)
   2) Menu Toggle Controller (Phase 2, Refined)
   3) Tagline Translation Toggle
   4) iOS Safari Scroll/Pan Lock

   Goals:
   - Preserve visuals + interactions exactly as-is
   - Reduce Safari/iOS main-thread churn
   - Avoid redundant style writes and per-frame allocations
===================================================================== */

/* =====================================================================
   1) El 32 — Ambient Light Field Driver (Cheap-by-Default)
   Goals:
   - Keep the SAME aesthetic (moving “club lights”)
   - Make it cheaper for Safari/Chromium by default
   - Enable “Ultra” mode (SVG displacement + blend) only on high-end setups

   Output:
   - Adds one class to <html>:
       .fx-cheap  (default on most browsers/devices)
       .fx-ultra  (desktop, non-iOS, higher-core devices)
===================================================================== */

(() => {
  "use strict";

  /* =========================================================
     FX Quality Gate (Cheap-by-default)
  ========================================================== */
  const root = document.documentElement;

  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  const isMobile = window.matchMedia?.("(max-width: 520px)")?.matches ?? false;

  const isIOSSafari =
    /iP(hone|ad|od)/.test(navigator.platform) ||
    (navigator.userAgent.includes("Mac") && "ontouchend" in document);

  const lowCoreDevice = (navigator.hardwareConcurrency || 4) <= 4;

  // Ultra only on higher-end environments
  const ultraOK =
    !prefersReducedMotion && !isMobile && !isIOSSafari && !lowCoreDevice;

  root.classList.toggle("fx-ultra", ultraOK);
  root.classList.toggle("fx-cheap", !ultraOK);

  /* =========================================================
     Ambient Driver
     - Transform-only drift (cheap)
     - Turbulence updates ONLY in ultra mode (expensive)
  ========================================================== */
  const lightfield = document.querySelector(".lightfield");
  const turbulence = document.getElementById("el32-turbulence");
  if (!lightfield) return;

  // Motion tuning (same “feel”, lower churn on cheap mode)
  const AMP_X = prefersReducedMotion ? 8 : (isMobile ? 24 : 56);
  const AMP_Y = prefersReducedMotion ? 6 : (isMobile ? 16 : 40);

  const ENABLE_TURBULENCE = ultraOK && !!turbulence;

  // SVG turbulence tuning (expensive; ultra only)
  const TURB_UPDATE_MS = 160; // ~6fps, keeps the effect but cheaper
  const BASE_FREQ_X = 0.012;
  const BASE_FREQ_Y = 0.018;
  const TURB_VARIANCE = prefersReducedMotion ? 0.0004 : 0.0020;

  // Drift frame throttle (~30fps to reduce main-thread churn)
  const FRAME_MIN_MS = 33;

  let rafId = null;
  let lastFrame = 0;
  let lastTurb = 0;

  // Cache last-written values to avoid redundant style recalcs
  let lastX = NaN;
  let lastY = NaN;
  let lastR = NaN;

  const nearlyEqual = (a, b, eps) => Math.abs(a - b) <= eps;

  const tick = (time) => {
    if (time - lastFrame < FRAME_MIN_MS) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    lastFrame = time;

    const t = time * 0.001;

    // Closed-loop travel + organic oscillation (keeps your same vibe)
    const travelX = Math.sin(t * 0.10) * (AMP_X * 0.55);
    const travelY = Math.cos(t * 0.09) * (AMP_Y * 0.55);

    const x =
      travelX +
      Math.sin(t * 0.35) * AMP_X +
      Math.sin(t * 0.18) * (AMP_X * 0.55);

    const y =
      travelY +
      Math.cos(t * 0.30) * AMP_Y +
      Math.sin(t * 0.22) * (AMP_Y * 0.65);

    const rotation = Math.sin(t * 0.12) * (prefersReducedMotion ? 0.2 : 1.0);

    // Only write CSS vars when value meaningfully changes
    if (!nearlyEqual(x, lastX, 0.06)) {
      lightfield.style.setProperty("--lf-x", `${x}px`);
      lastX = x;
    }

    if (!nearlyEqual(y, lastY, 0.06)) {
      lightfield.style.setProperty("--lf-y", `${y}px`);
      lastY = y;
    }

    if (!nearlyEqual(rotation, lastR, 0.012)) {
      lightfield.style.setProperty("--lf-r", `${rotation}deg`);
      lastR = rotation;
    }

    // Ultra-only: turbulence updates (slow)
    if (ENABLE_TURBULENCE && time - lastTurb > TURB_UPDATE_MS) {
      lastTurb = time;

      const freqX = BASE_FREQ_X + Math.sin(t * 0.22) * TURB_VARIANCE;
      const freqY = BASE_FREQ_Y + Math.cos(t * 0.19) * TURB_VARIANCE;

      turbulence.setAttribute("baseFrequency", `${freqX} ${freqY}`);
    }

    rafId = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  };

  const start = () => {
    if (rafId) return;
    lastFrame = 0;
    lastTurb = 0;
    rafId = requestAnimationFrame(tick);
  };

  // Start
  start();

  // Pause/resume when tab visibility changes
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  // Page lifecycle safety
  window.addEventListener("pagehide", stop, { passive: true });
  window.addEventListener("pageshow", start, { passive: true });
})();

/* =====================================================================
   2) El 32 — Menu Toggle Controller (Phase 2, Refined)
   Purpose:
   - Non-boxy nav reveal under logo
   - Accessibility: aria-expanded, Escape to close, click-outside
   Notes:
   - Uses data-open + CSS transitions
   - IMPORTANT: Your HTML uses `hidden` on the panel.
     To keep your animation smooth, we:
       - Remove hidden immediately on open
       - Re-add hidden after the close transition finishes
===================================================================== */

(() => {
  "use strict";

  const root = document.querySelector("[data-menu]");
  if (!root) return;

  const toggle = root.querySelector("[data-menu-toggle]");
  const panel = root.querySelector("[data-menu-panel]");
  if (!toggle || !panel) return;

  let isOpen = false;
  let hideTimer = null;

  /* =========================================================
   Performance mode:
   - When menu is open, reduce expensive FX paints (Safari)
========================================================= */
const setPerfMode = (on) => {
  document.documentElement.classList.toggle("menu-open", on);
};

  // Match your CSS close timing:
  // .menu__panel transition: max-height 520ms ...
  const HIDE_AFTER_CLOSE_MS = 460;

  const setState = (open) => {
    isOpen = open;
    root.dataset.open = open ? "true" : "false";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    panel.setAttribute("aria-hidden", open ? "false" : "true");
  };

  // Initialize closed
  setState(false);
  panel.hidden = true;

  const openMenu = () => {
    if (isOpen) return;

    setPerfMode(true);

    // Ensure panel can animate (removes UA display:none from [hidden])
    panel.hidden = false;

    // Cancel any pending hide from a recent close
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    setState(true);

    // Optional: focus first link for keyboard users (UNCHANGED behavior)
    const firstLink = panel.querySelector("a[href]");
    firstLink?.focus?.({ preventScroll: true });
  };

  const closeMenu = () => {
    if (!isOpen) return;

    setState(false);

    setPerfMode(false);

    // Re-apply hidden after the close animation completes
    hideTimer = window.setTimeout(() => {
      if (!isOpen) panel.hidden = true;
    }, HIDE_AFTER_CLOSE_MS);

    toggle.focus?.({ preventScroll: true });
  };

  toggle.addEventListener(
    "click",
    () => (isOpen ? closeMenu() : openMenu()),
    { passive: true }
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  document.addEventListener("pointerdown", (e) => {
    if (!isOpen) return;
    if (!root.contains(e.target)) closeMenu();
  });

  panel.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    closeMenu();
  });
})();

/* =====================================================================
   El 32 — Logo Flicker Replay (No layout changes)
===================================================================== */
(() => {
  "use strict";

  const logo = document.querySelector("[data-logo]");
  if (!logo) return;

  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  if (prefersReducedMotion) return;

  const replay = () => {
    // Reset animation
    logo.style.animation = "none";

    // Force reflow so the reset is applied
    // eslint-disable-next-line no-unused-expressions
    logo.offsetHeight;

    // Replay exactly the same animation as CSS
    logo.style.animation =
      "el32-voltage-flicker 2200ms cubic-bezier(0.22, 1, 0.36, 1) forwards";
  };

  logo.addEventListener("click", replay);

  // Keyboard support (Enter/Space)
  logo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      replay();
    }
  });
})();

/* =====================================================================
   3) El 32 — Tagline Translation Toggle
   Purpose:
   - Tap/click toggles Spanish ↔ English text
   - Keeps DOM simple and accessible
===================================================================== */

(() => {
  "use strict";

  const btn = document.querySelector("[data-tagline]");
  if (!btn) return;

  const es = btn.querySelector("[data-es]");
  const en = btn.querySelector("[data-en]");
  if (!es || !en) return;

  const setLang = (lang) => {
    const isEnglish = lang === "en";

    btn.dataset.lang = lang;
    btn.setAttribute("aria-pressed", isEnglish ? "true" : "false");

    es.hidden = isEnglish;
    en.hidden = !isEnglish;
  };

  // Default: Spanish (UNCHANGED)
  setLang(btn.dataset.lang || "es");

  btn.addEventListener("click", () => {
    const next = btn.dataset.lang === "es" ? "en" : "es";
    setLang(next);
  });
})();

/* =====================================================================
   4) iOS Safari Scroll/Pan Lock
   - Prevents touch panning (rubber-band / scroll) on a fixed landing
   - Does NOT break taps/clicks on buttons/links
   - Uses cancelable guard to reduce overhead / console noise
===================================================================== */

(() => {
  const isIOSSafari =
    /iP(hone|ad|od)/.test(navigator.platform) ||
    (navigator.userAgent.includes("Mac") && "ontouchend" in document);

  if (!isIOSSafari) return;

    // Only lock scroll on the landing page
  if (!document.body.classList.contains("is-landing")) return;

  // Block page drag (but allow taps)
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.cancelable) e.preventDefault();
    },
    { passive: false }
  );

  // Block pinch-zoom gestures (older iOS Safari events)
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("gesturechange", (e) => e.preventDefault());
  document.addEventListener("gestureend", (e) => e.preventDefault());
})();

/* =====================================================================
   Inner Pages — Simple Load-In Reveal (Performance Safe)
   - Reveals ALL [data-reveal] elements (not just the first)
   - Staggers [data-reveal-item] rows for polish
   - Respects prefers-reduced-motion
===================================================================== */
(() => {
  "use strict";

  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  if (prefersReducedMotion) return;

  const headlines = Array.from(document.querySelectorAll("[data-reveal]"));
  const items = Array.from(document.querySelectorAll("[data-reveal-item]"));

  if (headlines.length === 0 && items.length === 0) return;

  // Start: next paint, then animate in (prevents “no-transition” first frame)
  requestAnimationFrame(() => {
    headlines.forEach((el, i) => {
      // Tiny stagger so multiple headings feel intentional
      const delay = i * 80;
      window.setTimeout(() => el.classList.add("is-in"), delay);
    });

    // Stagger rows (tiny and cheap)
    items.forEach((el, i) => {
      const delay = 120 + i * 90;
      window.setTimeout(() => el.classList.add("is-in"), delay);
    });
  });
})();

/* =====================================================================
   El 32 — Party Gallery Lightbox (Swipe + Keys, Stable)
   Structure:
   - Defensive DOM lookups
   - Open/close + focus restore
   - Prev/next + preload neighbors
   - Swipe: velocity + distance thresholds (your “second swipe” behavior)
   Notes:
   - Everything stays inside ONE IIFE to avoid ReferenceErrors
===================================================================== */
(() => {
  "use strict";

  const tiles = Array.from(document.querySelectorAll(".gallery-btn img"));
  const lb = document.querySelector("[data-lightbox]");
  if (tiles.length === 0 || !lb) return;

  const imgEl = lb.querySelector("[data-lb-img]");
  const stage = lb.querySelector("[data-lb-stage]");
  const btnPrev = lb.querySelector("[data-lb-prev]");
  const btnNext = lb.querySelector("[data-lb-next]");
  const closeBtns = Array.from(lb.querySelectorAll("[data-lb-close]"));
  if (!imgEl || !stage) return;

  const scroller = document.querySelector(".page__scroll"); // inner-page scroll container

  let index = 0;
  let isOpen = false;
  let lastActive = null;

  // --- helpers ---------------------------------------------------------

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const getFullSrc = (i) =>
    tiles[(i + tiles.length) % tiles.length]?.getAttribute("data-full") ||
    tiles[(i + tiles.length) % tiles.length]?.getAttribute("src") ||
    "";

  const preload = (src) => {
    if (!src) return;
    const im = new Image();
    im.decoding = "async";
    im.src = src;
  };

  const setIndex = (nextIndex) => {
    index = (nextIndex + tiles.length) % tiles.length;
    const src = getFullSrc(index);
    if (!src) return;

    // Swap image
    imgEl.src = src;

    // Preload neighbors (cheap; improves swipe feel)
    preload(getFullSrc(index - 1));
    preload(getFullSrc(index + 1));
  };

  const prev = () => setIndex(index - 1);
  const next = () => setIndex(index + 1);

  // --- open/close ------------------------------------------------------

  const open = (i, triggerEl) => {
    if (isOpen) return;
    isOpen = true;

    lastActive = triggerEl || document.activeElement;

    lb.hidden = false;
    lb.setAttribute("aria-hidden", "false");

    // Lock only the inner scroller (keeps ambience stable)
    if (scroller) scroller.style.overflow = "hidden";

    // Ensure clean visual state
    imgEl.classList.remove("is-dragging");
    imgEl.style.transform = "";
    imgEl.style.opacity = "";

    setIndex(i);

    // Focus close for accessibility
    const closeBtn = lb.querySelector("[data-lb-close]");
    closeBtn?.focus?.({ preventScroll: true });
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;

    lb.setAttribute("aria-hidden", "true");
    lb.hidden = true;

    if (scroller) scroller.style.overflow = "";

    // Reset any swipe visuals
    imgEl.classList.remove("is-dragging");
    imgEl.style.transform = "";
    imgEl.style.opacity = "";

    lastActive?.focus?.({ preventScroll: true });
  };

  // --- click wiring ----------------------------------------------------

  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".gallery-btn");
    if (!btn) return;

    const img = btn.querySelector("img");
    const i = tiles.indexOf(img);
    if (i >= 0) open(i, btn);
  });

  closeBtns.forEach((b) => b.addEventListener("click", close));
  btnPrev?.addEventListener("click", prev);
  btnNext?.addEventListener("click", next);

  // --- keyboard --------------------------------------------------------

  document.addEventListener("keydown", (e) => {
    if (!isOpen) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  });

  // --- swipe (your “second swipe” behavior) ----------------------------

  let pointerDown = false;
  let startX = 0;
  let deltaX = 0;
  let startT = 0;
  let activePointerId = null;
  let isAnimating = false;

  const setDragVisual = (dx) => {
    const w = Math.max(320, window.innerWidth);
    const progress = clamp(Math.abs(dx) / (w * 0.9), 0, 1);
    const opacity = 1 - progress * 0.25;

    imgEl.style.transform = `translate3d(${dx}px, 0, 0)`;
    imgEl.style.opacity = `${opacity}`;
  };

  const resetVisual = () => {
    imgEl.style.transform = "";
    imgEl.style.opacity = "";
  };

  const animateTo = (dx, opacity = 1, cb) => {
    if (isAnimating) return;
    isAnimating = true;

    // Ensure transitions apply (your CSS uses transition unless .is-dragging)
    imgEl.classList.remove("is-dragging");

    requestAnimationFrame(() => {
      imgEl.style.transform = `translate3d(${dx}px, 0, 0)`;
      imgEl.style.opacity = `${opacity}`;

      const done = () => {
        isAnimating = false;
        cb?.();
      };

      // Use once to avoid leaks
      imgEl.addEventListener("transitionend", done, { once: true });
    });
  };

  stage.addEventListener("pointerdown", (e) => {
    if (!isOpen || isAnimating) return;

    pointerDown = true;
    activePointerId = e.pointerId;
    startX = e.clientX;
    deltaX = 0;
    startT = performance.now();

    imgEl.classList.add("is-dragging");
    stage.setPointerCapture?.(activePointerId);
  });

  stage.addEventListener("pointermove", (e) => {
    if (!pointerDown || e.pointerId !== activePointerId) return;

    deltaX = e.clientX - startX;
    setDragVisual(deltaX);
  });

  const finishSwipe = () => {
    if (!pointerDown) return;

    pointerDown = false;

    const w = Math.max(320, window.innerWidth);
    const elapsed = Math.max(1, performance.now() - startT);
    const velocity = deltaX / elapsed; // px per ms

    // Tuned thresholds: responsive but not jumpy
    const distanceOK = Math.abs(deltaX) > w * 0.18;
    const velocityOK = Math.abs(velocity) > 0.65;

    // Determine direction: swipe left => next, swipe right => prev
    const dir = deltaX < 0 ? 1 : -1;

    // If not enough swipe, snap back cleanly
    if (!(distanceOK || velocityOK)) {
      animateTo(0, 1, () => {
        resetVisual();
      });
      return;
    }

    // Slide current image out
    const outX = dir === 1 ? -w : w;

    animateTo(outX, 0.9, () => {
      // Swap image once off-screen
      if (dir === 1) next();
      else prev();

      // Place new image just off-screen opposite side (no transition)
      imgEl.classList.add("is-dragging");
      imgEl.style.transform = `translate3d(${dir === 1 ? w : -w}px, 0, 0)`;
      imgEl.style.opacity = "0.9";

      // Animate into place
      requestAnimationFrame(() => {
        imgEl.classList.remove("is-dragging");
        resetVisual();
      });
    });
  };

  stage.addEventListener("pointerup", finishSwipe);
  stage.addEventListener("pointercancel", finishSwipe);
})();

/* =====================================================================
   About Lead — Translation Toggle (Matches tagline behavior)
   Purpose:
   - Tap/click toggles English ↔ Spanish statement
   - Uses hidden span swap (same pattern as tagline)
===================================================================== */

(() => {
  "use strict";

  const btn = document.querySelector("[data-about-lead]");
  if (!btn) return;

  const en = btn.querySelector("[data-en]");
  const es = btn.querySelector("[data-es]");
  if (!en || !es) return;

  const setLang = (lang) => {
    const isSpanish = lang === "es";

    btn.dataset.lang = lang;
    btn.setAttribute("aria-pressed", isSpanish ? "true" : "false");

    en.hidden = isSpanish;
    es.hidden = !isSpanish;
  };

  // Default: English
  setLang(btn.dataset.lang || "en");

  btn.addEventListener("click", () => {
    const next = btn.dataset.lang === "en" ? "es" : "en";
    setLang(next);
  });
})();

/* =========================================================
   Disable pinch-to-zoom (hard lock)
   - iOS Safari / touch devices
========================================================= */
(() => {
  document.addEventListener(
    "gesturestart",
    (e) => e.preventDefault(),
    { passive: false }
  );

  document.addEventListener(
    "gesturechange",
    (e) => e.preventDefault(),
    { passive: false }
  );

  document.addEventListener(
    "gestureend",
    (e) => e.preventDefault(),
    { passive: false }
  );
})();