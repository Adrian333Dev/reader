// HeadTTS's English language module ships without types. These are the parts server/pronunciation.ts uses.
export declare class Language {
  dictionary: Record<string, string[]> | null;
  punctuations: Record<string, string>;
  loadDictionary(path: string): Promise<void>;
  splitText(text: string): string[];
  normalizeUpper(word: string): string[];
  phonemizeWord(word: string): string[];
  convertNumberToWords(number: string, isNotSpecial?: boolean): string;
}
