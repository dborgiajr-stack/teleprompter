import { forwardRef } from "react";

export interface WebCameraHandle {
  /** Records until stopRecording() is called, then saves or shares the file. */
  recordAsync: () => Promise<void>;
  stopRecording: () => void;
}

export interface WebCameraProps {
  facing: "front" | "back";
  videoQuality: string;
  videoBitrate: number;
  onError?: (message: string) => void;
}

// Native builds use expo-camera; this browser-only camera lives in WebCamera.web.tsx.
export const WebCamera = forwardRef<WebCameraHandle, WebCameraProps>(function WebCamera() {
  return null;
});
