/*
 * 未完了の訪問（マイタスク）。移植元: legacy/index.html:1345-1392、:3246-3455
 *
 * ── DOM を変えてはいけない箇所 ──────────────────────────
 * `.todo-head` / `.todo-row` は 118px 108px 1fr 104px 108px 200px の6カラムグリッド
 * （styles.css:452-454）。直下の子が span 6個であることに依存する。
 * ステージ2の行だけ `.todo-inline` が**7番目の子**として付き、`grid-column:1/-1`
 * でグリッドに直接参加する（:480）。フラグメントや div で包むと折り返さない。
 * `.todo-row + .todo-row` は隣接兄弟で行間を作る（:459）。
 *
 * ── legacy の仕様 ───────────────────────────────────────
 * ステージ判定は status を見るのは最初の1行だけで、あとは実績と特記事項の
 * 有無で決まる（legacy/index.html:3248-3254）。「済」でも特記事項が空なら
 * ステージ2として未完了に残る。
 * バッジは常に「自分の担当・本日まで」固定で、この画面の絞り込みと連動しない。
 */
import { useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import type { RecordFieldPatch } from '../../store/context';
import type { VisitRow } from '../../data/adapter';
import { blankRecordPrefs, isSupervisor } from '../../types/local';
import { todoStage } from '../../domain/visitStatus';
import { check, countNg } from '../../domain/compliance';
import { generateNote } from '../../domain/noteBuilder';
import { useSpeechInput, SPEECH_UNSUPPORTED_HINT } from '../../hooks/useSpeechInput';
import { MOOD_DEFAULT, MOOD_OPTIONS } from '../../domain/vocabulary';
import { iso } from '../../utils/date';

const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;
const LABEL = ['未着手', '対応中', '記録未完成'] as const;

function dowOf(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : DOW[d.getDay()] ?? '';
}

export function TodoModal() {
  const {
    panel, closePanel, visitRows, session, notify, retry,
    openRecord, setDate, setStaffId, stampStartAt, stampEndAt, updateRecordFields, getPrefs,
  } = useCareStore();
  const sup = isSupervisor(session);
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [range, setRange] = useState<'today' | 'only' | 'all'>('today');
  const [kind, setKind] = useState<'all' | '0' | '1' | '2'>('all');
  /*
   * 打鍵中のメモ。visitId ごとに持つ。
   *
   * 保存は onBlur でだけ行う。保存に成功すると dispatch / records / visitRows /
   * badges / staff / incidents が全部取り直されるため、1文字ごとに保存すると
   * 打つたびに全件再取得が走り、入力中の行ごと再描画されることになる
   */
  const [memoDraft, setMemoDraft] = useState<Record<string, string>>({});
  /** 生成中の行。legacy はボタンを disabled にして「作成中…」に差し替える（:3420） */
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  /** 行ごとのメモ入力欄。音声入力がカーソル位置を読むのに要る */
  const memoRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const speech = useSpeechInput();

  if (panel !== 'todo') return null;

  const all = visitRows.status === 'ready' ? visitRows.data : [];
  const today = iso(new Date());
  // legacy/index.html:3349-3350。サ責以外は自分固定
  const effScope = sup ? scope : 'me';

  const list = all.filter((r) => {
    const st = todoStage(r.visit, r.record);
    if (st < 0) return false;
    if (kind !== 'all' && st !== Number(kind)) return false;
    if (effScope === 'me' && r.staffId !== session?.staffId) return false;
    if (range === 'today' && r.date > today) return false;
    if (range === 'only' && r.date !== today) return false;
    return true;
  }).sort((a, b) => (a.date + a.visit.startTime).localeCompare(b.date + b.visit.startTime));

  /**
   * メモを保存する。変わっていなければ何もしない。
   * 保存できたら下書きを捨て、取り直した記録の値に戻す。
   * 失敗したら下書きを残す（打った内容を消さない）
   */
  async function saveMemo(visitId: string, saved: string) {
    const draft = memoDraft[visitId];
    if (draft === undefined || draft === saved) return;
    // legacy:3340 も保存時に trim する。末尾の空白は定型文の文型を変える
    const ok = await updateRecordFields(visitId, { memo: draft.trim() });
    if (!ok) return;
    setMemoDraft((m) => {
      const next = { ...m };
      delete next[visitId];
      return next;
    });
  }

  /*
   * 行内の「✨ 特記事項」。legacy/index.html:3418-3446。
   *
   * legacy は生成後に行の DOM を手書きで緑の「作成しました」に差し替えるが、
   * それをすると late クラスが落ち、曜日と実施内容が元の行と食い違い、件数表示も
   * 更新されない。Q6 の確定どおり、素直に再描画してトーストで伝える。
   * 本文が入るとステージが -1 になるので、行は一覧から消える。
   */
  async function generateFor(r: VisitRow) {
    // legacy は押した行のボタンだけを止める（:3420）。他の行は押せるまま
    if (generating.has(r.visit.visitId)) return;
    const record = r.record;
    if (record === undefined) { notify('記録がありません。'); return; }
    setGenerating((g) => new Set(g).add(r.visit.visitId));
    try {
      // legacy は todoSyncRow で行内の様子・メモを先に取り込んでから生成する（:3419）
      const pending = memoDraft[r.visit.visitId];
      const source = pending === undefined ? record : { ...record, memo: pending.trim() };
      const prefs = await getPrefs(r.visit.residentId).catch(() => blankRecordPrefs());
      const text = await generateNote({ record: source, plan: r.resident?.carePlan, prefs });
      const patch: RecordFieldPatch = { note: text, noteSource: 'template' };
      if (pending !== undefined) patch.memo = pending.trim();
      const ok = await updateRecordFields(r.visit.visitId, patch);
      if (!ok) return;
      const ng = countNg(check({ ...source, note: text }, r.resident?.carePlan));
      notify(ng > 0
        ? `作成しました（記載チェックで${ng}件の要修正）`
        : '特記事項を作成しました。内容をご確認ください');
    } finally {
      setGenerating((g) => {
        const n = new Set(g);
        n.delete(r.visit.visitId);
        return n;
      });
    }
  }

  /** 閉じるときに録音を止める。legacy は未完了一覧を閉じても止まらなかった */
  const closeTodo = () => { speech.stop(); closePanel(); };

  const counts = [0, 0, 0];
  list.forEach((r) => { const st = todoStage(r.visit, r.record); if (st >= 0 && st <= 2) counts[st] = (counts[st] ?? 0) + 1; });
  const late = list.filter((r) => r.date < today).length;

  return (
    <Modal
      title="未完了の訪問"
      subtitle={`${session ? `${session.name} さん` : ''}／終了まで済んでいない訪問をこの画面から記録できます`}
      onClose={closeTodo}
      width={1060}
      footer={
        <>
          <span className="sumline">{list.length ? 'この画面から打刻・記録の作成ができます。' : ''}</span>
          <div className="spacer"></div>
          <button className="bt" onClick={closeTodo}>閉じる</button>
        </>
      }
    >
      <div className="sec">
        <div className="grid4">
          <div className="fld"><label htmlFor="tScope">対象</label>
            <select id="tScope" value={effScope} disabled={!sup} onChange={(e) => setScope(e.target.value as 'me' | 'all')}>
              <option value="me">自分の担当</option><option value="all">全職員</option>
            </select></div>
          <div className="fld"><label htmlFor="tRange">期間</label>
            <select id="tRange" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="today">本日まで（積み残しを含む）</option>
              <option value="only">本日のみ</option>
              <option value="all">すべて（今後の予定も含む）</option>
            </select></div>
          <div className="fld"><label htmlFor="tKind">状態</label>
            <select id="tKind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">すべての未完了</option>
              <option value="0">未着手（実績なし）</option>
              <option value="1">対応中（終了時刻が未入力）</option>
              <option value="2">記録未完成（特記事項なし）</option>
            </select></div>
          <div className="fld"><label>&nbsp;</label>
            {/* 取得し直さずに「更新しました」と出すと、更新されていないことに気づけない */}
            <button className="ghost" style={{ width: '100%' }}
              onClick={() => { retry(); notify('最新の状態に更新しています…'); }}>最新の状態に更新</button></div>
        </div>
        <div className="rsum">
          <span className="k">未着手<b>{counts[0]}件</b></span>
          <span className="k">対応中<b>{counts[1]}件</b></span>
          <span className="k">記録未完成<b>{counts[2]}件</b></span>
          <span className="k" style={late ? { background: '#fff8e8', borderColor: '#f2dfb4', color: '#8a6412' } : undefined}>
            前日以前の積み残し<b>{late}件</b></span>
        </div>
      </div>

      <div className="sec">
        <h3>対象一覧 <span className="bchip">{list.length}件</span></h3>
        <div className="todo-head">
          <span>サービス提供日</span><span>時間</span><span>利用者／サービス</span>
          <span>担当職員</span><span>状態</span><span style={{ textAlign: 'right' }}>操作</span>
        </div>
        <div className="plist" style={{ maxHeight: 380 }}>
          {visitRows.status === 'loading' && <div className="todo-empty"><div className="ico">⏳</div>読み込んでいます…</div>}
          {/* 取得の失敗を 0件として出すと「すべて終了しています」と読めてしまう */}
          {visitRows.status === 'error' && (
            <div className="todo-empty"><div className="ico">⚠️</div>{visitRows.message}<br />
              <button className="mini" style={{ marginTop: 8 }} onClick={retry}>再試行</button>
            </div>
          )}
          {visitRows.status === 'ready' && (list.length === 0
            ? <div className="todo-empty"><div className="ico">✓</div>
                未完了の訪問はありません。<br />本日分の記録はすべて終了しています。</div>
            : list.map((r) => {
              const st = todoStage(r.visit, r.record);
              const a = r.record?.actualStart ?? '';
              const b = r.record?.actualEnd ?? '';
              const open = () => { closePanel(); setDate(r.date); setStaffId(r.staffId); openRecord(r.visit.visitId); };
              return (
                <div className={`todo-row ${r.date < today ? 'late' : ''}`} key={r.visit.visitId}>
                  <span className="dt">{r.date.replace(/-/g, '/')}（{dowOf(r.date)}）</span>
                  <span className="tm">{a ? `${a}〜${b || '—'}` : `予 ${r.visit.startTime}〜${r.visit.endTime}`}</span>
                  <span><span className="nm">{r.resident?.name ?? r.visit.residentId} 様</span>
                    <span className="sv">{r.visit.serviceName}
                      {(r.record?.tasks.length ?? 0) > 0 ? `／${r.record?.tasks.slice(0, 3).join('・')}` : ''}</span></span>
                  <span className="stf">{r.staffName}</span>
                  <span><span className={`tchip t${st}`}>{LABEL[st] ?? ''}</span></span>
                  <span className="todo-act">
                    {st === 0 && <button className="mini go" onClick={() => { void stampStartAt(r.visit.visitId); }}>開始</button>}
                    {st === 1 && <button className="mini stop" onClick={() => { void stampEndAt(r.visit.visitId); }}>終了</button>}
                    {st === 2 && (
                      <button className="mini" style={{ background: 'linear-gradient(120deg,#6a4bd6,#2b7ee6)', color: '#fff', border: 0 }}
                        disabled={generating.has(r.visit.visitId)}
                        onClick={() => { void generateFor(r); }}>
                        {generating.has(r.visit.visitId) ? '作成中…' : '✨ 特記事項'}</button>
                    )}
                    <button className="mini" onClick={open}>記録</button>
                  </span>
                  {/* ステージ2の行だけ 7番目の子として付く。grid-column:1/-1 で折り返す */}
                  {st === 2 && (
                    <div className="todo-inline">
                      {/* 選択肢は記録モーダルと同じ MOOD_OPTIONS。別々に書くと片方だけ増えて静かにずれる */}
                      <select title="ご本人の様子" value={r.record?.mood || MOOD_DEFAULT}
                        onChange={(e) => { void updateRecordFields(r.visit.visitId, { mood: e.target.value }); }}>
                        {MOOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <div className="memowrap">
                        <input className="memo" placeholder="メモ（任意）例：昼食を半分残された／膝の痛みの訴えあり"
                          ref={(el) => { memoRefs.current[r.visit.visitId] = el; }}
                          value={memoDraft[r.visit.visitId] ?? r.record?.memo ?? ''}
                          onChange={(e) => setMemoDraft((m) => ({ ...m, [r.visit.visitId]: e.target.value }))}
                          onBlur={() => { void saveMemo(r.visit.visitId, r.record?.memo ?? ''); }} />
                        {speech.supported && (
                          <button className={`micmini${speech.listening === r.visit.visitId ? ' rec' : ''}`}
                            title="メモを音声入力" aria-pressed={speech.listening === r.visit.visitId}
                            onClick={() => {
                              const id = r.visit.visitId;
                              if (speech.listening === id) {
                                /*
                                 * 止めたところで保存する。legacy は音声で入れた値に change が飛ばず、
                                 * 別の操作をするまで保存されなかった（結果として消えることがある）
                                 */
                                speech.stop();
                                void saveMemo(id, r.record?.memo ?? '');
                                return;
                              }
                              speech.start({
                                id,
                                el: memoRefs.current[id] ?? null,
                                onChange: (v) => setMemoDraft((m) => ({ ...m, [id]: v })),
                              });
                            }}>🎤</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            }))}
        </div>
        {/* legacy/index.html:1382。行ごとではなくモーダルに1つ。.on が無いと表示されない */}
        <div className={`mic-live${speech.listening !== null ? ' on' : ''}`} id="tLive" aria-live="polite">
          <b>🎤 認識中…</b> {speech.heard
            ? (speech.interim ? <span className="it">{speech.interim}</span> : '話しかけてください。')
            : '話し終わると自動で入力されます。'}
          <span className="tip">終了するときはもう一度ボタンを押してください。{speech.heard ? '' : '誤認識はそのまま手で修正できます。'}</span>
        </div>
        {/* legacy は非対応端末でボタンを黙って隠す（:3330）。理由を1行だけ出す（Q9） */}
        {!speech.supported && (counts[2] ?? 0) > 0 && <div className="aihint">{SPEECH_UNSUPPORTED_HINT}</div>}
      </div>
    </Modal>
  );
}
