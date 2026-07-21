/**
 * Web-preview stub for `@huggingface/transformers`.
 *
 * On-device Whisper is a desktop-only feature (a browser tab uses the in-memory
 * mock backend and never records real audio). The standalone web build aliases
 * the multi-hundred-MB ML library to this stub so the shareable single-file
 * demo stays small — the real worker code is never executed there.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export const env: any = {
  allowLocalModels: false,
  backends: { onnx: { wasm: { numThreads: 1 } } },
};

export function pipeline(): Promise<never> {
  return Promise.reject(new Error('On-device Whisper is not available in the web preview.'));
}
