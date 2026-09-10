/*
 * モックデータ。
 *
 * Phase 4 で kpi-react が書き出す配信ドキュメントと「同じ形」で作ることが要点になる。
 * ここが乖離すると Phase 5 の差し替えで UI 側の修正が発生し、アダプタ境界を
 * 設けた意味が失われる。
 *
 * 元データは legacy/index.html の seed() / seedProfiles()（1665-1700 / 2220-2245）。
 * kpi-react 側の実フィールドは docs/plans/2026-09-10-carerecords-react-migration.md
 * の「## 3 既存の実装パターン」を参照。
 */
import { SCHEMA_VERSION, type Dispatch, type DispatchVisit, type ResidentBrief, type ServiceKind } from '../types/contract';
import type { StaffAccount } from '../types/local';
import { addDays, fmt, iso, nowMin } from '../utils/date';

export const MOCK_FACILITY_ID = 'mock-facility';

/** legacy/index.html:1640 の SERVICES と一致 */
const SERVICES: ServiceKind[] = ['身体介護', '生活援助', '身体＋生活', '通院等乗降介助'];

/** legacy/index.html:1641 の TASKS と一致 */
const TASKS = [
  '排泄介助', '食事介助', '入浴介助', '清拭・整容', '更衣介助', '服薬確認',
  '体位変換', '移動・移乗', '調理', '掃除', '洗濯', '買い物', '見守り', '記録・連絡',
];

/**
 * 職員。kpi-react の staffs は Date.now() ベースの安定 ID を持つため、
 * モックでも氏名ではなく ID で参照する形にしておく。
 */
export const MOCK_STAFF: StaffAccount[] = [
  { staffId: 's001', name: '中山 理恵', role: 'サービス提供責任者', active: true },
  { staffId: 's002', name: '佐藤 健一', role: '訪問介護員', active: true },
  { staffId: 's003', name: '鈴木 美咲', role: '訪問介護員', active: true },
  { staffId: 's004', name: '田中 陽子', role: '訪問介護員', active: true },
  { staffId: 's005', name: '大橋 直人', role: '管理者', active: true },
];

/**
 * 利用者。legacy/index.html:1646-1648 の USERS と seedProfiles() を合わせたもの。
 *
 * carePlan の中身は kpi-react の carePlans / assessments / residentList が正であり、
 * carerecords からは編集できない。ここはあくまで「配信で受け取ったもの」の再現。
 */
const RESIDENT_SEED: Array<Pick<ResidentBrief, 'residentId' | 'name' | 'furigana' | 'age' | 'sex'> & {
  carePlan: Partial<ResidentBrief['carePlan']>;
}> = [
  {
    residentId: 'r001', name: '岩佐 久子', furigana: 'いわさ ひさこ', age: '86', sex: '女性',
    carePlan: {
      careLevel: '要介護2', household: '独居', family: '長女（近隣在住）',
      adlLevel: 'A1', dementiaLevel: 'Ⅰ',
      adl: { 歩行: '見守り', 移乗: '一部介助', 排泄: '一部介助', 入浴: '一部介助', 食事: '自立', 更衣: '一部介助' },
      communication: ['難聴あり', '意思疎通は良好'],
      disease: '変形性膝関節症、高血圧症',
      medication: '降圧剤を朝食後に服用（服薬の確認のみ）',
      longTermGoal: '住み慣れた自宅で安全に生活を続けることができる',
      shortTermGoal: '手すりを使って自力でトイレまで移動できる',
      supportPlan: '移動時は左側から支持し、ご本人のペースに合わせて見守る。膝に負担がかからないよう立ち上がりは声かけを行う。',
      plannedTasks: ['排泄介助', '移動・移乗', '服薬確認', '見守り', '記録・連絡'],
      caution: '転倒歴あり。浴室内は必ず見守りを行う。',
    },
  },
  {
    residentId: 'r002', name: '税所 義晴', furigana: 'さいしょ よしはる', age: '79', sex: '男性',
    carePlan: {
      careLevel: '要介護1', household: '同居家族あり（日中独居）', family: '長男（同居・日中就労）',
      adlLevel: 'J2', dementiaLevel: '自立',
      adl: { 歩行: '自立', 移乗: '自立', 排泄: '自立', 入浴: '見守り', 食事: '自立', 更衣: '自立' },
      communication: ['意思疎通は良好'],
      disease: '糖尿病、腰部脊柱管狭窄症',
      medication: '血糖降下薬を服用（服薬の確認のみ）',
      longTermGoal: '食事管理を続け、糖尿病の悪化を防ぐことができる',
      shortTermGoal: '栄養バランスのとれた食事を毎日摂ることができる',
      supportPlan: '調理は主治医の指示に基づき、減塩・糖質量に配慮する。ご本人と一緒に献立を決める。',
      plannedTasks: ['調理', '掃除', '洗濯', '買い物', '記録・連絡'],
      // 同居家族ありのため算定理由が必要。記載チェック（legacy:2368）の対象になる
      householdSupportReason: '同居家族が就労等により日中不在のため（やむを得ない事情）',
      caution: '低血糖症状（ふらつき・冷汗）に注意し、みられた場合は事業所へ連絡。',
    },
  },
  { residentId: 'r003', name: '的場 香代子', furigana: 'まとば かよこ', age: '81', sex: '女性', carePlan: { careLevel: '要介護1', household: '独居' } },
  { residentId: 'r004', name: '小林 満智子', furigana: 'こばやし まちこ', age: '88', sex: '女性', carePlan: { careLevel: '要介護3', household: '独居' } },
  { residentId: 'r005', name: '上野山 正子', furigana: 'うえのやま まさこ', age: '84', sex: '女性', carePlan: { careLevel: '要支援2', household: '同居家族あり' } },
  { residentId: 'r006', name: '池尻 藴美', furigana: 'いけじり つぐみ', age: '77', sex: '女性', carePlan: { careLevel: '要介護2', household: '独居' } },
  { residentId: 'r007', name: '加来 眞行', furigana: 'かく まさゆき', age: '83', sex: '男性', carePlan: { careLevel: '要介護2', household: '独居' } },
  { residentId: 'r008', name: '山﨑 弘子', furigana: 'やまさき ひろこ', age: '90', sex: '女性', carePlan: { careLevel: '要介護4', household: '同居家族あり' } },
];

function blankCarePlan(): ResidentBrief['carePlan'] {
  return {
    careLevel: '', household: '独居', householdSupportReason: '', family: '',
    adlLevel: '', dementiaLevel: '', adl: {}, communication: [],
    disease: '', medication: '',
    longTermGoal: '', shortTermGoal: '', supportPlan: '', plannedTasks: [], caution: '',
    planVersion: null, planUpdatedAt: null,
  };
}

const RESIDENTS: ResidentBrief[] = RESIDENT_SEED.map((r) => ({
  residentId: r.residentId,
  name: r.name,
  furigana: r.furigana,
  age: r.age,
  sex: r.sex,
  carePlan: { ...blankCarePlan(), ...r.carePlan, planVersion: 1, planUpdatedAt: '2026-09-01T00:00:00.000Z' },
}));

/**
 * 配信で渡す利用者情報は毎回コピーを返す。
 * module スコープの配列をそのまま渡すと、UI 側が書き換えたときに
 * 「配信元」が変わってしまい、法定文書系が閲覧のみである性質が
 * 実装上は担保されなくなる。
 */
function cloneResident(r: ResidentBrief): ResidentBrief {
  return {
    ...r,
    carePlan: {
      ...r.carePlan,
      adl: { ...r.carePlan.adl },
      communication: [...r.carePlan.communication],
      plannedTasks: [...r.carePlan.plannedTasks],
    },
  };
}

export function mockResidents(): ResidentBrief[] {
  return RESIDENTS.map(cloneResident);
}

/**
 * 指定日・指定職員の配信を生成する。
 *
 * legacy の seed() は「昨日・今日・明日」の3日分を職員3名に割り当てていた。
 * 同じ密度になるようにしている。
 */
export function mockDispatch(date: string, staffId: string): Dispatch | null {
  // 存在しない職員は「配信が無い」ではなく不正な要求として扱う。
  // 実在職員で配信0件のケース（emptyDispatch）と混同しないため。
  const staff = MOCK_STAFF.find((s) => s.staffId === staffId);
  if (!staff) throw new Error(`存在しない職員です: ${staffId}`);

  const base = iso(new Date());
  const offset = [-1, 0, 1].find((n) => addDays(base, n) === date);
  // 昨日・今日・明日以外は配信なし（0件ではなく「配信そのものが無い」）
  if (offset === undefined) return null;

  // 配信対象は先頭3名のみ。legacy の STAFF.slice(0,3) と同じ
  const staffIndex = MOCK_STAFF.findIndex((s) => s.staffId === staffId);
  if (staffIndex > 2) {
    return emptyDispatch(date, staff.staffId, staff.name);
  }

  const count = staffIndex === 0 ? 12 : 6;
  let clock = 6 * 60 + staffIndex * 15;
  const visits: DispatchVisit[] = [];
  const usedResidents = new Set<string>();

  for (let i = 0; i < count; i += 1) {
    const dur = [8, 9, 10, 20, 30, 45][i % 6] ?? 30;
    const resident = RESIDENTS[(staffIndex * 4 + i) % RESIDENTS.length];
    if (!resident) break;
    usedResidents.add(resident.residentId);

    visits.push({
      visitId: `${date}-${staff.staffId}-${String(i).padStart(2, '0')}`,
      residentId: resident.residentId,
      serviceName: SERVICES[i % SERVICES.length] ?? '身体介護',
      startTime: fmt(clock),
      endTime: fmt(clock + dur),
      officeName: 'そわん訪問介護事業所',
      // 1件だけ手動追加を混ぜ、source の出し分けを確認できるようにする
      source: i === 5 ? 'manual' : 'plan',
      // legacy の seed() で off===0 && i===4 をキャンセルにしていたのに合わせる
      cancelled: offset === 0 && i === 4,
      cancelReason: offset === 0 && i === 4 ? '利用者都合により中止' : '',
    });
    clock += dur + 10;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    facilityId: MOCK_FACILITY_ID,
    date,
    staffId: staff.staffId,
    staffName: staff.name,
    visits,
    // 配信に載せる利用者は、その日の訪問に登場する分だけに絞る
    residents: RESIDENTS.filter((r) => usedResidents.has(r.residentId)).map(cloneResident),
    generatedAt: new Date().toISOString(),
  };
}

function emptyDispatch(date: string, staffId: string, staffName: string): Dispatch {
  return {
    schemaVersion: SCHEMA_VERSION,
    facilityId: MOCK_FACILITY_ID,
    date,
    staffId,
    staffName,
    visits: [],
    residents: [],
    generatedAt: new Date().toISOString(),
  };
}

/** 実施済みとみなす時刻か。legacy の seed() の past 判定と同じ */
export function isPastVisit(date: string, endTime: string): boolean {
  const today = iso(new Date());
  if (date < today) return true;
  if (date > today) return false;
  const end = endTime.split(':').map(Number);
  const h = end[0] ?? 0;
  const m = end[1] ?? 0;
  return h * 60 + m < nowMin() - 5;
}

export { TASKS as MOCK_TASKS };
