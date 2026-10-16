"use strict";
(() => {
  const call = document.querySelector("#voice-call");
  const intro = document.querySelector("#call-intro");
  const live = document.querySelector("#inline-voice");
  const start = document.querySelector("#start-voicebot");
  const toggle = document.querySelector("#voice-toggle");
  const label = document.querySelector("#voice-toggle-label");
  const status = document.querySelector("#live-voice-status");
  const mute = document.querySelector("#voice-mute");
  const canvas = document.querySelector("#voice-canvas");
  const coach = document.querySelector("#voice-coach");
  const story = document.querySelector("#brand-story");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let session = null;
  let attempt = 0;
  let connecting = false;
  let muted = false;
  let orb = null;
  let volumes = null;
  let sdk = null;

  function disposeOrb() {
    clearInterval(volumes);
    volumes = null;
    orb?.dispose();
    orb = null;
  }

  function idle(message = "") {
    connecting = false;
    intro.hidden = false;
    live.hidden = true;
    coach.hidden = true;
    story.hidden = false;
    status.textContent = message;
    mute.hidden = true;
    muted = false;
    mute.setAttribute("aria-pressed", "false");
    mute.textContent = "Mikrofon stummschalten";
    call.classList.remove("voice-active");
    disposeOrb();
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

  async function showOrb(current) {
    canvas.hidden = false;
    try {
      const { Orb } = await import("./assets/voice/orb.js");
      if (attempt !== current || live.hidden || orb) return;
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
      // The local CSS sphere keeps the call usable without WebGL.
      if (attempt === current) canvas.hidden = true;
    }
  }

  start.addEventListener("click", async () => {
    if (session || connecting) return;
    document.querySelector("#callback-audio")?.pause();
    const current = ++attempt;
    connecting = true;
    intro.hidden = true;
    live.hidden = false;
    coach.hidden = false;
    story.hidden = true;
    label.textContent = "Abbrechen";
    status.textContent = "Mikrofon freigeben · Verbindung wird aufgebaut …";
    toggle.focus({ preventScroll: true });
    void showOrb(current);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      idle("Für das Mikrofon öffne die Webseite bitte über HTTPS.");
      return;
    }
    try {
      const client = await loadSDK();
      if (attempt !== current) return;
      const created = await client.Conversation.startSession({
        agentId: "agent_2501m4t5qbemfxvswmg7fyzxzd3c",
        connectionType: "websocket",
        onConnect: () => {
          if (attempt !== current) return;
          label.textContent = "Gespräch beenden";
          status.textContent = "Verbunden";
          call.classList.add("voice-active");
        },
        onModeChange: ({ mode }) => {
          if (attempt === current)
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
      if (attempt !== current) {
        await created.endSession();
        return;
      }
      session = created;
      connecting = false;
      label.textContent = "Gespräch beenden";
      mute.hidden = false;
    } catch (error) {
      if (attempt !== current) return;
      attempt++;
      idle(error?.name === "NotAllowedError"
        ? "Das Mikrofon ist gesperrt. Bitte erlaube den Zugriff in deinem Browser."
        : "Das Gespräch konnte nicht starten. Prüfe Mikrofon und Verbindung und versuche es erneut.");
    }
  });
  toggle.addEventListener("click", () => { void stop(); start.focus({ preventScroll: true }); });
  mute.addEventListener("click", () => {
    if (!session) return;
    muted = !muted;
    session.setMicMuted(muted);
    mute.setAttribute("aria-pressed", String(muted));
    mute.textContent = muted ? "Mikrofon einschalten" : "Mikrofon stummschalten";
  });
  document.addEventListener("demo:channel", event => {
    if (event.detail !== "phone") void stop("");
  });
  document.addEventListener("demo:reset", () => { void stop(""); });
  document.querySelector("#show-phone-example").addEventListener("click", () => { void stop(); });
  window.addEventListener("pagehide", () => { void stop(); });
})();
