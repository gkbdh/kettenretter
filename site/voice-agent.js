"use strict";
(() => {
  const dialog = document.querySelector("#voice-dialog");
  const toggle = document.querySelector("#voice-toggle");
  const label = document.querySelector("#voice-toggle-label");
  const status = document.querySelector("#live-voice-status");
  const mute = document.querySelector("#voice-mute");
  const canvas = document.querySelector("#voice-canvas");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let session = null;
  let attempt = 0;
  let connecting = false;
  let muted = false;
  let orb = null;
  let volumes = null;
  let sdk = null;

  function idle(message = "Dein virtueller Assistent hört dir zu.") {
    connecting = false;
    toggle.disabled = false;
    label.textContent = "Mit Tom sprechen";
    status.textContent = message;
    mute.hidden = true;
    muted = false;
    mute.setAttribute("aria-pressed", "false");
    mute.textContent = "Mikrofon stummschalten";
    dialog.classList.remove("voice-active");
  }

  async function stop(message = "Gespräch beendet.") {
    attempt++;
    const previous = session;
    session = null;
    idle(message);
    if (previous) await previous.endSession().catch(() => {});
  }

  function loadSDK() {
    if (window.ElevenLabsClient) return Promise.resolve(window.ElevenLabsClient);
    if (!sdk) sdk = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "assets/voice/client.js";
      script.onload = () => resolve(window.ElevenLabsClient);
      script.onerror = () => { script.remove(); sdk = null; reject(new Error("load")); };
      document.head.append(script);
    });
    return sdk;
  }

  async function show() {
    document.querySelector("#callback-audio")?.pause();
    idle();
    dialog.showModal();
    toggle.focus();
    try {
      const { Orb } = await import("./assets/voice/orb.js");
      if (!dialog.open || orb) return;
      orb = new Orb(canvas);
      orb.updateColors("#08735f", "#70bfd2");
      if (reducedMotion.matches) {
        cancelAnimationFrame(orb.rafId);
        orb.rafId = null;
        orb.render();
        cancelAnimationFrame(orb.rafId);
        orb.rafId = null;
      }
      volumes = setInterval(() => {
        if (orb && session && !reducedMotion.matches)
          orb.updateVolume(session.getInputVolume(), session.getOutputVolume());
      }, 80);
    } catch (_) {
      // The CSS sphere remains visible when WebGL is unavailable.
      canvas.hidden = true;
    }
  }

  document.querySelector("#start-voicebot").addEventListener("click", show);
  toggle.addEventListener("click", async () => {
    if (session || connecting) return stop();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      status.textContent = "Für das Mikrofon öffne die Webseite bitte über HTTPS.";
      return;
    }
    const current = ++attempt;
    connecting = true;
    label.textContent = "Abbrechen";
    status.textContent = "Mikrofon freigeben · Verbindung wird aufgebaut …";
    try {
      const client = await loadSDK();
      if (attempt !== current || !dialog.open) return;
      const created = await client.Conversation.startSession({
        agentId: "agent_2501m4t5qbemfxvswmg7fyzxzd3c",
        connectionType: "websocket",
        onConnect: () => {
          if (attempt !== current || !dialog.open) return;
          connecting = false;
          label.textContent = "Gespräch beenden";
          status.textContent = "Verbunden";
          mute.hidden = false;
          dialog.classList.add("voice-active");
        },
        onModeChange: ({ mode }) => {
          if (attempt === current && dialog.open)
            status.textContent = mode === "speaking" ? "Assistent spricht …" : "Ich höre zu …";
        },
        onDisconnect: () => {
          if (attempt !== current) return;
          session = null;
          attempt++;
          idle("Gespräch beendet.");
        },
        onError: () => {
          if (attempt === current) void stop("Verbindung unterbrochen. Bitte versuche es noch einmal.");
        },
      });
      if (attempt !== current || !dialog.open) {
        await created.endSession();
        return;
      }
      session = created;
      connecting = false;
      label.textContent = "Gespräch beenden";
      mute.hidden = false;
    } catch (error) {
      if (attempt !== current) return;
      idle(error?.name === "NotAllowedError"
        ? "Das Mikrofon ist gesperrt. Bitte erlaube den Zugriff in deinem Browser."
        : "Das Gespräch konnte nicht starten. Prüfe Mikrofon und Verbindung und versuche es erneut.");
    }
  });
  mute.addEventListener("click", () => {
    if (!session) return;
    muted = !muted;
    session.setMicMuted(muted);
    mute.setAttribute("aria-pressed", String(muted));
    mute.textContent = muted ? "Mikrofon einschalten" : "Mikrofon stummschalten";
  });
  document.querySelector("#close-voice").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    void stop();
    clearInterval(volumes);
    volumes = null;
    orb?.dispose();
    orb = null;
  });
  window.addEventListener("pagehide", () => { void stop(); });
})();
