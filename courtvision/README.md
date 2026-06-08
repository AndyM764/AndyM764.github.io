# CourtVision Mobile App

CourtVision is a beginner-friendly mobile app for a university tennis research project. Version 1 can simulate a Raspberry Pi Wi-Fi connection, prepare mock tennis ball launch parameters, record videos with the phone camera, save videos locally, and show a list of saved recordings.

## Recommended technology stack

**Best choice for Version 1: Expo + React Native + JavaScript.**

- **Expo** gives you camera access, permissions, local media storage, and easy phone testing with Expo Go.
- **React Native** lets one codebase run on iOS and Android.
- **JavaScript** is approachable for a beginner and avoids the extra learning curve of TypeScript for V1.
- **expo-camera** records phone-camera video.
- **expo-media-library** saves videos to the phone's local photo/video storage and reads them back.
- **@react-native-community/slider** provides mobile slider controls for ball speed, launch angle, and frequency.

This stack is better for a beginner than starting with native Android Kotlin and iOS Swift because you can build the first working research prototype with fewer setup steps.

## Architecture

The app has three simple layers:

1. **User interface layer**
   - Lives mostly in `App.js`.
   - Shows connection status, sliders, buttons, camera preview, and saved recordings.

2. **Device communication layer**
   - Lives in `src/services/raspberryPiClient.js`.
   - Currently simulates Raspberry Pi connection and parameter sending.
   - Later, this file can send real HTTP requests or WebSocket messages over Wi-Fi.

3. **Phone hardware/storage layer**
   - Uses Expo libraries from `App.js`.
   - `expo-camera` controls recording.
   - `expo-media-library` saves and lists videos in a `CourtVision` album.

## Project structure

```text
courtvision/
  App.js
  app.json
  index.js
  package.json
  package-lock.json
  src/
    services/
      raspberryPiClient.js
```

## Major files explained

### `package.json`

Lists the app dependencies and commands.

Important commands:

- `npm start` starts Expo.
- `npm run android` starts Expo and opens Android if available.
- `npm run ios` starts Expo and opens iOS if available on macOS.
- `npm run web` starts the web version, although camera recording is intended for real phones.

### `app.json`

Configures the Expo app.

This file sets:

- App name: `CourtVision`
- App slug: `courtvision`
- Portrait orientation
- iOS camera and photo-library permission messages
- Android camera and media permissions
- Expo plugins for camera and media-library support

### `index.js`

The entry point. It tells React Native to load `App.js`.

You usually do not need to edit this file as a beginner.

### `App.js`

The main screen for Version 1.

It handles:

- Connection status
- Connect Device button
- Ball Speed slider
- Launch Angle slider
- Ball Frequency slider
- Current parameter display
- Send Parameters button
- Camera permission request
- Camera preview
- Start Recording and Stop Recording buttons
- Saving recordings to the local media library
- Loading and displaying saved recordings

### `src/services/raspberryPiClient.js`

The simulated Raspberry Pi communication module.

It exports:

- `connectToRaspberryPi()` for connecting to a simulated device
- `sendBallParameters(parameters)` for preparing a mock payload
- `raspberryPiConfig` for future real connection settings

When you are ready to connect to a real Raspberry Pi, this is the main file to change.

## Step-by-step beginner guide

### 1. Install app dependencies

From the `courtvision` folder:

```bash
npm install
```

### 2. Start the app

```bash
npm start
```

Expo will show a QR code.

### 3. Open on your phone

Install **Expo Go** from the iOS App Store or Google Play Store.

- Make sure your phone and computer are on the same Wi-Fi network.
- Scan the QR code from Expo.
- The app should open on your phone.

### 4. Test the simulated Raspberry Pi connection

Tap **Connect Device**.

For V1, this does not contact real hardware. It waits briefly, then shows a simulated connection to `192.168.4.1`.

### 5. Adjust tennis ball parameters

Move the sliders:

- **Ball Speed** in mph
- **Launch Angle** in degrees
- **Ball Frequency** in balls per minute

The current values update immediately on screen.

### 6. Send mock parameters

Tap **Send Parameters** after connecting.

The app builds a payload like this:

```js
{
  speedMph: 65,
  launchAngleDegrees: 18,
  frequencyBallsPerMinute: 8,
  sentAt: "..."
}
```

For V1, it logs the payload instead of sending it to hardware.

### 7. Record a video

Tap **Request Camera Permission** if the app asks for it.

Then tap **Start Recording**.

Tap **Stop Recording** when finished.

### 8. Save and view recordings

After stopping, the app saves the video to a local album named `CourtVision`.

Saved videos appear under **Saved Recordings**.

## Future Raspberry Pi connection plan

When the Raspberry Pi is ready, run a small server on it, for example:

```text
http://192.168.4.1:5000/api/ball-parameters
```

Then replace the mock code in `src/services/raspberryPiClient.js` with a real `fetch()` request:

```js
await fetch(raspberryPiConfig.futureEndpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(parameters),
});
```

That keeps the rest of the app mostly unchanged.
