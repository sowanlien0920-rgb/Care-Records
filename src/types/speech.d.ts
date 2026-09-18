/*
 * Web Speech API（音声認識）の最小宣言。
 *
 * TypeScript 5.9 の lib.dom.d.ts には SpeechRecognition が入っていない。
 * ベンダー接頭辞つきの webkitSpeechRecognition も当然 Window に無いため、
 * 使う分だけをここで宣言する。実装が無いブラウザでは両方 undefined になる。
 *
 * 移植元: legacy/index.html:3150（`window.SpeechRecognition || window.webkitSpeechRecognition`）
 */

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  /** 'no-speech' / 'not-allowed' / 'service-not-allowed' / 'audio-capture' / 'network' / 'aborted' など */
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognition;

interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}
