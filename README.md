# Voice Relay

A mobile-first, on-device push-to-talk microphone for Web Audio-capable browsers. The app captures the device microphone with `getUserMedia()`, sends it through a muted-by-default Web Audio `GainNode`, and plays it through the operating system's current media output.

No audio is uploaded, recorded, stored, or sent through WebRTC. There is no backend and no Web Bluetooth usage.

## Browser and Bluetooth support

The web APIs used here are supported by current Web Audio-capable browsers. The part a website cannot guarantee is the operating system's audio route: opening the microphone may change the selected output or Bluetooth profile. A Bluetooth disconnect can also move output to the device speaker without a reliable browser event.

Test your exact device, browser, and speaker combination at low speaker volume with some physical separation. If the operating system will not keep the speaker as the live microphone monitor, JavaScript cannot force it; a native app may be required.

## Run locally

```bash
pnpm install
pnpm dev
```

`http://localhost:5173` works on the development computer, but `http://192.168.x.x:5173` on another device is normally not a secure context and cannot use the microphone.

### Test on a physical device over HTTPS

Use one of these approaches:

1. Deploy `pnpm build` output from `dist/` to any static HTTPS host.
2. Put an HTTPS tunnel in front of the Vite development server and open its HTTPS URL on the test device.
3. Use a locally trusted development certificate and serve Vite with HTTPS. The certificate authority must be trusted by the test device; a certificate warning is not enough.

Do not expose a development server or tunnel containing private files. This project only serves its static app files through Vite.

## Hardware validation

Before testing, pair the speaker in your device settings and make it the active media output. Keep the page visible and the screen unlocked.

- [ ] Tap **Enable Microphone** and grant permission.
- [ ] Confirm silence while the app says **Ready · output muted**.
- [ ] Hold **Hold to talk** and verify live voice reaches the intended speaker.
- [ ] Release over and outside the button; both must mute promptly, allowing for buffered Bluetooth audio.
- [ ] Verify pointer cancellation, switching apps, locking/backgrounding, and browser focus loss all stop output.
- [ ] Focus the PTT button and verify Space press/release works.
- [ ] Try rapid press/release cycles and confirm output never remains open.
- [ ] Tap **Stop & release microphone** and confirm the browser's capture indicator clears.
- [ ] Repeat Enable → Stop → Enable.
- [ ] Disconnect Bluetooth while muted and while talking. Expect the system may redirect audio to the device speaker.
- [ ] Interrupt with a call or notification and confirm the app returns muted or reports an audio interruption.
- [ ] Repeat in the browsers you intend to support; note browser version, device model, operating-system version, speaker, route changes, profile changes, and perceived delay.

## Production build

```bash
pnpm check
pnpm build
pnpm preview
```

Biome handles formatting and linting. Run `pnpm format` to apply formatting, `pnpm lint` for lint-only validation, or `pnpm check` for Biome plus TypeScript validation.

Deploy `dist/` to a static HTTPS host. No server-side runtime is required.

## Limitations

- The app cannot pair a speaker, select a Bluetooth output, detect Bluetooth status reliably, or prevent the operating system from changing routes.
- Bluetooth buffering adds delay that Web Audio cannot remove.
- Feedback is possible when the device microphone is near the speaker. Start at low volume.
- Background and locked-screen operation are not supported.
- Echo cancellation, noise suppression, auto gain, and the interactive latency hint are browser preferences, not guarantees.

## Optional follow-ups after hardware validation

- Add a quiet test tone to check the current output before microphone capture.
- Add conservative input/output controls capped at unity gain.
- Add explicit echo-cancellation and noise-suppression preferences.
- Add installable PWA assets and offline static caching.
- Add an optional screen wake lock while the app remains visible.
