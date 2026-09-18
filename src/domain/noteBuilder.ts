/*
 * 特記事項の定型文生成。
 *
 * ── 純粋関数であることが要件になる ──────────────────────
 * legacy の localNote() は、当該訪問のほかに db.visits の全走査を3系統
 * （noteVariant / 直前記録 / 平常時体温）に依存していた。Phase 1b では
 * 当該訪問 + 訪問介護計画 + 記録支援設定だけを入力に取る（計画書 Q8）。
 *
 *   - 同じ入力なら必ず同じ出力になる。テストランナーが無い現状で検証できる唯一の形になる
 *   - Phase 5 で Firestore になっても、1件の生成のために利用者の全記録を読まずに済む
 *
 * 落とした3つの挙動と、その結果選ばれる分岐:
 *   - 文体のバリエーション（noteVariant、:2446-2450）→ 候補配列の添字を固定する
 *   - 直前の記録との書き出し重複回避（:2468-2480）→ pickOpen が pickV に戻る
 *   - 平常時体温との比較（:2524-2531）→ cmp は既定値の空文字のまま
 * いずれも legacy 側に else / 既定値があるため、分岐を消すのではなく既定側に固定している。
 *
 * ── AI 生成との関係 ─────────────────────────────────────
 * クライアントは generateNote() だけを知る。Phase 5 でここが Cloud Functions
 * 呼び出しに差し替わる。legacy の callClaude()（:2684-2716）は移植しない。
 * ブラウザから api.anthropic.com を直接叩き、API キーを localStorage に平文保存しており、
 * 移行計画の決定 H がこれを否定している。
 *
 * 移植元: legacy/index.html:2415-2430（TASK_PHRASE）、:2431-2441（MOOD_PHRASE / ALERT_MOODS）、
 *         :2443（TASK_ADL）、:2453-2572（localNote）
 */
import type { AdlItem, CarePlanSnapshot, VisitRecord } from '../types/contract';
import type { RecordPrefs } from '../types/local';
import { toMin } from '../utils/date';

/** 実施内容 → 文章中の言い回し。legacy/index.html:2415-2430 の TASK_PHRASE */
const TASK_PHRASE: Readonly<Record<string, (meal: string) => string>> = {
  '排泄介助': () => 'トイレへの誘導と排泄の介助',
  '食事介助': (meal) => `${meal}の食事介助`,
  '入浴介助': () => '入浴の介助',
  '清拭・整容': () => '清拭と整容',
  '更衣介助': () => '衣類の着替えの介助',
  '服薬確認': () => '服薬の確認',
  '体位変換': () => '体位変換',
  '移動・移乗': () => '移動および移乗の介助',
  '調理': (meal) => `${meal}の調理`,
  '掃除': () => '居室および水回りの掃除',
  '洗濯': () => '洗濯と洗濯物の取り込み',
  '買い物': () => '日用品の買い物',
  '見守り': () => '室内での見守り',
  '記録・連絡': () => '記録の記入とご家族への連絡',
};

/** 実施内容 → ADL の評価項目。legacy/index.html:2443 の TASK_ADL。「歩行」に対応する実施内容は無い */
const TASK_ADL: Readonly<Record<string, AdlItem>> = {
  '排泄介助': '排泄',
  '食事介助': '食事',
  '入浴介助': '入浴',
  '更衣介助': '更衣',
  '移動・移乗': '移乗',
};

/** ご本人の様子 → 1文。legacy/index.html:2431-2440 の MOOD_PHRASE。キーは MOOD_OPTIONS と一致させる */
const MOOD_PHRASE: Readonly<Record<string, { p: string; d: string }>> = {
  'いつもと変わりなし': { p: '普段と変わりないご様子でした。', d: '普段と変わりない様子であった。' },
  '体調良好・表情明るい': { p: '表情は明るく、体調も良好なご様子でした。', d: '表情明るく、体調良好であった。' },
  'やや元気がない': { p: '普段よりやや元気がなく、口数も少ないご様子でした。', d: '普段よりやや元気がなく、口数も少なかった。' },
  '痛みの訴えあり': { p: '痛みの訴えがあり、無理のない範囲で介助を行いました。', d: '痛みの訴えあり。無理のない範囲で介助を行った。' },
  '発熱・体調不良': { p: '体調不良の訴えがあり、状態を確認しながら支援を行いました。', d: '体調不良の訴えあり。状態を確認しながら支援を行った。' },
  '食欲低下': { p: '食欲の低下がみられ、摂取量に留意しました。', d: '食欲低下がみられ、摂取量に留意した。' },
  '睡眠不足の訴え': { p: '睡眠が十分にとれていないとの訴えがありました。', d: '睡眠不足の訴えあり。' },
  'ヒヤリハットあり': { p: 'ヒヤリハットがあり、安全に配慮して対応しました。', d: 'ヒヤリハットあり。安全に配慮して対応した。' },
};

/** MOOD_PHRASE に無い様子のときの代わり。legacy/index.html:2540 と同じ */
const MOOD_FALLBACK = 'いつもと変わりなし';

/** 締めで「報告します」に倒す様子。legacy/index.html:2441 の ALERT_MOODS */
const ALERT_MOODS: readonly string[] = ['痛みの訴えあり', '発熱・体調不良', '食欲低下', 'ヒヤリハットあり'];

/**
 * 候補から1つ選ぶ。legacy/index.html:2451 の pickV と同じ添字計算。
 *
 * legacy は noteVariant()（過去記録の件数 + 日付）を添字にして文体を散らしていた。
 * その依存を落としたので添字は固定になるが、legacy のどの候補が選ばれるかを
 * 追えるよう、候補配列と添字計算はそのまま残す。
 */
function pickV(arr: readonly string[], i: number): string {
  const n = arr.length;
  return arr[((i % n) + n) % n] ?? '';
}

/**
 * 固定した添字。
 * legacy は1箇所だけ `k+1` を渡していた（介助の程度、:2508）ので、そこだけ +1 になる。
 */
const VARIANT = 0;

export type NoteInput = {
  record: VisitRecord;
  /** 訪問介護計画書のスナップショット。配信に利用者が載っていなければ undefined */
  plan: CarePlanSnapshot | undefined;
  /** 読むのは tone と length だけ。honorific / style / likes は legacy も定型文では使っていない */
  prefs: RecordPrefs;
};

/**
 * 定型文を組み立てる。legacy/index.html:2453-2572 の localNote と同じ8ブロック。
 *
 * ブロックは区切り文字なしで連結する（legacy は `S.join('')`、:2571）。
 * 各ブロックが自前で句点を持つ前提になっている。
 */
export function buildNote({ record, plan, prefs }: NoteInput): string {
  const polite = prefs.tone === 'polite';
  /** 文末の出し分け。legacy:2455 の e() */
  const e = (p: string, d: string): string => (polite ? p : d);
  const len = prefs.length;

  const t = record.actualStart || record.plannedStart || '';
  const hh = parseInt((t || '12:00').split(':')[0] ?? '12', 10);
  const meal = hh < 10 ? '朝食' : hh < 15 ? '昼食' : '夕食';

  const as = toMin(record.actualStart);
  const ae = toMin(record.actualEnd);
  const dur = as !== null && ae !== null ? ae - as : null;

  const S: string[] = [];

  // ① 訪問（legacy:2481-2486）
  S.push(pickV([
    `${t}${e('に訪問しました。', 'に訪問。')}`,
    `${t}${e('にご自宅へ伺いました。', 'に自宅へ訪問。')}`,
    `${t}${e('より訪問し、支援を開始しました。', 'より訪問し、支援を開始。')}`,
    `${t}${e('に訪問。ご本人に声をかけ、体調を確認してから支援に入りました。', 'に訪問。声かけののち体調を確認し、支援を開始した。')}`,
  ], VARIANT));

  // ② 実施内容（legacy:2488-2494）。TASK_PHRASE に無い実施内容は名称のまま入る
  const tasks = record.tasks.map((x) => TASK_PHRASE[x]?.(meal) ?? x);
  S.push(tasks.length > 0
    ? pickV([
      `${record.serviceName}として、${tasks.join('、')}を実施${e('しました。', 'した。')}`,
      `${tasks.join('、')}を行い${e('ました（', '（')}${record.serviceName}${e('）。', '）。')}`,
      `${record.serviceName}を提供し、${tasks.join('、')}を${e('行いました。', '行った。')}`,
    ], VARIANT)
    : `${record.serviceName}を実施${e('しました。', 'した。')}`);

  // ③ 介助の程度（legacy:2496-2509）。short では出さない
  if (len !== 'short') {
    const byDeg = new Map<string, string[]>();
    for (const task of record.tasks) {
      const item = TASK_ADL[task];
      if (item === undefined) continue;
      const deg = plan?.adl[item];
      // 「自立」は介助していないので並べない
      if (deg === undefined || deg === '自立') continue;
      byDeg.set(deg, [...(byDeg.get(deg) ?? []), item]);
    }
    const parts = [...byDeg].map(([deg, items]) => `${items.join('・')}は${deg}`);
    if (parts.length > 0) {
      S.push(pickV([
        `${parts.join('、')}にて対応${e('しました。', 'した。')}`,
        `${parts.join('、')}が必要なため、安全に配慮しながら${e('介助しました。', '介助した。')}`,
        `${parts.join('、')}で、ご本人のできることは見守りながら${e('支援しました。', '支援した。')}`,
      ], VARIANT + 1));
    }
  }

  // ④ コミュニケーション上の配慮（legacy:2511-2516）。long のときの「難聴あり」だけ
  if (len === 'long' && (plan?.communication ?? []).includes('難聴あり')) {
    S.push(pickV([
      e('難聴があるため、ゆっくりと聞き取りやすい声で声かけを行いました。', '難聴のため、ゆっくりと聞き取りやすい声で声かけを行った。'),
      e('お声がけは正面からゆっくりと行い、聞き取りを確認しながら進めました。', '声かけは正面からゆっくり行い、聞き取りを確認しながら進めた。'),
    ], VARIANT));
  }

  // ⑤ バイタル（legacy:2518-2537）。平常時との比較は移植しないので cmp は常に空
  const vit: string[] = [];
  if (record.vitals.temperature) vit.push(`体温${record.vitals.temperature}℃`);
  if (record.vitals.bloodPressure) vit.push(`血圧${record.vitals.bloodPressure}mmHg`);
  if (record.vitals.pulse) vit.push(`脈拍${record.vitals.pulse}回／分`);
  if (vit.length > 0 && len !== 'short') {
    S.push(pickV([
      `バイタルは${vit.join('、')}${e('でした。', 'であった。')}`,
      `バイタル測定の結果、${vit.join('、')}${e('でした。', 'であった。')}`,
      `${vit.join('、')}を測定${e('しました。', 'した。')}`,
    ], VARIANT));
  }

  // ⑥ ご本人の様子（legacy:2539-2540）。長さに関係なく必ず1文出る
  const mood = MOOD_PHRASE[record.mood] ?? MOOD_PHRASE[MOOD_FALLBACK];
  if (mood !== undefined) S.push(polite ? mood.p : mood.d);

  // ⑦ ヘルパーのメモ（legacy:2542-2548）
  if (record.memo) {
    const m = record.memo.replace(/[\r\n]+/g, '、').replace(/、+$/, '').replace(/。$/, '');
    if (/あり$/.test(m)) S.push(m.replace(/あり$/, e('がありました。', 'あり。')));
    else if (/なし$/.test(m)) S.push(m.replace(/なし$/, e('はありませんでした。', 'なし。')));
    else S.push(`${m}${e('とのことでした。', 'との申し送りあり。')}`);
  }

  // ⑧a 締め（legacy:2550-2561）
  const alert = ALERT_MOODS.includes(record.mood);
  if (len !== 'short') {
    if (alert) {
      S.push(pickV([
        e('事業所へ報告し、次回訪問時に状態を確認します。', '事業所へ報告。次回訪問時に状態を確認する。'),
        e('サービス提供責任者へ報告し、継続して状態を確認していきます。', 'サービス提供責任者へ報告し、継続して状態を確認する。'),
      ], VARIANT));
    } else if (dur !== null && len === 'long') {
      S.push(pickV([
        `${dur}分間のサービスを予定どおり提供し、${e('終了しました。', '終了した。')}`,
        `予定どおり${dur}分間の支援を行い、${e('退室しました。', '退室した。')}`,
      ], VARIANT));
    }
  }

  // ⑧b long のときだけ足す3つ（legacy:2562-2570）。⑧a と排他ではなく追加になる
  if (len === 'long') {
    const caution = plan?.caution ?? '';
    if (caution) {
      S.push(`支援にあたっては、留意事項（${caution.replace(/。$/, '')}）に沿って対応${e('しました。', 'した。')}`);
    }
    const goal = plan?.shortTermGoal ?? '';
    if (goal) {
      S.push(pickV([
        `短期目標である「${goal}」に向けて、引き続き支援${e('を行います。', 'を行う。')}`,
        `短期目標「${goal}」に沿った支援を継続${e('します。', 'する。')}`,
      ], VARIANT));
    } else {
      S.push(e('引き続き見守りを行い、変化があれば速やかに報告します。', '引き続き見守りを行い、変化があれば速やかに報告する。'));
    }
    const reason = plan?.householdSupportReason ?? '';
    if (/生活援助|身体＋生活/.test(record.serviceName) && reason) {
      S.push(`（生活援助の提供理由：${reason}）`);
    }
  }

  return S.join('');
}

/**
 * 特記事項を生成する。呼び出し側はこれだけを知る。
 *
 * Phase 1b では定型文をそのまま返す。Phase 5 でここが Cloud Functions 呼び出しに
 * 差し替わり、失敗時に buildNote() へフォールバックする形になる。
 *
 * DataAdapter には載せない。生成は永続化ではなく、Phase 5 でも送信先が別になる
 * （features/incident/incidentAdapter.ts が同じ理由で DataAdapter と別経路にしてある）。
 */
export function generateNote(input: NoteInput): Promise<string> {
  return Promise.resolve(buildNote(input));
}
