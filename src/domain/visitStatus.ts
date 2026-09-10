/*
 * 訪問の状態判定。
 *
 * legacy では 1件の visit が予定と実績と状態を1つのオブジェクトで持っていたが、
 * 新モデルでは配信（予定・読み取り専用）と実施記録（実績・書き込み）に分かれる。
 * その2つから表示上の状態を導く判定を、ここ1箇所に閉じる。
 *
 * 移植元: legacy/index.html:3248-3254（todoStage）、:1723-1735（renderStats）
 */
import { buildVisitRecord, type Dispatch, type DispatchVisit, type ResidentBrief, type VisitRecord, type VisitStatus } from '../types/contract';
import { toMin } from '../utils/date';

/**
 * 表示上の状態を導く。
 *
 * キャンセルの正は配信側にある。訪問の中止は事業所の判断であり、
 * kpi-react のルート表で管理されるため、記録側の状態より優先する。
 * 記録が無ければ「未完」。legacy の「未完＝登録なし」と同じ。
 */
export function deriveStatus(visit: DispatchVisit, record: VisitRecord | undefined): VisitStatus {
  if (visit.cancelled) return 'キャンセル';
  if (record === undefined) return '未完';
  return record.status;
}

/**
 * 未完了の訪問の段階。legacy/index.html:3248-3254 と同じ判定。
 * -1 は「未完了ではない」。
 */
export function todoStage(visit: DispatchVisit, record: VisitRecord | undefined): number {
  const status = deriveStatus(visit, record);
  if (status === '完了' || status === 'キャンセル') return -1;
  if (record === undefined || !record.actualStart) return 0; // 未着手
  if (!record.actualEnd) return 1; // 対応中
  if (!record.note.trim()) return 2; // 記録未完成
  return -1; // 記録あり。承認待ちなので未完了には含めない
}

/**
 * 実施時間の合計（分）。legacy/index.html:1729-1733 と同じ計算。
 *
 * legacy は状態でフィルタしていない。キャンセルの訪問でも実績時刻が
 * 入っていれば加算される。移植では仕様を変えないため、そのまま写す。
 * （この挙動が妥当かどうかは別途の判断になる。計画書 §5 に記録した）
 */
export function totalMinutes(records: VisitRecord[]): number {
  return records.reduce((acc, r) => {
    const s = toMin(r.actualStart);
    const e = toMin(r.actualEnd);
    return acc + (s !== null && e !== null && e > s ? e - s : 0);
  }, 0);
}

/** 訪問と記録を visitId で突き合わせる */
export function recordOf(visitId: string, records: VisitRecord[]): VisitRecord | undefined {
  return records.find((r) => r.visitId === visitId);
}

/**
 * 配信された訪問から、まだ存在しない実施記録の初期値を作る。
 *
 * 記録の生成をここ1箇所に閉じることで、staffName / carePlanVersion といった
 * 「あとから引けなくなる情報」の埋め忘れを防ぐ。どちらも法定文書としての
 * 追跡可能性のために必要になる（記録単体で誰が実施し、どの計画に沿ったかを読めること）。
 */
export function newRecordFor(
  visit: DispatchVisit,
  dispatch: Dispatch,
  resident: ResidentBrief | undefined,
): VisitRecord {
  const now = new Date().toISOString();
  return buildVisitRecord({
    visitId: visit.visitId,
    facilityId: dispatch.facilityId,
    date: dispatch.date,
    staffId: dispatch.staffId,
    residentId: visit.residentId,
    serviceName: visit.serviceName,
    plannedStart: visit.startTime,
    plannedEnd: visit.endTime,
    actualStart: '',
    actualEnd: '',
    tasks: [],
    vitals: { temperature: '', bloodPressure: '', pulse: '' },
    note: '',
    noteSource: null,
    status: '未完',
    staffName: dispatch.staffName,
    carePlanVersion: resident?.carePlan.planVersion ?? null,
    approvedBy: null,
    approvedByName: null,
    approvedAt: null,
    createdBy: dispatch.staffId,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * 一覧に出す実施内容。
 *
 * 記録があればその内容、無ければ訪問介護計画書のサービス内容を出す。
 * legacy は予定にも tasks を持たせていたが、新モデルでは予定は配信から来る。
 * 計画に沿った支援が求められるため、記録前に見せるべきは計画上のサービス内容になる。
 */
export function tasksOf(record: VisitRecord | undefined, resident: ResidentBrief | undefined): string[] {
  if (record !== undefined && record.tasks.length > 0) return record.tasks;
  return resident?.carePlan.plannedTasks ?? [];
}
