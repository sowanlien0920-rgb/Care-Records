/*
 * ログイン ID ↔ メールアドレスの変換。
 *
 * ── なぜ変換が要るか ──────────────────────────────────────
 * Firebase Auth はメールアドレスでサインインするが、職員に配るのは
 * `A001` のような短いログイン ID である（kpi-react の Phase 3）。
 * ヘルパーに `mock-facility001@kpi-system.internal` を入力させることはできない。
 *
 * ── なぜ対応表を静的に持つのか ────────────────────────────
 * kpi-react の組み立て規則は2つに分かれている（`AccountPage.jsx:43-45`）。
 *
 *   ログイン ID = 施設**コード** + 3桁   toLoginId(facilityCode, seq)
 *   メール       = 施設**ID**   + 3桁 + @kpi-system.internal
 *
 * 施設コードと施設 ID は別の値なので、ログイン ID だけではメールを作れない。
 * 対応表は `facilities/{fid}.facilityCode` にあるが、**ログイン前は未認証で
 * Firestore を読めない**。したがって carerecords のバンドルに静的に持つしかない。
 * これは Phase 3 の時点で決まっている（`AccountPage.jsx:38-42` のコメント）。
 *
 * ── 変更するときは ────────────────────────────────────────
 * この規則は kpi-react との契約であり、**片方だけ変えるとログインできなくなる**。
 * `src/types/contract.ts` と同じ扱いで、変更は両方に同時に入れること。
 */

/** kpi-react の `AccountPage.jsx:43` と同じ */
function pad(seq: number): string {
  return String(seq).padStart(3, '0');
}

/**
 * 施設コード → 施設 ID。
 *
 * **本番の値がまだ入っていない。** 依頼者から受け取って追加する必要がある
 * （kpi-react の AdminPanel で施設ごとに設定されている `facilityCode` と、
 * `facilities` のドキュメント ID の対応）。
 * ここに無い施設コードのログイン ID は、パスワードが合っていても弾かれる。
 */
export const FACILITY_CODE_TO_ID: Readonly<Record<string, string>> = {
  // エミュレータの seed（`scripts/seedEmulator.ts`）が作る施設
  MOCK: 'mock-facility',
};

export interface ParsedLoginId {
  facilityCode: string;
  seq: number;
}

/**
 * ログイン ID を施設コードと連番に分ける。
 *
 * 末尾3桁が連番、それより前が施設コードになる。
 * 施設コードに数字が含まれていても、末尾から3桁を取るので壊れない。
 */
export function parseLoginId(input: string): ParsedLoginId | null {
  const trimmed = input.trim();
  const matched = /^(.+?)(\d{3})$/.exec(trimmed);
  if (!matched) return null;
  const facilityCode = matched[1];
  const digits = matched[2];
  if (!facilityCode || !digits) return null;
  return { facilityCode, seq: Number(digits) };
}

/**
 * ログイン ID からサインイン用のメールアドレスを作る。
 * 対応表に無い施設コードなら null を返す。
 *
 * 小文字に揃える。Firebase Auth はメールアドレスを小文字に正規化して保存するため、
 * 施設 ID に大文字が含まれていると、揃えないと別のアドレスとして扱われる。
 */
export function loginIdToEmail(loginId: string): string | null {
  const parsed = parseLoginId(loginId);
  if (!parsed) return null;
  const facilityId = FACILITY_CODE_TO_ID[parsed.facilityCode.toUpperCase()];
  if (!facilityId) return null;
  return `${facilityId}${pad(parsed.seq)}@kpi-system.internal`.toLowerCase();
}

/** 表示用。kpi-react の `toLoginId` と同じ */
export function toLoginId(facilityCode: string, seq: number): string {
  return `${facilityCode}${pad(seq)}`;
}
