/*
 * 音声入力（Web Speech API）。
 *
 * 記録モーダルの特記事項・メモ、ヒヤリハットのメモ、未完了一覧の行内メモの
 * 4箇所で共有する。欄ごとの違いは区切り文字だけで、textarea は区切りなし、
 * input は `／` を入れる（legacy/index.html:3174）。
 *
 * ── React に置き換えるにあたっての差 ────────────────────
 * legacy は `micBtnEl` / `micTargetEl` / `micLiveEl` という3本のグローバルで
 * 状態を受け渡し、入力欄には `el.value` を直接代入していた（:3176）。
 * 直接代入は input / change を発火しないため、未完了一覧では音声で入れた内容が
 * 保存されない経路があった。ここでは「入力欄の現在値とカーソル位置を読み、
 * 次の値を呼び出し側に返す」形にして、保存経路を通常の入力と同じにする。
 *
 * `.mic-live` は `.on` が無いと表示されない（CLAUDE.md 鉄則5）。描画は呼び出し側。
 *
 * 移植元: legacy/index.html:3149-3244
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCareStore } from '../store/useCareStore';

/** 認識結果を入れる先。React の state を正にするため、次の値をコールバックで返す */
export type SpeechTarget = {
  /** どのボタンが録音中かを表す。同じ id をもう一度押すと停止する */
  id: string;
  el: HTMLInputElement | HTMLTextAreaElement | null;
  onChange: (next: string) => void;
};

/** legacy/index.html:3219-3230 のエラー文言 */
const ERROR_MESSAGE: Readonly<Record<string, string>> = {
  'not-allowed': 'マイクの使用が許可されていません。ブラウザのアドレスバーからマイクを許可してください。',
  'service-not-allowed': 'マイクの使用が許可されていません。ファイルを直接開いている場合は、付属の「サーバーで起動.cmd」からご利用ください。',
  'audio-capture': 'マイクが見つかりません。接続をご確認ください。',
  'network': '音声認識サーバーに接続できませんでした。ネットワークをご確認ください。',
};

/**
 * 非対応の端末に出す案内。legacy はボタンを黙って隠すだけで理由を出さない（:3239）。
 * 出さないと「ボタンが無い＝壊れている」と受け取られる（計画書 Q9）。
 */
export const SPEECH_UNSUPPORTED_HINT = '音声入力はこの端末では使えません（Chrome / Edge でご利用ください）';

/** 音声認識が使えるか。secure context（localhost を含む）でのみ実装が載る */
export function speechSupported(): boolean {
  return typeof window !== 'undefined'
    && (window.SpeechRecognition ?? window.webkitSpeechRecognition) !== undefined;
}

/**
 * 文末に句点を補う。legacy/index.html:3157-3162 の micPunct と同じ。
 * 音声認識は句読点を返さないため、確定するたびに1つだけ足す。
 */
export function micPunct(t: string): string {
  const s = t.trim();
  if (!s) return '';
  return /[。、！？!?.]$/.test(s) ? s : `${s}。`;
}

/**
 * カーソル位置に差し込んだ結果を返す。legacy/index.html:3168-3180 の micInsert と同じ。
 * 直前が空・空白・句読点のときは区切りを入れない。
 */
export function insertAtCaret(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): { value: string; caret: number } {
  const isArea = el.tagName === 'TEXTAREA';
  const pos = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
  const before = el.value.slice(0, pos);
  const after = el.value.slice(pos);
  const sep = before && !/[\s。、！？\n]$/.test(before) ? (isArea ? '' : '／') : '';
  const ins = sep + text;
  return { value: before + ins + after, caret: pos + ins.length };
}

export function useSpeechInput() {
  const { notify } = useCareStore();
  const supported = speechSupported();

  /** 録音中のボタンの id。null なら停止中 */
  const [listening, setListening] = useState<string | null>(null);
  /** 中間結果。`.mic-live` にだけ出し、入力欄には入れない */
  const [interim, setInterim] = useState('');
  /** 1件でも結果が来たか。legacy は最初の結果で .mic-live の文言を切り替える（:3200 → :3216） */
  const [heard, setHeard] = useState(false);

  const recRef = useRef<SpeechRecognition | null>(null);
  const targetRef = useRef<SpeechTarget | null>(null);
  // 自動再開の判定に使う。state だとハンドラの中で古い値を見る
  const onRef = useRef(false);

  const stop = useCallback(() => {
    onRef.current = false;
    const rec = recRef.current;
    if (rec !== null) {
      try { rec.stop(); } catch { /* 停止済みでも問題ない */ }
    }
    targetRef.current = null;
    setListening(null);
    setInterim('');
    setHeard(false);
  }, []);

  const start = useCallback((target: SpeechTarget) => {
    if (!supported) {
      notify('このブラウザは音声入力に対応していません（Chrome / Edge をご利用ください）');
      return;
    }
    // 同じボタンなら停止、別のボタンなら切り替える（legacy:3194）
    if (onRef.current) {
      const same = targetRef.current?.id === target.id;
      stop();
      if (same) return;
    }

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (Ctor === undefined) return;
    const rec = new Ctor();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let fin = '';
      let itr = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r === undefined) continue;
        const alt = r[0];
        if (alt === undefined) continue;
        if (r.isFinal) fin += alt.transcript;
        else itr += alt.transcript;
      }
      if (fin) {
        const t = targetRef.current;
        const el = t?.el ?? null;
        if (t !== null && el !== null) {
          const { value, caret } = insertAtCaret(el, micPunct(fin));
          t.onChange(value);
          // 制御コンポーネントでも、次の描画までは DOM の値を見てカーソルを置ける
          el.value = value;
          try { el.setSelectionRange(caret, caret); } catch { /* input type によっては使えない */ }
          el.scrollTop = el.scrollHeight;
        }
      }
      setInterim(itr);
      setHeard(true);
    };

    rec.onerror = (ev) => {
      // 無音は自動再開に任せる（legacy:3227）
      if (ev.error === 'no-speech') return;
      notify(ERROR_MESSAGE[ev.error] ?? `音声入力エラー（${ev.error}）`);
      stop();
    };

    // 無音で切れても続ける（legacy:3231-3233）
    rec.onend = () => {
      if (!onRef.current) return;
      try { rec.start(); } catch { stop(); }
    };

    recRef.current = rec;
    targetRef.current = target;
    onRef.current = true;
    setListening(target.id);
    setInterim('');
    setHeard(false);
    try {
      rec.start();
    } catch {
      notify('音声入力を開始できませんでした');
      stop();
    }
  }, [supported, notify, stop]);

  // 画面を離れるときに止める。legacy はモーダルを閉じる経路の一部でしか止めていなかった
  useEffect(() => stop, [stop]);

  return { supported, listening, interim, heard, start, stop };
}
