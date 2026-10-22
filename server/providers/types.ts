// The shape every speech engine implements. A new engine is a new file in this folder.

export type Voice = { id: string; name: string; gender: 'male' | 'female'; accent: string };

// One sentence of speech: WAV audio plus each word's start and length in ms.
export type Synthesis = { audio: string; words: string[]; wtimes: number[]; wdurations: number[] };

export type ProviderStatus = 'starting' | 'ready' | 'down';

export type SpeechProvider = {
  id: string;
  model: string;
  defaultVoice: string;
  start(): void;
  status(): ProviderStatus;
  voices(): Voice[];
  synthesize(text: string, voice: string): Promise<Synthesis>;
};
