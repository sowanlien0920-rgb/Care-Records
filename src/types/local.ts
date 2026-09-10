/*
 * carerecords 固有の型。
 *
 * kpi-react が読み書きしないものだけをここに置く。
 * kpi-react とやり取りする形は src/types/contract.ts にある。
 *
 * 判定基準: kpi-react が読むか書くかするなら contract、
 *           carerecords の中だけで完結するなら local。
 */
import { z } from 'zod';
import { dateSchema } from './contract';

/** 職員のロール。legacy/index.html:4121-4123 の権限判定と一致させる */
export const staffRoleSchema = z.enum([
  '管理者', // 承認・帳票・バックアップ・アカウント管理
  'サービス提供責任者', // 帳票・経過記録・利用者マスタ編集
  '訪問介護員', // 自分の担当分の記録入力とヒヤリハット報告のみ
]);

/**
 * 職員アカウント。
 *
 * Phase 1a では「職員を選ぶだけ」の簡易ログインのため、ここに role を持つ。
 * Phase 5 で Firebase Auth に移ると、role は認証トークンと users/{uid} から
 * 来るようになる。配信ドキュメントには載らない（配信は 1職員 = 1ドキュメントで、
 * 誰の配信かは既に確定しているため role を運ぶ必要がない）。
 */
export const staffAccountSchema = z.object({
  staffId: z.string().min(1),
  name: z.string().min(1),
  role: staffRoleSchema,
  /**
   * 承認権限。ロールから一意に決まらない。
   * legacy は管理者を常に true とし、それ以外はアカウント単位のフラグで持つ
   * （legacy/index.html:4121 canApproveAcc、:4371 の willApprove）。
   * サービス提供責任者でも承認権限を持たない設定がありうる。
   */
  canApprove: z.boolean(),
  active: z.boolean(),
});

/**
 * 記録作成の支援設定。
 *
 * 敬称・口調・長さ・記載スタイル・好みは AI 特記事項生成のための設定であり、
 * 法定文書とは無関係なので kpi-react に持つ理由がない。
 * legacy の db.profiles のうち honor / tone / len / style / like にあたる。
 */
export const recordPrefsSchema = z.object({
  /** 敬称（様 / さん など） */
  honorific: z.string(),
  tone: z.enum(['polite', 'plain']),
  length: z.enum(['short', 'normal', 'long']),
  /** 記載スタイルの指示（例: ご本人の発言は「」で引用する） */
  style: z.string(),
  /** 好み・習慣（例: お茶は濃いめを好まれる） */
  likes: z.string(),
});

export function blankRecordPrefs(): RecordPrefs {
  return { honorific: '様', tone: 'polite', length: 'normal', style: '', likes: '' };
}

/** ヒヤリハット・事故報告。統合先が未定のため incidentAdapter の裏に置く */
export const incidentSchema = z.object({
  incidentId: z.string().min(1),
  date: dateSchema,
  staffId: z.string().min(1),
  residentId: z.string().nullable(),
  kind: z.enum(['ヒヤリハット', '事故']),
  place: z.string(),
  summary: z.string(),
  response: z.string(),
  cause: z.string(),
  prevention: z.string(),
  reportedAt: z.string(),
});

/** 変更履歴。legacy の db.logs にあたる */
export const auditLogSchema = z.object({
  logId: z.string().min(1),
  at: z.string(),
  staffId: z.string().nullable(),
  category: z.string(),
  targetId: z.string().nullable(),
  message: z.string(),
});

export type StaffRole = z.infer<typeof staffRoleSchema>;
export type StaffAccount = z.infer<typeof staffAccountSchema>;
export type RecordPrefs = z.infer<typeof recordPrefsSchema>;
export type Incident = z.infer<typeof incidentSchema>;
export type AuditLog = z.infer<typeof auditLogSchema>;

/**
 * Phase 2 の Firestore ルールで使うロール。
 *
 * carerecords の表示上のロール（日本語）と、アクセス制御で使うロールは別物になる。
 * 日本語リテラルとの一致で権限を判定すると、表示ラベルを変えた瞬間に権限が壊れる。
 * 対応表をここに1つだけ持ち、両者がずれないようにする。
 */
export type RuleRole = 'facility' | 'supervisor' | 'helper';

const ROLE_TO_RULE: Record<StaffRole, RuleRole> = {
  管理者: 'facility',
  サービス提供責任者: 'supervisor',
  訪問介護員: 'helper',
};

export function toRuleRole(role: StaffRole): RuleRole {
  return ROLE_TO_RULE[role];
}

/**
 * 承認できるか。legacy/index.html:4124 の canApprove() と同じで、
 * ロールではなくアカウントの canApprove フラグを見る。
 * 承認者は記録に残す必要がある（法定要件）ため、判定を1箇所に閉じる。
 */
export function canApprove(account: StaffAccount | null): boolean {
  return account !== null && account.canApprove;
}

/** 管理者か。legacy の isMgr() */
export function isManager(account: StaffAccount | null): boolean {
  return account !== null && account.role === '管理者';
}

/**
 * サービス提供責任者以上か。legacy の isSup()。
 * 職員切替・帳票・経過記録の可否がこれで決まる。
 */
export function isSupervisor(account: StaffAccount | null): boolean {
  return account !== null && (account.role === '管理者' || account.role === 'サービス提供責任者');
}
