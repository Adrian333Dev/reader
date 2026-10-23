// The shape every speech engine implements. A new engine is a new file in this folder.

export type Voice = { id: string; name: string; gender: 'male' | 'female'; accent: string };

// One sentence of speech: WAV audio plus each word's start and length in ms.
export type Synthesis = { audio: string; words: string[]; wtimes: number[]; wdurations: number[] };

// What a provider speaks: a sentence, or one item per word. A phonetic item gives the sounds, with the page word as subtitle.
export type SpeechItem = string | { type: 'phonetic'; value: string; subtitles: string };
export type SpeechInput = string | SpeechItem[];

export type ProviderStatus = 'starting' | 'ready' | 'down';

export type SpeechProvider = {
  id: string;
  model: string;
  defaultVoice: string;
  start(): void;
  status(): ProviderStatus;
  voices(): Voice[];
  synthesize(input: SpeechInput, voice: string): Promise<Synthesis>;
};
