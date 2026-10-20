# Video Teleprompter

A teleprompter app for iPhone, iPad, Android and the web, built with [Expo](https://expo.dev) and React Native. Write your scripts, then read them while the app records you on camera.

## Features

- **Script library**: create, edit and delete scripts, saved on the device
- **Editor**: `**bold**` markers for emphasis, plus undo
- **Auto-scroll**: adjustable speed and font size, with the current word highlighted
- **Mirror mode** for use with teleprompter glass
- **Record while you read**: front or back camera, saved straight to your photo library
- **Portrait or landscape**, with tablet support

## Getting started

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

Then scan the QR code with the **Expo Go** app on your phone, or press `i` (iOS simulator), `a` (Android emulator) or `w` (web browser).

> Camera recording only works on a real device. On the web you can still write and scroll scripts.

## Scripts

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `npm start`         | Start the Expo dev server             |
| `npm run ios`       | Open in the iOS simulator             |
| `npm run android`   | Open in the Android emulator          |
| `npm run web`       | Open in a web browser                 |
| `npm run typecheck` | Type-check the project with TypeScript |

## Building for the App Store / Play Store

Use [EAS Build](https://docs.expo.dev/build/introduction/):

```bash
npm install -g eas-cli
eas build --platform ios
```

## Project structure

```
app/          Screens (Expo Router): index (script list), edit, play
components/   Shared UI and error handling
contexts/     ScriptsContext: script storage via AsyncStorage
constants/    Theme colors
hooks/        useColors
assets/       App icon
```

## License

MIT, see [LICENSE](LICENSE).
