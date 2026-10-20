import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import type { WebCameraHandle, WebCameraProps } from "./WebCamera";

const QUALITY_HEIGHTS: Record<string, number> = {
  "2160p": 2160,
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
};

// Safari records MP4; Chrome/Firefox record WebM. Prefer MP4 so iPhones can save to Photos.
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

async function deliverRecording(blob: Blob, mimeType: string) {
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = new File([blob], `teleprompter-${stamp}.${ext}`, { type: mimeType });

  // On phones, the share sheet offers "Save Video" to the camera roll
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const WebCamera = forwardRef<WebCameraHandle, WebCameraProps>(function WebCamera(
  { facing, videoQuality, videoBitrate, onError },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    let cancelled = false;
    const height = QUALITY_HEIGHTS[videoQuality] ?? 1080;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing === "front" ? "user" : "environment",
            height: { ideal: height },
          },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (e) {
        onError?.(
          (e as Error).name === "NotAllowedError"
            ? "Allow camera and microphone access in your browser settings to record."
            : "Couldn't start the camera on this device."
        );
      }
    })();

    return () => {
      cancelled = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing, videoQuality, onError]);

  useImperativeHandle(
    ref,
    () => ({
      recordAsync: () =>
        new Promise<void>((resolve, reject) => {
          const stream = streamRef.current;
          const mimeType = pickMimeType();
          if (!stream || !mimeType) {
            reject(new Error("Recording isn't supported in this browser."));
            return;
          }
          const chunks: Blob[] = [];
          const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: videoBitrate });
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          recorder.onstop = async () => {
            recorderRef.current = null;
            if (chunks.length) await deliverRecording(new Blob(chunks, { type: mimeType }), mimeType);
            resolve();
          };
          recorder.onerror = () => reject(new Error("Recording failed."));
          recorderRef.current = recorder;
          recorder.start(1000);
        }),
      stopRecording: () => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      },
    }),
    [videoBitrate]
  );

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: facing === "front" ? "scaleX(-1)" : undefined,
      }}
    />
  );
});
