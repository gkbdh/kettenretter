"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const start = $("#callback-start");
  const active = $("#callback-active");
  const status = $("#callback-call-status");
  const result = $("#callback-result");
  const mute = $("#mute-callback");
  const canvas = $("#callback-canvas");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let request = null;
  let session = null;
  let run = 0;
  let connecting = false;
  let muted = false;
  let confirmed = false;
  let orb = null;
  let volumes = null;
  let sdk = null;
  let ringContext = null;

  function clearOrb() {
    clearInterval(volumes);
    volumes = null;
    orb?.dispose();
    orb = null;
  }

  function clearRing() {
    if (ringContext) void ringContext.close().catch(() => {});
    ringContext = null;
  }

  function showStart(message = "") {
    start.hidden = false;
    active.hidden = true;
    result.textContent = message;
    $("#answer-callback").disabled = confirmed;
    $("#answer-callback").textContent = confirmed ? "Termin bestätigt" : "Rückruf annehmen";
    mute.hidden = true;
    mute.setAttribute("aria-pressed", "false");
    mute.textContent = "Mikrofon stummschalten";
    muted = false;
    connecting = false;
    clearOrb();
    clearRing();
  }

  async function stop(message = "Gespräch beendet.") {
    run++;
    const previous = session;
    session = null;
    showStart(message);
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

  function ring() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return Promise.resolve();
    ringContext = new Audio();
    const context = ringContext;
    void context.resume().catch(() => {});
    const now = context.currentTime;
    for (let pulse = 0; pulse < 3; pulse++) {
      const begin = now + pulse * 0.68;
      for (const frequency of [440, 554]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, begin);
        gain.gain.linearRampToValueAtTime(0.055, begin + 0.025);
        gain.gain.setValueAtTime(0.055, begin + 0.32);
        gain.gain.linearRampToValueAtTime(0, begin + 0.37);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(begin);
        oscillator.stop(begin + 0.38);
      }
    }
    return new Promise((resolve) => setTimeout(resolve, 2000));
  }

  async function showOrb(current) {
    try {
      const { Orb } = await import("./assets/voice/orb.js");
      if (current !== run || active.hidden || orb) return;
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
    } catch {
      canvas.hidden = true;
    }
  }

  $("#answer-callback").addEventListener("click", async () => {
    if (!request || session || connecting) return;
    const current = ++run;
    connecting = true;
    confirmed = false;
    start.hidden = true;
    active.hidden = false;
    canvas.hidden = false;
    status.textContent = "Es klingelt …";
    void showOrb(current);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      showStart("Für das Gespräch öffne die Webseite bitte über HTTPS oder localhost.");
      return;
    }
    try {
      await ring();
      if (current !== run) return;
      clearRing();
      status.textContent = "Mikrofon freigeben · Verbindung wird aufgebaut …";
      const client = await loadSDK();
      if (current !== run) return;
      const created = await client.Conversation.startSession({
        agentId: "agent_3201m5200xa6ecgv9tcq49q3bp6v",
        connectionType: "websocket",
        dynamicVariables: {
          bike: request.bike,
          issue: request.issue,
          location: request.location,
          time_wish: request.time,
          extra_details: request.callNotes || "Keine weiteren Angaben",
          proposed_time: request.proposedTime,
        },
        clientTools: {
          confirm_demo_visit: async () => {
            if (current !== run || confirmed)
              return { success: false, reason: "Gespräch nicht aktiv oder schon bestätigt" };
            confirmed = true;
            document.dispatchEvent(new Event("demo:callback-confirm"));
            status.textContent = "Termin in der Demo bestätigt · Gespräch läuft";
            return { success: true, scope: "browser_demo_only" };
          },
        },
        onConnect: () => {
          if (current !== run) return;
          status.textContent = "Verbunden · Toms Assistent spricht gleich …";
        },
        onModeChange: ({ mode }) => {
          if (current === run && !confirmed)
            status.textContent = mode === "speaking" ? "Toms Assistent spricht …" : "Ich höre zu …";
        },
        onDisconnect: () => {
          if (current !== run) return;
          session = null;
          showStart(confirmed
            ? "Gespräch beendet · Termin in der Demo bestätigt."
            : "Gespräch beendet · noch kein Termin bestätigt.");
        },
        onError: () => {
          if (current === run) void stop("Verbindung unterbrochen. Bitte versuche es erneut.");
        },
      });
      if (current !== run) {
        await created.endSession();
        return;
      }
      session = created;
      connecting = false;
      mute.hidden = false;
    } catch (error) {
      if (current !== run) return;
      await stop(error?.name === "NotAllowedError"
        ? "Das Mikrofon ist gesperrt. Bitte erlaube den Zugriff im Browser."
        : "Der Rückruf konnte nicht starten. Bitte versuche es erneut.");
    }
  });

  $("#end-callback").addEventListener("click", () => { void stop(); });
  mute.addEventListener("click", () => {
    if (!session) return;
    muted = !muted;
    session.setMicMuted(muted);
    mute.setAttribute("aria-pressed", String(muted));
    mute.textContent = muted ? "Mikrofon einschalten" : "Mikrofon stummschalten";
  });
  document.addEventListener("demo:callback-ready", (event) => {
    request = { ...event.detail };
    confirmed = false;
    showStart();
  });
  document.addEventListener("demo:callback-stop", () => {
    request = null;
    confirmed = false;
    void stop("");
  });
  document.addEventListener("demo:reset", () => {
    request = null;
    confirmed = false;
    void stop("");
  });
  window.addEventListener("pagehide", () => { void stop(""); });
})();
