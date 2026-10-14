import { useEffect } from "react";
import { progressApi } from "../api/client";

const STUDY_ROUTES = {
  "/app/planner": "planner",
  "/app/explainer": "explainer",
  "/app/hub": "hub",
  "/app/tests": "tests",
  "/app/proctor": "proctor",
  "/app/evaluator": "evaluator",
  "/app/coach": "coach"
};

// Exams and voice revision can run for a long time without mouse or keyboard input.
const NO_IDLE_CHECK = new Set(["proctor", "coach"]);
const TICK_MS = 15 * 1000;
const FLUSH_MS = 60 * 1000;
const IDLE_LIMIT_MS = 10 * 60 * 1000;

// Counts time the student actively spends on a study page and reports it to My Progress.
function useStudyTimeTracker(pathname) {
  const feature = STUDY_ROUTES[pathname];

  useEffect(() => {
    if (!feature) {
      return undefined;
    }

    let pendingMs = 0;
    let lastTick = Date.now();
    let lastInput = Date.now();

    function markInput() {
      lastInput = Date.now();
    }

    function tick() {
      const now = Date.now();
      const isVisible = document.visibilityState === "visible";
      const isActive = NO_IDLE_CHECK.has(feature) || now - lastInput < IDLE_LIMIT_MS;

      if (isVisible && isActive) {
        pendingMs += Math.min(now - lastTick, TICK_MS * 2);
      }

      lastTick = now;
    }

    function flush() {
      tick();

      if (pendingMs < 5000) {
        return;
      }

      const minutes = pendingMs / 60000;
      pendingMs = 0;
      progressApi.addTime(feature, minutes).catch(() => {});
    }

    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        flush();
      } else {
        lastTick = Date.now();
      }
    }

    const inputEvents = ["pointerdown", "keydown", "scroll", "touchstart"];
    inputEvents.forEach((name) => window.addEventListener(name, markInput, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", flush);
    const tickTimer = window.setInterval(tick, TICK_MS);
    const flushTimer = window.setInterval(flush, FLUSH_MS);

    return () => {
      flush();
      inputEvents.forEach((name) => window.removeEventListener(name, markInput, { capture: true }));
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", flush);
      window.clearInterval(tickTimer);
      window.clearInterval(flushTimer);
    };
  }, [feature]);
}

export default useStudyTimeTracker;
