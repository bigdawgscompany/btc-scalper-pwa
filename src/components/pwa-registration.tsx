"use client";

import { useEffect, useState } from "react";

/**
 * Production-only service worker registration with owner-only update
 * activation (§7). Only the execution-owner tab (paused + flat) may
 * activate an update; other tabs show a waiting prompt.
 */
export function PwaRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);

  useEffect(() => {
    // Only register in production (§7)
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // Listen for a waiting worker (new version available)
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                setWaiting(newWorker);
                setShowUpdatePrompt(true);
              }
            });
          }
        });
      } catch (err) {
        console.error("SW registration failed:", err);
      }
    };

    register();
  }, []);

  const handleActivate = () => {
    if (waiting) {
      // Only the owner tab should activate; pause + cancel first (§7)
      waiting.postMessage({ type: "SKIP_WAITING" });
      setShowUpdatePrompt(false);
      // Reload to activate the new worker
      window.location.reload();
    }
  };

  if (!showUpdatePrompt) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#11161D",
        border: "1px solid #283340",
        borderRadius: 8,
        padding: "12px 16px",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      <span style={{ fontSize: 12, color: "#A7B0BC" }}>
        A new version is available. Pause the autopilot and close all other tabs before updating.
      </span>
      <button
        onClick={handleActivate}
        className="btn btn-primary"
        style={{ minHeight: 36, fontSize: 12 }}
      >
        Update & Reload
      </button>
      <button
        onClick={() => setShowUpdatePrompt(false)}
        className="btn btn-ghost"
        style={{ minHeight: 36, fontSize: 12 }}
      >
        Later
      </button>
    </div>
  );
}