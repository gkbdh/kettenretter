"use strict";
// Demo state stays in memory; speech sends only four example fields to our host.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const defaults = {
  bike: "Lastenrad",
  issue: "Platter Reifen",
  location: "6020 Innsbruck, am Marktplatz",
  time: "Heute, wenn möglich",
  phone: "+1 202 555 0123",
};
let state;
let generation = 0;
let geoAttempt = 0;
let photoURL = null;
const audio = $("#callback-audio");
const staticSpeech = $('meta[name="speech-mode"]')?.content === "static";
const speechFields = ["bike", "issue", "location", "time"];
const speechCache = new Map();
let readyConversation = false;
let playbackGeneration = null;
function dialoguePlan(request) {
  const slots = {
    "Heute, wenn möglich": "Dienstag, 15:00 Uhr",
    "Dienstag, 15–17 Uhr": "Dienstag, 15:00 Uhr",
    "Mittwoch, 15–17 Uhr": "Mittwoch, 16:00 Uhr",
    "Donnerstag, 15–17 Uhr": "Donnerstag, 15:30 Uhr",
    "Nach Absprache": "Dienstag, 15:00 Uhr",
  };
  const slot = slots[request.time] || slots[defaults.time];
  const spoken = slot
    .replace(":00 Uhr", " Uhr")
    .replace("15 Uhr", "fünfzehn Uhr")
    .replace("16 Uhr", "sechzehn Uhr")
    .replace("15:30 Uhr", "fünfzehn Uhr dreißig");
  const example = speechFields.every((key) => request[key] === defaults[key]);
  return {
    proposed_time: slot,
    turns: [
      {
        speaker: "Assistent",
        text: example
          ? "Servus! Hier ist der Assistent von Radlretter Tom. Du hast einen platten Reifen an deinem Lastenrad gemeldet. Dein Fahrrad steht am Marktplatz in Innsbruck. Du möchtest heute Hilfe bekommen. Tom kann am Dienstag um fünfzehn Uhr zu dir kommen. Passt das für dich?"
          : `Servus! Hier ist der Assistent von Radlretter Tom. Du hast ein ${request.bike} mit dem Problem ${request.issue} gemeldet. Dein Fahrrad steht bei ${request.location}. Dein Zeitwunsch ist: ${request.time}. Tom kann am ${spoken} zu dir kommen. Passt das für dich?`,
      },
      { speaker: "Kundin", text: "Ja, das passt." },
      {
        speaker: "Assistent",
        text: example
          ? "Danke! Dann kommt Tom am Dienstag um fünfzehn Uhr zu deinem Lastenrad am Marktplatz in Innsbruck. Du bekommst eine Terminbestätigung per SMS. Eine Stunde vorher erinnere ich dich noch einmal. Bis bald!"
          : `Danke! Dann kommt Tom am ${spoken} zu deinem Fahrrad bei ${request.location}. Du bekommst eine Terminbestätigung per SMS. Eine Stunde vorher erinnere ich dich noch einmal. Bis bald!`,
      },
    ],
  };
}
function transcript(plan) {
  return plan.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n\n");
}
function prepareCallback(request) {
  const payload = Object.fromEntries(
    speechFields.map((key) => [key, request[key]]),
  );
  const fingerprint = JSON.stringify(payload);
  const cached = speechCache.get(fingerprint);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    const fallback = dialoguePlan(request);
    if (staticSpeech) {
      const example = speechFields.every(
        (key) => request[key] === defaults[key],
      );
      return example
        ? {
            ...fallback,
            audio_url: "assets/callback-dialogue.mp3",
            source: "recorded-example",
          }
        : {
            ...fallback,
            error:
              "Deine Angaben stehen im Gespräch zum Mitlesen. Das Hörbeispiel nutzt den voreingestellten Auftrag.",
          };
    }
    try {
      const response = await fetch("/api/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: fingerprint,
        signal: AbortSignal.timeout(70000),
      });
      const result = await response.json();
      return result.turns
        ? result
        : {
            ...fallback,
            error:
              result.error ||
              "Die Vertonung ist gerade nicht verfügbar. Mitlesen bleibt möglich.",
          };
    } catch {
      return {
        ...fallback,
        error:
          "Die Vertonung ist gerade nicht erreichbar. Mitlesen bleibt möglich.",
      };
    }
  })();
  // Match the server's short-lived cache; no browser storage, no retry loop.
  if (speechCache.size >= 24)
    speechCache.delete(speechCache.keys().next().value);
  speechCache.set(fingerprint, { promise, expires: Date.now() + 840000 });
  return promise;
}
const money = (value) =>
  new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(
    value,
  );
function text(selector, value) {
  $(selector).textContent = value;
}
function visible(selector, yes) {
  $(selector).hidden = !yes;
}
function status(value) {
  text("#demo-status", value);
}
function focusAt(selector) {
  const el = $(selector);
  el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  el.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "center",
  });
}
function stopAudio() {
  audio.pause();
  audio.currentTime = 0;
  text("#play-callback", "▶ Rückruf anhören");
  text("#audio-status", "");
}
function reset() {
  generation++;
  geoAttempt++;
  speechCache.clear();
  stopAudio();
  if (photoURL) URL.revokeObjectURL(photoURL);
  photoURL = null;
  state = {
    phase: "idle",
    channel: "website",
    step: 1,
    request: null,
    coords: null,
    photo: null,
    slots: [],
    selectedSlot: null,
    action: null,
    amount: null,
  };
  $("#request-form").reset();
  $("#offer-form").reset();
  $("#amount-form").reset();
  for (const key of ["bike", "issue", "location", "time", "phone"])
    $(`#${key}-input`).value = defaults[key];
  visible("#personal-home", true);
  visible("#intake", false);
  visible("#intake-receipt", false);
  visible("#photo-preview", false);
  visible("#summary-photo", false);
  $("#photo-preview").removeAttribute("src");
  $("#summary-photo").removeAttribute("src");
  text("#photo-status", "");
  text("#geo-status", "");
  text("#location-map", "");
  text("#summary-map", "");
  $("#geolocate").disabled = false;
  text("#summary-title", `${defaults.bike} · ${defaults.issue}`);
  text("#summary-location", defaults.location);
  text("#summary-time", defaults.time);
  text("#summary-phone", defaults.phone);
  text("#source-label", "Website");
  text("#order-status", "Reparaturanfrage");
  text("#summary-photo-text", "Kein Foto ergänzt");
  $$(".operator-actions button").forEach((button) => (button.disabled = false));
  resetProgress();
  setChannel("website");
  showStep(1);
  status("bereit");
}
function showStep(step) {
  state.step = step;
  $$(".form-step").forEach(
    (el) => (el.hidden = Number(el.dataset.step) !== step),
  );
  $$(".form-progress span").forEach((el, index) =>
    el.classList.toggle("active", index < step),
  );
}
// A new decision replaces the previous outcome without erasing the chosen request.
function resetProgress() {
  generation++;
  stopAudio();
  readyConversation = false;
  playbackGeneration = null;
  state.proposedTime = dialoguePlan(state.request || defaults).proposed_time;
  $("#play-callback").disabled = false;
  state.slots = [];
  state.selectedSlot = null;
  state.action = null;
  state.amount = null;
  $("#offer-form").reset();
  $("#amount-form").reset();
  text("#operator-result", "");
  text("#offer-error", "");
  visible("#offer-form", false);
  visible("#to-callback", false);
  visible("#callback-idle", true);
  visible("#callback-live", false);
  visible("#voice-player", true);
  $("#voice-player details").hidden = true;
  $("#voice-player details").open = false;
  audio.src = "assets/callback-dialogue.mp3";
  text(
    "#voice-description",
    "Beispielrückruf · KI-generierte Stimme von ElevenLabs. Nach Toms Entscheidung hörst du hier die passende Rückmeldung.",
  );
  text("#voice-transcript", transcript(dialoguePlan(defaults)));
  visible("#confirm-visit", false);
  visible("#personal-call", false);
  visible("#choose-slot", false);
  $("#slot-options").replaceChildren();
  text("#slot-error", "");
  text("#callback-transcript", "");
  text("#callback-title", "Dein Assistent ruft zurück");
  text("#callback-number", defaults.phone);
  $("#callback-avatar use").setAttribute("href", "#helper");
  $(".calendar-booking").classList.remove("is-booked");
  text("#calendar-title", "Erst die Zusage. Dann der Termin.");
  text("#calendar-detail", "Vorgeschlagene Zeiten sind noch keine Buchung.");
  text("#repair-place", "⌖ Am Standort der Kundin");
  text("#repair-status", "Sobald der Termin steht, kann Tom loslegen.");
  $("#finish-repair").disabled = true;
  $("#amount-input").disabled = true;
  $("#confirm-amount").disabled = true;
  visible("#amount-form", false);
  visible("#checkout", false);
  visible("#paid", false);
  text(
    "#payment-intro",
    "Nach der Reparatur bestätigt Tom den tatsächlichen Betrag. Dann kann die Kundin bezahlen.",
  );
  text("#completion-symbol", "↗");
  text("#completion-title", "Ein Auftrag. Ein guter Abschluss.");
  text(
    "#completion-detail",
    "Von der ersten Anfrage bis zum erledigten Auftrag: ein gemeinsamer Ablauf, den du in der Hand behältst.",
  );
}
function setChannel(channel) {
  state.channel = channel;
  $$("[data-channel]").forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.channel === channel),
    ),
  );
  visible("#web-intake", channel === "website");
  visible("#phone-intake", channel === "phone");
}
$("#open-request").addEventListener("click", () => {
  visible("#personal-home", false);
  visible("#intake", true);
  $("#bike-input").focus({ preventScroll: true });
  $("#intake").scrollIntoView({ block: "nearest" });
});
$$("[data-channel]").forEach((button) =>
  button.addEventListener("click", () => setChannel(button.dataset.channel)),
);
$$("[data-next]").forEach((button) =>
  button.addEventListener("click", () => {
    const step = Number(button.dataset.next);
    if (step === 3 && !$("#location-input").reportValidity()) return;
    showStep(step);
    $(`[data-step="${step}"]`)
      .querySelector("select,input")
      .focus({ preventScroll: true });
  }),
);
$("#photo-input").addEventListener("change", () => {
  if (photoURL) URL.revokeObjectURL(photoURL);
  photoURL = null;
  state.photo = null;
  visible("#photo-preview", false);
  const file = $("#photo-input").files[0];
  if (!file) {
    text("#photo-status", "Kein Foto gewählt.");
    return;
  }
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  ) {
    $("#photo-input").value = "";
    text("#photo-status", "Bitte ein JPG, PNG oder WebP bis 5 MB wählen.");
    return;
  }
  photoURL = URL.createObjectURL(file);
  state.photo = photoURL;
  $("#photo-preview").src = photoURL;
  visible("#photo-preview", true);
  text("#photo-status", "Foto ergänzt.");
});
function makeMap(container, coords) {
  const map = document.createElement("div");
  map.className = "mini-map";
  map.setAttribute("role", "img");
  map.setAttribute(
    "aria-label",
    "Schematische Standortkarte mit Marker, keine Straßenkarte",
  );
  for (const name of [
    "map-river",
    "map-road",
    "map-road two",
    "map-road three",
    "map-marker",
  ]) {
    const part = document.createElement("span");
    part.className = name;
    map.append(part);
  }
  const label = document.createElement("span");
  label.className = "map-label";
  label.textContent = "Schematischer Ausschnitt · keine Navigation";
  map.append(label);
  if (coords) {
    const point = document.createElement("span");
    point.className = "map-coords";
    point.textContent = `${coords.lat.toFixed(4)}°, ${coords.lng.toFixed(4)}° · ±${Math.round(coords.accuracy)} m`;
    map.append(point);
  }
  $(container).replaceChildren(map);
}
$("#location-input").addEventListener("input", () => {
  state.coords = null;
  geoAttempt++;
  $("#geolocate").disabled = false;
  text("#location-map", "");
  text("#geo-status", "Manuell eingegebener Ort wird verwendet.");
});
$("#geolocate").addEventListener("click", () => {
  const epoch = generation;
  const attempt = ++geoAttempt;
  const fallback = () => {
    if (epoch !== generation || attempt !== geoAttempt) return;
    $("#geolocate").disabled = false;
    state.coords = null;
    text("#location-map", "");
    text("#geo-status", "Kein Problem – gib den Ort einfach ein.");
  };
  if (!window.isSecureContext) {
    fallback();
    text(
      "#geo-status",
      "Safari benötigt HTTPS oder eine lokale Adresse. Öffne die lokale Vorschau; hier kannst du den Ort eingeben.",
    );
    return;
  }
  if (!navigator.geolocation) {
    fallback();
    return;
  }
  $("#geolocate").disabled = true;
  text("#geo-status", "Browserfreigabe abwarten …");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (epoch !== generation || attempt !== geoAttempt) return;
      $("#geolocate").disabled = false;
      const { latitude, longitude, accuracy } = position.coords;
      state.coords = { lat: latitude, lng: longitude, accuracy };
      $("#location-input").value = "Aktueller Standort";
      text(
        "#geo-status",
        accuracy > 1000
          ? "Standort übernommen, aber ungenau. Du kannst den Ort manuell korrigieren."
          : "Standort übernommen.",
      );
      makeMap("#location-map", state.coords);
    },
    fallback,
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
  );
});
function submitRequest(request, channel) {
  resetProgress();
  geoAttempt++;
  $("#geolocate").disabled = false;
  stopAudio();
  visible("#voice-player", false);
  state.phase = "requested";
  state.channel = channel;
  state.request = Object.freeze({ ...request });
  if (channel === "phone") {
    state.coords = null;
    state.photo = null;
  }
  text("#summary-title", `${request.bike} · ${request.issue}`);
  text("#summary-location", request.location);
  text("#summary-time", request.time);
  text("#summary-phone", request.phone);
  text("#source-label", channel === "phone" ? "Telefon" : "Website");
  text("#order-status", "Neue Anfrage");
  text(
    "#summary-photo-text",
    state.photo ? "Foto ergänzt" : "Kein Foto ergänzt",
  );
  if (state.coords) makeMap("#summary-map", state.coords);
  else text("#summary-map", "");
  visible("#summary-photo", Boolean(state.photo));
  if (state.photo) {
    $("#summary-photo").src = state.photo;
    visible("#summary-photo", true);
  }
  visible("#personal-home", false);
  visible("#intake", false);
  visible("#intake-receipt", true);
  $$(".operator-actions button").forEach((button) => (button.disabled = false));
  status("Anfrage bei Tom");
  prepareCallback(state.request);
  focusAt("#entscheidung");
}
$("#request-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const request = Object.fromEntries(
    ["bike", "issue", "location", "time", "phone"].map((key) => [
      key,
      $(`#${key}-input`).value.trim(),
    ]),
  );
  if (!request.location) {
    showStep(2);
    $("#location-input").reportValidity();
    return;
  }
  submitRequest(request, "website");
});
$("#send-phone").addEventListener("click", () =>
  submitRequest(defaults, "phone"),
);
function displayCallback() {
  visible("#callback-idle", false);
  visible("#callback-live", true);
  visible(".call-identity", state.action === "personal");
  visible("#callback-transcript", state.action === "personal");
  visible("#to-callback", true);
  text("#callback-number", state.request.phone);
  text("#repair-place", `⌖ ${state.request.location}`);
}
async function setupVoice() {
  visible("#voice-player", true);
  if (state.action === "assistant") {
    const epoch = generation;
    const plan = dialoguePlan(state.request);
    state.proposedTime = plan.proposed_time;
    text("#voice-transcript", transcript(plan));
    $("#play-callback").disabled = true;
    audio.removeAttribute("src");
    audio.load();
    text("#play-callback", "Rückruf wird vorbereitet …");
    const result = await prepareCallback(state.request);
    if (epoch !== generation || state.action !== "assistant") return;
    state.proposedTime = result.proposed_time;
    text("#voice-transcript", transcript(result));
    if (result.audio_url) {
      audio.src = result.audio_url;
      readyConversation = true;
      $("#play-callback").disabled = false;
      text("#play-callback", "▶ Rückruf anhören");
      text("#audio-status", "");
    } else {
      text("#play-callback", "Rückruf noch nicht verfügbar");
      text("#audio-status", result.error);
      $("#voice-player details").hidden = false;
      $("#voice-player details").open = true;
    }
    return;
  }
  const variant = state.action === "schedule" ? "schedule" : "rejected";
  const transcripts = {
    schedule:
      "Servus! Hier ist der Assistent von Radlretter Tom. Tom kann dir helfen und hat dir andere Termine vorgeschlagen. Such dir bitte eine der angebotenen Zeiten aus. Erst wenn du deine Auswahl bestätigst, ist der Termin gebucht.",
    rejected:
      "Servus! Hier ist der Assistent von Radlretter Tom. Leider kann Tom deine Reparaturanfrage nicht übernehmen. Es wurde kein Termin gebucht. Bitte wende dich an einen anderen passenden Fahrradservice.",
  };
  audio.src = `assets/callback-${variant}.mp3`;
  text(
    "#voice-description",
    "KI-generierte Stimme · Chris Roberts, ElevenLabs. Vorproduzierter Demo-Rückruf. Deine individuellen Angaben stehen darüber.",
  );
  text("#voice-transcript", `„${transcripts[variant]}“`);
  visible("#voice-player", true);
}

$$("[data-action]").forEach((button) =>
  button.addEventListener("click", () => {
    // Scrolling straight to Tom's phone is a valid way to start the demo.
    if (!state.request) state.request = Object.freeze({ ...defaults });
    resetProgress();
    stopAudio();
    visible("#voice-player", false);
    state.action = button.dataset.action;
    if (state.action === "schedule") {
      state.phase = "offering";
      visible("#offer-form", true);
      text(
        "#operator-result",
        "Tom bietet andere Zeiten an. Noch kein Termin gebucht.",
      );
      status("Termine vorbereiten");
      $("#offer-form input").focus();
      return;
    }
    displayCallback();
    if (state.action === "reject") {
      state.phase = "rejected";
      text("#order-status", "Anfrage abgelehnt");
      text(
        "#operator-result",
        "Tom kann diese Anfrage nicht übernehmen. Der Assistent meldet das per Rückruf.",
      );
      text("#callback-title", "Dein Assistent ruft zurück");
      text(
        "#callback-transcript",
        `Tom kann „${state.request.issue}“ bei deinem ${state.request.bike} leider nicht übernehmen. Es wurde kein Termin gebucht. Bitte wende dich an einen anderen passenden Betrieb.`,
      );
      setupVoice();
      text("#calendar-title", "Kein Termin gebucht");
      text("#calendar-detail", "Die Anfrage wurde abgelehnt.");
      text("#completion-title", "Eine klare Absage.");
      text(
        "#completion-detail",
        "Auch wenn ein Auftrag nicht passt, weiß die Kundin Bescheid. Starte neu, um einen anderen Weg auszuprobieren.",
      );
      status("abgelehnt");
    } else {
      state.phase = "awaiting-confirmation";
      text("#order-status", "Von Tom angenommen");
      const personal = state.action === "personal";
      text(
        "#operator-result",
        personal
          ? "Tom übernimmt den Rückruf persönlich."
          : "Der Assistent übermittelt Toms Zusage.",
      );
      text(
        "#callback-title",
        personal ? "Tom ruft an" : "Dein Assistent ruft zurück",
      );
      $("#callback-avatar use").setAttribute(
        "href",
        personal ? "#tom" : "#helper",
      );
      text(
        "#callback-transcript",
        personal
          ? `Tom möchte deinen ${state.request.bike} persönlich besprechen: ${state.request.issue}. Die Anfrage ist angenommen. Im Gespräch vereinbart ihr den Einsatz bei ${state.request.location} · ${state.request.time}.`
          : `Gute Nachricht: Tom übernimmt „${state.request.issue}“ bei deinem ${state.request.bike}. Standort: ${state.request.location}. Zeit: ${state.request.time}. Bestätige diese Angaben, damit der Termin steht.`,
      );
      if (personal) visible("#personal-call", true);
      else {
        setupVoice();
        visible("#confirm-visit", true);
      }
      text("#calendar-title", "Zusage von Tom");
      text(
        "#calendar-detail",
        personal
          ? "Im persönlichen Rückruf stimmt ihr Ort und Zeitpunkt ab."
          : `${state.proposedTime} · ${state.request.location}`,
      );
      status("Rückruf bereit");
    }
    focusAt("#rueckruf");
  }),
);
$("#offer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.phase !== "offering") return;
  const slots = [...$("#offer-form").querySelectorAll("input:checked")].map(
    (input) => input.value,
  );
  if (!slots.length) {
    text("#offer-error", "Bitte mindestens eine Zeit anbieten.");
    return;
  }
  state.slots = slots;
  state.phase = "choosing";
  visible("#offer-form", false);
  displayCallback();
  setupVoice();
  text("#order-status", "Termine angeboten");
  text(
    "#operator-result",
    "Der Assistent bietet Toms ausgewählte Zeiten im Rückruf an. Noch nichts gebucht.",
  );
  text("#callback-title", "Dein Assistent ruft zurück");
  text(
    "#callback-transcript",
    `Tom kann bei „${state.request.issue}“ helfen. Für deinen ${state.request.bike} bei ${state.request.location} bietet er an: ${slots.join(" oder ")}. Welche Zeit passt dir?`,
  );
  const options = $("#slot-options");
  options.replaceChildren();
  slots.forEach((slot, index) => {
    const label = document.createElement("label");
    label.className = "slot-label";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "slot";
    input.value = slot;
    input.required = true;
    label.append(input, document.createTextNode(slot));
    options.append(label);
  });
  visible("#choose-slot", true);
  text("#calendar-title", "Termine vorgeschlagen");
  text(
    "#calendar-detail",
    "Noch nicht gebucht. Die Kundin wählt und bestätigt.",
  );
  status("Kundenauswahl offen");
  focusAt("#rueckruf");
});
$("#choose-slot").addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.phase !== "choosing") return;
  const slot = $("#slot-options input:checked");
  if (!slot) {
    text("#slot-error", "Bitte eine Zeit auswählen.");
    return;
  }
  state.selectedSlot = slot.value;
  visible("#choose-slot", false);
  book(slot.value);
});
function book(time) {
  state.phase = "booked";
  state.selectedSlot = time;
  visible("#personal-call", false);
  visible("#confirm-visit", false);
  $(".calendar-booking").classList.add("is-booked");
  text("#calendar-title", "Termin gebucht ✓");
  text(
    "#calendar-detail",
    `${time} · ${state.request.location} · ${state.request.bike}`,
  );
  text("#order-status", "Termin bestätigt");
  text("#operator-result", `Gebucht: ${time}.`);
  text(
    "#callback-transcript",
    `Vereinbart: ${time} bei ${state.request.location}. Tom kommt zu deinem ${state.request.bike} und kümmert sich um „${state.request.issue}“.`,
  );
  text(
    "#repair-status",
    `Termin steht: ${time}. Tom repariert vor Ort bei ${state.request.location}.`,
  );
  $("#finish-repair").disabled = false;
  status("Termin steht");
  focusAt("#reparatur");
}
$("#answer-call").addEventListener("click", () => {
  if (state.phase === "awaiting-confirmation") book(state.request.time);
});
$("#play-callback").addEventListener("click", async () => {
  if (!audio.paused) {
    audio.pause();
    return;
  }
  const epoch = generation;
  try {
    $("#voice-player details").hidden = false;
    playbackGeneration = epoch;
    await audio.play();
    if (epoch !== generation) audio.pause();
  } catch {
    if (epoch === generation)
      text(
        "#audio-status",
        "Der Clip konnte nicht starten. Das Transkript bleibt verfügbar.",
      );
  }
});
audio.addEventListener("play", () => {
  text("#play-callback", "Ⅱ Rückruf pausieren");
  text("#audio-status", "");
});
audio.addEventListener("pause", () =>
  text(
    "#play-callback",
    audio.ended ? "↺ Rückruf erneut anhören" : "▶ Rückruf anhören",
  ),
);
audio.addEventListener("ended", () => {
  text("#play-callback", "↺ Rückruf erneut anhören");
  text("#audio-status", "Gespräch beendet.");
  if (
    readyConversation &&
    playbackGeneration === generation &&
    state.action === "assistant" &&
    state.phase === "awaiting-confirmation"
  ) {
    book(state.proposedTime);
  }
});
audio.addEventListener("error", () =>
  text(
    "#audio-status",
    "Sprachclip nicht verfügbar. Lies die Rückmeldung im Transkript.",
  ),
);
$("#finish-repair").addEventListener("click", () => {
  if (state.phase !== "booked") return;
  state.phase = "repaired";
  $("#finish-repair").disabled = true;
  text(
    "#repair-status",
    "Reparatur fertig. Tom bestätigt jetzt den tatsächlichen Betrag.",
  );
  text("#order-status", "Repariert · Betrag offen");
  $("#amount-input").disabled = false;
  $("#confirm-amount").disabled = false;
  visible("#amount-form", true);
  status("repariert");
  focusAt("#amount-form");
});
$("#amount-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.phase !== "repaired") return;
  state.amount = Number($("#amount-input").value);
  state.phase = "payment-ready";
  visible("#amount-form", false);
  visible("#checkout", true);
  text("#checkout-amount", `${money(state.amount)} · von Tom bestätigt`);
  text(
    "#payment-intro",
    "Die Kundin sieht den bestätigten Betrag und kann bezahlen.",
  );
  text("#order-status", "Zahlung offen");
  status("Betrag bestätigt");
  focusAt("#checkout");
});
$("#pay").addEventListener("click", () => {
  if (state.phase !== "payment-ready") return;
  state.phase = "done";
  visible("#checkout", false);
  visible("#paid", true);
  text(
    "#payment-intro",
    "Tom hat den Betrag bestätigt. Die Zahlung ist abgeschlossen.",
  );
  text("#paid-amount", `${money(state.amount)} · Beleg`);
  text("#order-status", "Erledigt ✓");
  text(
    "#operator-result",
    `Repariert und ${money(state.amount)} bezahlt. Auftrag erledigt.`,
  );
  text("#completion-symbol", "✓");
  text("#completion-title", "Auftrag erledigt.");
  text(
    "#completion-detail",
    `${state.request.bike} · ${state.request.issue} · ${state.request.location}. Vom Erstkontakt bis zur Zahlung abgeschlossen.`,
  );
  status("Auftrag erledigt");
  focusAt("#completion-title");
});
$$("[data-reset]").forEach((button) =>
  button.addEventListener("click", () => {
    reset();
    focusAt("#demo");
  }),
);
$("#contact-button").addEventListener("click", () => {
  const title = document.createElement("h3");
  title.id = "dialog-title";
  title.textContent = "Was hast du vor?";
  const p = document.createElement("p");
  p.textContent =
    "Ein Auftritt, der zu dir passt. Ein Alltag, in dem du Zeit fürs Fahrrad hast.";
  const options = document.createElement("div");
  options.className = "contact-options";
  for (const label of [
    "Ich möchte meinen eigenen Service starten →",
    "Ich habe schon einen Fahrradservice →",
  ]) {
    const link = document.createElement("a");
    link.href = "#paket";
    link.textContent = label;
    link.addEventListener("click", () => dialog.close());
    options.append(link);
  }
  $("#dialog-content").replaceChildren(title, p, options);
  dialog.showModal();
});
const dialog = $("#info-dialog");
$$("[data-dialog]").forEach((button) =>
  button.addEventListener("click", () => {
    const isDemo = button.dataset.dialog === "demo";
    const title = document.createElement("h3");
    title.id = "dialog-title";
    title.textContent = isDemo
      ? "Eine Demo, ganz in deiner Hand."
      : "Anbieterangaben";
    const p = document.createElement("p");
    p.textContent = isDemo
      ? staticSpeech
        ? "Bitte ausschließlich Beispieldaten verwenden. Formulareingaben, Fotos und Standort bleiben im flüchtigen Zustand dieser Seite. Es gibt keine Formularübertragung, echten Anrufe, Nachrichten, Kalendereinträge oder Zahlungen. Das Hörbeispiel ist eine fertige Sprachaufnahme. Neustart und Neuladen verwerfen die Eingaben."
        : "Bitte ausschließlich Beispieldaten verwenden. Fahrrad, Problem, Ort und Zeitwunsch gehen zur Sprachvorbereitung an diesen Server und bei verbundener Vertonung an ElevenLabs. Telefonnummer, Fotos und Standortkoordinaten werden nicht weitergegeben. Der Server hält die Sprachdatei höchstens 15 Minuten im Arbeitsspeicher. Für die Verarbeitung bei ElevenLabs gelten deren Datenschutzbedingungen. Es gibt keine echten Anrufe, Nachrichten, Kalendereinträge oder Zahlungen. Neustart verwirft den Seitenzustand; bereits übermittelte Angaben lassen sich damit nicht zurückholen."
      : "Anbietername, Anschrift und Kontakt sind noch zu ergänzen. Diese Vorschau enthält keine erfundenen Unternehmensdaten und ist noch kein öffentliches Leistungsangebot.";
    $("#dialog-content").replaceChildren(title, p);
    dialog.showModal();
  }),
);
$(".dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
function drawThread() {
  const story = $("#story");
  const bounds = story.getBoundingClientRect();
  const mobile = innerWidth <= 700;
  const anchors = $$("[data-thread]").map((el) => {
    const b = el.getBoundingClientRect();
    const dot = getComputedStyle(el, "::before");
    const row = el.closest(".story-row");
    const r = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    return {
      x:
        b.left - bounds.left + parseFloat(dot.left) + parseFloat(dot.width) / 2,
      y: b.top - bounds.top + b.height / 2,
      row,
      contentTop: r.top - bounds.top + parseFloat(style.paddingTop),
      contentBottom: r.bottom - bounds.top - parseFloat(style.paddingBottom),
    };
  });
  if (!anchors.length) return;
  // One radius for every turn; leave air below the phones before curving.
  const crossing = Math.abs(anchors[2].x - anchors[1].x);
  const radius = Math.min(180, Math.round(crossing * 0.35));
  const spacing = mobile ? "60px" : `${radius * 2 + 64}px`;
  if (story.style.getPropertyValue("--chapter-turn-space") !== spacing) {
    story.style.setProperty("--chapter-turn-space", spacing);
    // Redraw after layout, including mobile where only the CSS variable changes.
    requestAnimationFrame(drawThread);
    return;
  }
  let d = `M ${anchors[0].x} ${anchors[0].y}`;
  anchors.slice(1).forEach((point, index) => {
    const prev = anchors[index];
    if (mobile || Math.abs(prev.x - point.x) < 1) {
      d += ` L ${point.x} ${point.y}`;
      return;
    }
    const direction = Math.sign(point.x - prev.x);
    const startY = prev.contentBottom + 28;
    const turnY = startY + radius;
    d += ` L ${prev.x} ${startY}`;
    d += ` A ${radius} ${radius} 0 0 ${direction > 0 ? 0 : 1} ${prev.x + direction * radius} ${turnY}`;
    d += ` L ${point.x - direction * radius} ${turnY}`;
    d += ` A ${radius} ${radius} 0 0 ${direction > 0 ? 1 : 0} ${point.x} ${turnY + radius}`;
    d += ` L ${point.x} ${point.y}`;
  });
  $("#thread-path").setAttribute("d", d);
}
// Dialogue, transcript and booking use the same proposed slot.
$(".callback-card").append($("#voice-player"));
const details = $("#voice-player details");
const description = details.querySelector("p");
description.id = "voice-description";
details.querySelector("p:last-child").id = "voice-transcript";
const confirmVisit = document.createElement("button");
confirmVisit.type = "button";
confirmVisit.id = "confirm-visit";
confirmVisit.className = "button secondary";
confirmVisit.textContent = "Ja, das passt · Termin bestätigen ✓";
confirmVisit.hidden = true;
$("#voice-player").after(confirmVisit);
// A text alternative also lets visitors confirm without listening.
confirmVisit.addEventListener("click", () => {
  if (state.phase === "awaiting-confirmation") book(state.proposedTime);
});
$("#story").prepend($(".demo-toolbar"));
reset();
new ResizeObserver(drawThread).observe($("#story"));
document.fonts.ready.then(drawThread);
window.addEventListener("resize", drawThread);
