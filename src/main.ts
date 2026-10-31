import "./style.css";
import { AudioEngine, AudioEngineError } from "./audioEngine";

type AppState = "idle" | "requesting" | "ready" | "talking" | "error";
type HoldOwner = "pointer" | "keyboard" | null;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) throw new Error("App container is missing.");

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <div class="brand-mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>
      <div>
        <p class="eyebrow">Private push-to-talk</p>
        <h1>Voice<br />Relay</h1>
      </div>
    </header>

    <section class="setup-note" aria-label="Setup instructions">
      <span class="step-number" aria-hidden="true">1</span>
      <p><strong>Connect your speaker first.</strong> Pair it in your device settings and select it as the active media output.</p>
    </section>

    <section class="control-card" data-state="idle">
      <div class="status-row" aria-live="polite" aria-atomic="true">
        <span class="status-light" aria-hidden="true"></span>
        <div>
          <p class="status-label" id="status-label">Microphone off</p>
          <p class="status-detail" id="status-detail">Enable access when you are ready.</p>
        </div>
      </div>

      <div class="error-message" id="error-message" role="alert" hidden></div>

      <button class="enable-button" id="enable-button" type="button">
        <span class="button-icon" aria-hidden="true">●</span>
        <span>Enable Microphone</span>
      </button>

      <button
        class="ptt-button"
        id="ptt-button"
        type="button"
        aria-describedby="ptt-hint"
        disabled
      >
        <span class="ptt-rings" aria-hidden="true"></span>
        <span class="ptt-label">Hold to talk</span>
        <span class="ptt-subtitle">Release to mute</span>
      </button>

      <p class="hold-hint" id="ptt-hint">Press and hold, or use Space when this button is focused.</p>

      <button class="stop-button" id="stop-button" type="button" hidden>
        Stop &amp; release microphone
      </button>
    </section>

    <aside class="privacy-note">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4.5 5v6c0 5.2 3.2 9.8 7.5 11 4.3-1.2 7.5-5.8 7.5-11V5L12 2Zm0 3.1 4.5 1.8V11c0 3.7-2 7-4.5 8-2.5-1-4.5-4.3-4.5-8V6.9L12 5.1Z"/></svg>
      <p><strong>Private by design.</strong> Audio stays on this device. While enabled, the microphone remains active even when speaker output is muted. Stop releases it completely.</p>
    </aside>

    <footer class="app-footer">
      <p>Output follows your device's current media route.</p>
      <p>Bluetooth delay is normal. If Bluetooth disconnects, audio may move to the device speaker.</p>
    </footer>
  </main>
`;

const controlCard = getElement<HTMLElement>(".control-card");
const statusLabel = getElement<HTMLElement>("#status-label");
const statusDetail = getElement<HTMLElement>("#status-detail");
const errorMessage = getElement<HTMLElement>("#error-message");
const enableButton = getElement<HTMLButtonElement>("#enable-button");
const pttButton = getElement<HTMLButtonElement>("#ptt-button");
const stopButton = getElement<HTMLButtonElement>("#stop-button");
const enableButtonLabel = getElement<HTMLElement>(
  "#enable-button span:last-child",
);
const pttLabel = getElement<HTMLElement>("#ptt-button .ptt-label");
const pttSubtitle = getElement<HTMLElement>("#ptt-button .ptt-subtitle");

let state: AppState = "idle";
let holdOwner: HoldOwner = null;
let activePointerId: number | null = null;

const engine = new AudioEngine((interruption) => {
  forceMute();

  if (interruption.type === "microphone-ended") {
    void stopSession().then(() => {
      render(
        "error",
        "Microphone access ended. Check your browser and system permissions, then try again.",
      );
    });
    return;
  }

  if (state !== "idle" && state !== "error") {
    render("ready", "Audio was paused by the browser. Hold again to resume.");
  }
});

enableButton.addEventListener("click", () => void enableMicrophone());
stopButton.addEventListener("click", () => void stopSession());

pttButton.addEventListener("pointerdown", (event) => {
  if (
    state !== "ready" ||
    holdOwner !== null ||
    !event.isPrimary ||
    (event.pointerType === "mouse" && event.button !== 0)
  ) {
    return;
  }

  event.preventDefault();
  holdOwner = "pointer";
  activePointerId = event.pointerId;

  try {
    pttButton.setPointerCapture(event.pointerId);
  } catch {
    forceMute();
    return;
  }

  void beginTalking("pointer", event.pointerId);
});

pttButton.addEventListener("pointerup", (event) =>
  endPointerHold(event.pointerId),
);
pttButton.addEventListener("pointercancel", (event) =>
  endPointerHold(event.pointerId),
);
pttButton.addEventListener("lostpointercapture", (event) =>
  endPointerHold(event.pointerId),
);
pttButton.addEventListener("contextmenu", (event) => event.preventDefault());

pttButton.addEventListener("keydown", (event) => {
  if (
    event.code !== "Space" ||
    event.repeat ||
    state !== "ready" ||
    holdOwner !== null
  ) {
    return;
  }

  event.preventDefault();
  holdOwner = "keyboard";
  void beginTalking("keyboard");
});

window.addEventListener("keyup", (event) => {
  if (event.code === "Space" && holdOwner === "keyboard") {
    event.preventDefault();
    forceMute();
  }
});

window.addEventListener("blur", forceMute);
window.addEventListener("pagehide", forceMute);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) forceMute();
});

async function enableMicrophone(): Promise<void> {
  if (state === "requesting" || engine.isActive) return;

  render("requesting");
  try {
    await engine.start();
    if (engine.isActive) render("ready");
  } catch (error) {
    await engine.stop();
    render("error", describeError(error));
  }
}

async function beginTalking(
  owner: Exclude<HoldOwner, null>,
  pointerId?: number,
): Promise<void> {
  try {
    const started = await engine.setTalking(true);
    const stillHeld =
      holdOwner === owner &&
      (owner !== "pointer" || activePointerId === pointerId);

    if (started && stillHeld && state === "ready") {
      render("talking");
    } else if (!stillHeld) {
      engine.forceMute();
    }
  } catch (error) {
    forceMute();
    if (engine.isActive) {
      render("ready", describeError(error));
    } else {
      render("error", describeError(error));
    }
  }
}

function endPointerHold(pointerId: number): void {
  if (holdOwner === "pointer" && activePointerId === pointerId) {
    forceMute();
  }
}

function forceMute(): void {
  holdOwner = null;
  activePointerId = null;
  engine.forceMute();

  if (state === "talking") render("ready");
}

async function stopSession(): Promise<void> {
  forceMute();
  enableButton.disabled = true;
  stopButton.disabled = true;
  await engine.stop();
  render("idle");
}

function render(nextState: AppState, message = ""): void {
  state = nextState;
  controlCard.dataset.state = state;
  errorMessage.hidden = !message;
  errorMessage.textContent = message;

  enableButton.hidden = state === "ready" || state === "talking";
  enableButton.disabled = state === "requesting";
  enableButtonLabel.textContent =
    state === "requesting"
      ? "Requesting access…"
      : state === "error"
        ? "Try Again"
        : "Enable Microphone";

  pttButton.disabled = state !== "ready" && state !== "talking";
  pttButton.hidden =
    state === "idle" || state === "requesting" || state === "error";
  stopButton.hidden =
    state === "idle" || state === "requesting" || state === "error";
  stopButton.disabled = false;

  const copy: Record<AppState, { label: string; detail: string }> = {
    idle: {
      label: "Microphone off",
      detail: "Enable access when you are ready.",
    },
    requesting: {
      label: "Waiting for permission",
      detail: "Choose Allow in your browser's microphone prompt.",
    },
    ready: {
      label: "Ready · output muted",
      detail:
        "The microphone is active; hold the button to send it to your current output.",
    },
    talking: {
      label: "Transmitting",
      detail:
        "Your microphone is playing through your device's current media output.",
    },
    error: {
      label: "Could not start",
      detail: "Review the message below, then try again.",
    },
  };

  statusLabel.textContent = copy[state].label;
  statusDetail.textContent = copy[state].detail;
  pttLabel.textContent = state === "talking" ? "Talking" : "Hold to talk";
  pttSubtitle.textContent =
    state === "talking" ? "Release to mute" : "Press and hold";
  pttButton.setAttribute("aria-pressed", String(state === "talking"));
}

function describeError(error: unknown): string {
  if (error instanceof AudioEngineError) return error.message;

  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone permission was denied. Allow microphone access in your browser or system settings, then try again.";
      case "NotFoundError":
        return "No microphone is available. Check the device's microphone and try again.";
      case "NotReadableError":
      case "AbortError":
        return "The microphone is busy or unavailable. Close other audio apps and try again.";
      case "OverconstrainedError":
        return "The microphone could not use the requested audio preferences. Try again or use a different input.";
      default:
        return `The browser could not start audio (${error.name}). Try reloading the page.`;
    }
  }

  return "The browser could not start audio. Try reloading the page.";
}

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

render("idle");
