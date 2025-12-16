declare module "tesseract.js" {
  export type RecognizeReturn = {
    data?: {
      text?: string;
      confidence?: number | string;
    };
  };

  export type Worker = {
    load: () => Promise<void>;
    loadLanguage: (lang: string) => Promise<void>;
    initialize: (lang: string) => Promise<void>;
    recognize: (image: string) => Promise<RecognizeReturn>;
    terminate: () => Promise<void>;
  };

  export function createWorker(): Promise<Worker> | Worker;
}
