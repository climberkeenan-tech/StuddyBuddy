import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@renderer/lib/api';

/** Outcome of asking for the microphone. */
export type MicStartResult = 'capturing' | 'denied' | 'unavailable' | 'error';

/** Lifecycle of the local microphone capture pipeline. */
export type MicState = 'idle' | 'requesting' | 'capturing' | 'denied' | 'unavailable' | 'error';

/** True when this runtime can actually capture microphone audio. */
function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

/** Pick the best supported webm/opus container, or undefined to let the UA decide. */
function preferredMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

interface AudioContextCtor {
  new (): AudioContext;
}

/**
 * Encapsulates real microphone capture for the recording studio: requests
 * permission, streams webm/opus chunks to the backend every ~2s via
 * `recording.pushAudioChunk`, and samples an {@link AnalyserNode} RMS level
 * ~10×/s via `recording.pushAudioLevel`.
 *
 * In the browser preview and under vitest `getUserMedia`/`MediaRecorder` are
 * absent — {@link useMicCapture.supported} reports `false` and {@link start}
 * resolves to `'unavailable'`, letting the page fall back to demo mode where the
 * mock backend simulates audio levels and transcript segments itself.
 */
export function useMicCapture() {
  const supported = micSupported();
  const [state, setState] = useState<MicState>(supported ? 'idle' : 'unavailable');

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const mimeRef = useRef<string>('audio/webm');
  /** Every webm chunk so far, retained so on-device Whisper can transcribe it. */
  const chunksRef = useRef<Blob[]>([]);

  const teardown = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = null;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* recorder already stopped */
      }
    }
    recorderRef.current = null;
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {});
    }
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const monitorLevels = useCallback((stream: MediaStream) => {
    const Ctor: AudioContextCtor | undefined =
      (typeof window !== 'undefined' &&
        ((window.AudioContext as unknown as AudioContextCtor | undefined) ??
          ((window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext))) ||
      undefined;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let last = 0;

    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - last > 100) {
        last = now;
        const level = Math.max(0, Math.min(1, rms * 2.4));
        void api.recording.pushAudioLevel(level).catch(() => {});
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  /** Request the mic and begin streaming. Resolves with the outcome. */
  const start = useCallback(async (): Promise<MicStartResult> => {
    if (!supported) {
      setState('unavailable');
      return 'unavailable';
    }
    setState('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const denied = name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
      setState(denied ? 'denied' : 'error');
      return denied ? 'denied' : 'error';
    }
    streamRef.current = stream;

    const mime = preferredMimeType();
    mimeRef.current = mime ?? 'audio/webm';
    chunksRef.current = [];
    try {
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (event: BlobEvent) => {
        const blob = event.data;
        if (!blob || blob.size === 0) return;
        // Retain for on-device transcription (concatenated chunks stay a
        // decodable webm stream), and forward to the backend for optional
        // audio persistence.
        chunksRef.current.push(blob);
        void blob
          .arrayBuffer()
          .then((buffer) => api.recording.pushAudioChunk(buffer, blob.type || mimeRef.current))
          .catch(() => {});
      };
      recorder.start(2000);
      recorderRef.current = recorder;
    } catch {
      /* MediaRecorder unavailable for this stream — levels still work below */
    }

    monitorLevels(stream);
    setState('capturing');
    return 'capturing';
  }, [supported, monitorLevels]);

  /** Pause the recorder (keeps the stream + analyser alive). */
  const pause = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      try {
        rec.pause();
      } catch {
        /* not pausable */
      }
    }
  }, []);

  /** Resume a paused recorder. */
  const resume = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'paused') {
      try {
        rec.resume();
      } catch {
        /* not resumable */
      }
    }
  }, []);

  /** A decodable webm Blob of everything captured so far (null if nothing yet). */
  const snapshotBlob = useCallback((): Blob | null => {
    if (chunksRef.current.length === 0) return null;
    return new Blob(chunksRef.current, { type: mimeRef.current });
  }, []);

  /**
   * Stop the recorder, wait for its final chunk, release the device, and return
   * the complete recording as a Blob (null if nothing was captured). Used by the
   * on-device Whisper path to transcribe the full audio on stop.
   */
  const finishRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      const finalize = () => {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: mimeRef.current })
          : null;
        teardown();
        if (supported) setState('idle');
        resolve(blob);
      };
      if (!rec || rec.state === 'inactive') {
        finalize();
        return;
      }
      rec.addEventListener('stop', finalize, { once: true });
      try {
        rec.stop();
      } catch {
        finalize();
      }
    });
  }, [teardown, supported]);

  /** Stop capture and release the microphone. */
  const stop = useCallback(() => {
    teardown();
    if (supported) setState('idle');
  }, [teardown, supported]);

  // Always release the device if the component unmounts mid-recording.
  useEffect(() => () => teardown(), [teardown]);

  return { state, supported, start, pause, resume, stop, snapshotBlob, finishRecording };
}
