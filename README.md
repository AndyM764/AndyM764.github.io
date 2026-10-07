# CourtVision.V2

CourtVision.V2 is a fresh Expo SDK 54 React Native mobile app for iOS and Android.

## Features

- Mock Raspberry Pi WiFi connection screen with connected/disconnected status and IP address display.
- Tennis launcher sliders for ball speed, launch angle, and ball frequency.
- JSON parameter payload logging through a service layer ready for future Raspberry Pi REST calls.
- Expo Camera video recording with start/stop controls.
- Saves recorded videos to the phone gallery with Expo Media Library.
- Beginner-friendly source layout using `src/screens`, `src/components`, `src/services`, `src/hooks`, and `src/types`.

## Commands

```bash
npm install
npm run start
npm run ios
npm run android
npm run typecheck
```

## Architecture

```text
src/
  screens/      App screens and page-level composition
  components/   Reusable UI components
  services/     Raspberry Pi API/mock service layer
  hooks/        State and side-effect hooks
  types/        Shared TypeScript contracts
```

New Architecture is explicitly disabled in `app.json` for stability.
