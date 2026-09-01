/// <reference lib="webworker" />

import { transformObservedHaze } from './haze-core';

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const result = await transformObservedHaze(event.data.file, (progress) => {
      self.postMessage({ type: 'progress', progress });
    });
    self.postMessage({ type: 'success', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Falha desconhecida.',
    });
  }
};

export {};
