/*
 * 記載チェック。
 *
 * legacy の lintNote() は記録モーダル専用ではなく、未承認一覧の統計・行表示・
 * 一括承認の確認文面・CSV の「要修正件数」の計算式にも組み込まれている。
 * それらが同時に成立するには、判定が引数だけで決まる必要がある。
 *
 * ── legacy との差（意図的） ─────────────────────────────
 * legacy の lintNote() は `$('mask').classList.contains('on')` と `$('fNote').value` を
 * 読むため（:2349-2350）、記録モーダルが開いたまま未承認一覧や CSV が走ると、
 * note が空の別レコードを「開いているモーダルの本文」で判定していた。
 * ここでは DOM を一切読まない。記録モーダルは編集中の draft を引数として渡すことで
 * 「編集中の本文で判定する」を再現する（計画書 Q10）。
 *
 * ── 自動修正の範囲（Q11 の再検討） ──────────────────────
 * legacy は検出と置換が非対称で、「薬を飲ませて」等は押しても何も起きなかった。
 * これを「検出した語幹＋活用語尾」をまとめて置換する形に広げたところ、
 * **否定形が肯定文に化ける**という、legacy より悪い壊れ方をした。
 *   例: 「薬を飲ませていません」→「服薬の確認を行いましたいません」
 * 実施していない行為を実施したと読める本文が法定文書に入るため、
 * 置換は**置き換えても文意が反転しない活用形に限る**。
 * 該当しない語形では `fix` を付けない（＝自動修正ボタンを出さない）ので、
 * 「押しても何も起きない」という legacy の欠陥も同時に消える。
 *
 * 移植元: legacy/index.html:2327-2346（LINT_RULES）、:2348-2392（lintNote）、
 *         :3074-3082（outOfPlan）
 */
import type { CarePlanSnapshot, VisitRecord } from '../types/contract';
import { toMin } from '../utils/date';

/**
 * 判定1件。
 *
 * legacy の finding は `{lv, msg, fix}` の3プロパティしか持たず、ルールID も
 * 対象フィールド名も無い（:2358）。表示に必要なものがそれで足りているため、
 * ここでも増やさない。level は表示クラス（lv-ng / lv-warn / lv-ok）に対応する。
 *
 * check() が返すのは 'ng' と 'warn' だけで、'ok' は「1件も無かった」ことを
 * 表示する側の1行にしか使わない（legacy も renderLint 側で組み立てている、:2395-2398）。
 */
export type Finding = {
  level: 'ng' | 'warn' | 'ok';
  message: string;
  /**
   * 自動修正。本文に実際に現れた語形に対してだけ付く。
   * `pattern` は呼び出しごとに作り直すので、`lastIndex` の持ち回りが起きない。
   */
  fix?: { pattern: RegExp; replacement: string };
};

/** 指摘が1件も無いときに出す1行。legacy/index.html:2396 と同じ文言 */
export const NO_ISSUE_FINDING: Finding = {
  level: 'ok',
  message: '記載上の問題は見つかりませんでした。最終確認のうえ保存してください。',
};

/**
 * 自動修正の候補。`pattern` は `g` を付けずに持つ。
 * 「本文に含まれるか」を `test()` で見るため、`lastIndex` を持たせない。
 */
type Fix = { pattern: RegExp; replacement: string };

type LintRule = {
  re: RegExp;
  level: 'ng' | 'warn';
  message: string;
  /** 先に一致したものを1つだけ使う。長い語形から順に並べる */
  fixes?: readonly Fix[];
};

/**
 * 本文の表現に対する9件。legacy/index.html:2327-2346 の LINT_RULES と同じ。
 *
 * 配列の順がそのまま判定順・表示順になる。1ルールにつき最初のマッチ1件だけを
 * 指摘し、本文に `「マッチした文字列」：` を前置きする（:2356-2359）。
 */
const LINT_RULES: readonly LintRule[] = [
  {
    re: /(風邪|インフルエンザ|肺炎|脱水症|褥瘡|床ずれ|骨折して|認知症が進|うつ病|感染症|貧血で|熱中症)/,
    level: 'ng',
    message: '医学的な診断名の断定は記載できません。観察した事実（体温○℃、発赤がみられた 等）に置き換えてください。',
  },
  {
    re: /(摘便|浣腸|インスリン|血糖測定|喀痰吸引|たんの吸引|点滴|傷の消毒|軟膏を塗|褥瘡の処置|巻き爪|爪を切)/,
    level: 'ng',
    message: '医行為に該当するおそれのある行為です。訪問介護員が実施できる範囲か確認してください。',
  },
  {
    re: /(薬を飲ませ|服薬させ|投薬し)/,
    level: 'ng',
    message: '服薬は「確認・見守り・介助」の範囲で記載します（服用はご本人が行う）。',
    /*
     * 「実施した」と読める語形だけを置換する。否定・打消し（飲ませていません /
     * 飲ませない / 投薬しておりません）は1つも一致しないので、ボタンが出ない。
     * 「〜たい」（願望）に食い込まないよう、過去形には後読みを付けてある。
     */
    fixes: [
      { pattern: /(薬を飲ませました|薬を飲ませています|薬を飲ませている|服薬させました|服薬させています|服薬させている|投薬しました)/, replacement: '服薬の確認を行いました' },
      { pattern: /(薬を飲ませた|服薬させた|投薬した)(?!い)/, replacement: '服薬の確認を行いました' },
    ],
  },
  {
    re: /(草むしり|草取り|庭の手入れ|ペットの世話|犬の散歩|来客の対応|正月料理|おせち|大掃除|窓拭き|換気扇の掃除|模様替え|家具の移動|洗車|花壇)/,
    level: 'ng',
    message: '「日常生活の援助の範囲を超える行為」にあたり、介護保険では提供できません。記録から削除してください。',
  },
  {
    re: /(家族の分|夫の分|妻の分|息子の分|娘の分|家族の食事|家族の洗濯|家族の部屋)/,
    level: 'ng',
    message: 'ご本人以外に対する援助は算定できません。本人分の援助であることが分かる記載にしてください。',
  },
  {
    re: /(わがまま|困った方|困った人|面倒な|うるさい|しつこい|ボケ|痴呆|問題行動|文句を言|不潔|汚い|臭い|頑固)/,
    level: 'ng',
    message: '主観的・評価的な表現、尊厳を欠く表現は使用できません。事実の記載に改めてください。',
  },
  {
    re: /徘徊/,
    level: 'warn',
    message: '「徘徊」は不適切表現とされています。行動そのものを客観的に記載してください。',
    fixes: [{ pattern: /徘徊/, replacement: 'ひとりで外に出られる行動' }],
  },
  {
    re: /してあげ(た|ました|る)/,
    level: 'warn',
    message: '「〜してあげる」は対等な関係を欠く表現です。「〜を行いました」等に改めてください。',
    /*
     * legacy は「してあげました」だけを置換していた（:2343）。検出する3活用すべてを
     * 対象にするが、置換後も文が閉じるよう活用ごとに置換先を分ける。
     * 「してあげたい」（願望）は対象外にする
     */
    fixes: [
      { pattern: /してあげました/, replacement: 'しました' },
      { pattern: /してあげる/, replacement: 'する' },
      { pattern: /してあげた(?!い)/, replacement: 'した' },
    ],
  },
  {
    re: /(と思われる|らしい|気がする|だろう|みたい)/,
    level: 'warn',
    message: '推測・伝聞の表現です。観察した事実、またはご本人の発言（「」で引用）として記載してください。',
  },
];

/**
 * 実績が予定枠を外れていれば、その内容を返す。枠内と判定不能はどちらも空文字。
 * legacy/index.html:3074-3082 の outOfPlan と同じ。
 *
 * 真偽値ではなく文字列を返すのは、呼び出し側が理由をそのまま文面に埋めるため。
 */
export function outOfPlan(record: VisitRecord): string {
  const ps = toMin(record.plannedStart);
  const pe = toMin(record.plannedEnd);
  if (ps === null || pe === null) return '';
  const as = toMin(record.actualStart);
  const ae = toMin(record.actualEnd);
  const bad: string[] = [];
  if (as !== null && as < ps) bad.push(`開始 ${record.actualStart} が予定 ${record.plannedStart} より前`);
  if (ae !== null && ae > pe) bad.push(`終了 ${record.actualEnd} が予定 ${record.plannedEnd} より後`);
  return bad.join('／');
}

/**
 * 記載チェック。legacy/index.html:2348-2392 の lintNote と同じ順序・同じ文言で判定する。
 *
 * plan は訪問介護計画書のスナップショット。配信に利用者が載っていなければ undefined を渡す。
 * legacy の profOf() は未登録でも既定値のプロフィールを返すため、計画に関する3判定
 * （計画外サービス・生活援助の算定理由・短期目標）が不発になるだけで例外にはならない。
 * undefined を同じ扱いにしてある。
 *
 * legacy は prefs（記録支援設定）を一切読まない。読まないものを引数に取ると
 * 「設定で判定が変わる」と誤解されるため、受け取らない。
 */
export function check(record: VisitRecord, plan: CarePlanSnapshot | undefined): Finding[] {
  const txt = record.note.trim();
  const out: Finding[] = [];

  /*
   * 本文が空なら warn 1件で即 return する（legacy:2354）。
   * 以降を評価しないため、計画外サービスや予定枠外があっても ng は 0 件になる。
   * この挙動は未承認一覧の統計・行チップ・一括承認の確認・CSV にも波及するので、
   * 直すと5箇所の数字が同時に変わる。計画書の鉄則6 に従いそのまま写す。
   */
  if (!txt) {
    return [{ level: 'warn', message: '特記事項が未入力です。サービス提供記録として実施内容の記載が必要です。' }];
  }

  for (const rule of LINT_RULES) {
    const m = txt.match(rule.re);
    if (m === null) continue;
    const message = `「${m[0]}」：${rule.message}`;
    // 本文に実際に現れた語形にだけ自動修正を出す。無ければボタン自体を出さない
    const fix = rule.fixes?.find((f) => f.pattern.test(txt));
    // fix はプロパティごと省く。exactOptionalPropertyTypes 下では undefined を明示代入できない
    out.push(fix === undefined
      ? { level: rule.level, message }
      : { level: rule.level, message, fix: { pattern: new RegExp(fix.pattern.source, 'g'), replacement: fix.replacement } });
  }

  // 訪問介護計画との突き合わせ（legacy:2361-2366）。計画にサービス内容が無ければ判定しない
  const plannedTasks = plan?.plannedTasks ?? [];
  if (plannedTasks.length > 0) {
    const off = record.tasks.filter((t) => !plannedTasks.includes(t));
    if (off.length > 0) {
      out.push({
        level: 'ng',
        message: `「${off.join('、')}」は訪問介護計画に位置づけられていません。計画外のサービス提供は運営基準違反となります（計画の見直しが必要です）。`,
      });
    }
  }

  // 生活援助の算定理由（legacy:2368-2370）。世帯状況の既定は「独居」なので未登録では立たない
  if (/生活援助|身体＋生活/.test(record.serviceName)
    && /同居家族あり/.test(plan?.household ?? '')
    && !(plan?.householdSupportReason ?? '')) {
    out.push({
      level: 'ng',
      message: '同居家族がいる利用者への生活援助です。算定理由（家族が家事困難な事情）を利用者マスタに登録してください。',
    });
  }

  // 予定枠との整合（legacy:2372-2374）
  const oop = outOfPlan(record);
  if (oop) {
    out.push({
      level: 'ng',
      message: `実績時間が予定枠外です（${oop}）。訪問介護の実績は、訪問介護計画に定めた予定時間の枠内で記録してください。`,
    });
  }

  // 実績時間（legacy:2376-2382）
  const as = toMin(record.actualStart);
  const ae = toMin(record.actualEnd);
  if (as === null || ae === null) {
    out.push({ level: 'warn', message: 'サービス提供時刻（実績）が未入力です。開始・終了時刻の記録は必須です。' });
  } else {
    const ps = toMin(record.plannedStart);
    const pe = toMin(record.plannedEnd);
    const d = ae - as;
    /*
     * legacy は toMin() の null をそのまま引き算に通している（:2379）。
     * JS では null が 0 に化けるため、「予定開始だけ未入力」のときは
     * pd = 予定終了 となって差分の warn が出る。「予定終了だけ未入力」なら
     * pd が負になって出ない。この非対称を結果ごと写す（鉄則6）。
     */
    const pd = (pe ?? 0) - (ps ?? 0);
    if (pd > 0 && Math.abs(d - pd) >= 15) {
      out.push({
        level: 'warn',
        message: `予定${pd}分に対し実績${d}分と差があります。時間区分・算定に影響する場合は理由を記載してください。`,
      });
    }
  }

  // 具体性（legacy:2384-2385）。この2件は独立に評価され、同時に立つことがある
  if (txt.length < 25) {
    out.push({ level: 'warn', message: '記載が簡潔すぎます。実施内容・ご本人の状態・対応が分かるよう具体的に記載してください。' });
  }
  if (/^(特変なし|異常なし|変わりなし)[。\s]*$/.test(txt)) {
    out.push({ level: 'ng', message: '「特変なし」のみの記載は不可です。何を実施し、どのような状態であったかを記載してください。' });
  }

  /*
   * 短期目標への言及（legacy:2387-2390）。
   * ここまでに ng が1件も無いときだけ評価する順序依存がある。
   * 先に直すべき指摘が出ている記録に、目標への言及まで並べないための作りになっている。
   */
  const goal = plan?.shortTermGoal ?? '';
  if (goal && txt.length > 60 && !out.some((o) => o.level === 'ng')) {
    const kw = goal.replace(/[、。]/g, '').slice(0, 4);
    if (kw && !txt.includes(kw)) {
      out.push({
        level: 'warn',
        message: `短期目標「${goal}」に対する経過が読み取れません。目標に沿った支援であることが分かる記載が望まれます。`,
      });
    }
  }

  return out;
}

/** 要修正（ng）だけを数える。未承認一覧の統計・行チップ・一括承認・CSV が同じ数を出すために使う */
export function countNg(findings: Finding[]): number {
  return findings.filter((f) => f.level === 'ng').length;
}
