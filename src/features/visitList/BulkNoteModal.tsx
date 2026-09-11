/*
 * 特記事項の一括作成。移植元: legacy/index.html:989-1046（マークアップ）、
 * :2805-2814（対象の絞り込み）、:2815-2854（描画）、:2877-2945（実行・中止）
 *
 * ── DOM を変えてはいけない箇所 ──────────────────────────
 * - `.bprog > .bar` は入れ子依存（styles.css:376-377）。幅で進捗を出す
 * - `.brow` は 22px 96px 1fr auto の4カラムグリッド（:378-381）。
 *   直下が `.ic` / `.tm` / ラッパ span / チップ用 span の4つであることに依存する
 * - `.chk input:checked + span` は隣接兄弟（:255）。input の直後が span でないと
 *   チェックの見た目が変わらない。input は opacity:0 なので完全に無反応に見える
 *
 * ── legacy から意図的に変えた点 ─────────────────────────
 * - AI を呼ばないため、「AI生成に失敗した記録は定型文で作成する」（:1028）は出さない。
 *   Phase 5 で AI を繋ぐときに戻す
 * - 並列実行は行わない。legacy も定型文モードでは同時実行数1（:2920 の pool(items, 1)）
 * - 行ごとの変更履歴（pushLog）は書かない。auditLog は Phase 1b の対象外
 */
import { useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { check, countNg } from '../../domain/compliance';
import { generateNote } from '../../domain/noteBuilder';
import { deriveStatus, newRecordFor } from '../../domain/visitStatus';
import { blankRecordPrefs, isSupervisor, type RecordPrefs } from '../../types/local';
import type { VisitRow } from '../../data/adapter';

/** 1件ごとの進み具合。legacy の bState（:2803）と同じ4状態 */
type RowState =
  | { st: 'wait' }
  | { st: 'run' }
  | { st: 'done'; ng: number }
  | { st: 'err'; msg: string };

/** legacy/index.html:2815 の bulkIcon */
function bulkIcon(st: RowState['st']): string {
  return st === 'done' ? '✓' : st === 'err' ? '✕' : st === 'run' ? '◍' : '○';
}

export function BulkNoteModal({ onClose }: { onClose: () => void }) {
  const {
    date, staffId, staff, visitRows, session, notify,
    updateRecordFields, getPrefs, openRecord, setDate, setStaffId,
  } = useCareStore();

  const sup = isSupervisor(session);
  // legacy/index.html:4243-4244。サ責・管理者以外は「表示中の職員のみ」に固定される
  const [scope, setScope] = useState<'staff' | 'all'>('staff');
  const [over, setOver] = useState<'skip' | 'over'>('skip');
  const [styleMode, setStyleMode] = useState<'profile' | 'fix'>('profile');
  const [tone, setTone] = useState<RecordPrefs['tone']>('polite');
  const [length, setLength] = useState<RecordPrefs['length']>('normal');
  const [incomplete, setIncomplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [summary, setSummary] = useState('');
  /*
   * 開始した時点の対象。legacy は bulkItems() の結果を掴んだまま描画し続ける（:2906 / :2920）。
   * 毎回いまの条件で数え直すと、作成した端から「未入力のみ」の条件に外れて
   * 行が消え、結果（✓・要修正の件数）が誰にも見えないまま終わる
   */
  const [frozen, setFrozen] = useState<VisitRow[] | null>(null);
  // 中止。実行中のループがその都度見る（legacy の bulkAbort、:2802）
  const abortRef = useRef(false);

  const effScope = sup ? scope : 'staff';
  const rows = visitRows.status === 'ready' ? visitRows.data : [];
  const staffName = staff.status === 'ready'
    ? staff.data.find((s) => s.staffId === staffId)?.name ?? ''
    : '';

  /*
   * 対象。legacy/index.html:2805-2814 とほぼ同じ条件。
   * 実施一覧の絞り込み（cur.filter）は見ない。画面で「未完」だけ表示していても対象は変わらない。
   *
   * ── legacy から意図的に変えた点 ────────────────────────
   * **承認済み（完了）は対象から外す。** legacy は含んでいたため、承認権限の無い職員でも
   * 承認済み記録の特記事項を一括で差し替えられた。RecordFieldPatch は承認欄を書き換えないので、
   * 承認者が確認していない本文に承認印が残ることになる。legacy は変更履歴に痕跡を残していたが、
   * Phase 1b では auditLog が対象外（Q1）なので痕跡すら残らない。
   * 承認済みの記録を作り直すときは、権限を検査する記録モーダルから行う。
   */
  const items: VisitRow[] = rows
    .filter((r) => r.date === date
      && (effScope === 'all' || r.staffId === staffId)
      && deriveStatus(r.visit, r.record) !== 'キャンセル'
      && deriveStatus(r.visit, r.record) !== '完了'
      && (incomplete || Boolean(r.record?.actualStart && r.record?.actualEnd))
      && (over === 'over' || !(r.record?.note ?? '')))
    .sort((a, b) => (a.visit.startTime + a.staffName).localeCompare(b.visit.startTime + b.staffName));

  // 作成条件を変えたら、前回の結果は捨てて数え直す（legacy:2893 の bState.clear()）
  const reset = () => { setFrozen(null); setStates({}); setDone(0); setSummary(''); };

  const shown = frozen ?? items;
  const pct = shown.length === 0 ? 0 : Math.round((done / shown.length) * 100);

  async function start() {
    if (busy) return;
    if (items.length === 0) { notify('対象の記録がありません'); return; }
    const go = window.confirm(
      `${items.length}件の特記事項を「定型文」で作成します。\n${over === 'over' ? '※既存の記入は上書きされます。\n' : ''}`
      + '\n作成された文章は下書きです。保存後、必ず内容をご確認ください。\n\n実行しますか？',
    );
    if (!go) return;

    abortRef.current = false;
    setFrozen(items);
    setBusy(true);
    setDone(0);
    setSummary('作成中…');
    setStates(Object.fromEntries(items.map((r) => [r.visit.visitId, { st: 'wait' } as RowState])));

    let ok = 0;
    let err = 0;
    let ngTotal = 0;
    let finished = 0;
    for (const r of items) {
      if (abortRef.current) break;
      setStates((m) => ({ ...m, [r.visit.visitId]: { st: 'run' } }));
      try {
        /*
         * 「実績時間が未入力の予定も対象にする」を選ぶと、まだ記録が1件も無い訪問が
         * 対象に入る。legacy は予定と記録が同じオブジェクトなので常に生成できた。
         * 保存側（updateRecordFields）も記録が無ければ配信から作るので、
         * 生成の入力も同じ初期値から作る
         */
        const record = r.record ?? newRecordFor(r.visit, r, r.resident);
        const prefs = await getPrefs(r.visit.residentId).catch(() => blankRecordPrefs());
        const used: RecordPrefs = styleMode === 'fix' ? { ...prefs, tone, length } : prefs;
        const text = await generateNote({ record, plan: r.resident?.carePlan, prefs: used });
        const saved = await updateRecordFields(r.visit.visitId, { note: text, noteSource: 'template' });
        if (!saved) throw new Error('保存できませんでした');
        const ng = countNg(check({ ...record, note: text }, r.resident?.carePlan));
        ngTotal += ng;
        ok += 1;
        setStates((m) => ({ ...m, [r.visit.visitId]: { st: 'done', ng } }));
      } catch (e) {
        // 1件失敗しても止めない。legacy も catch して次へ進む（:2929-2931）
        err += 1;
        setStates((m) => ({ ...m, [r.visit.visitId]: { st: 'err', msg: e instanceof Error ? e.message : 'エラー' } }));
      }
      finished += 1;
      setDone(finished);
    }

    // busy が真のままだと、閉じることも再実行もできなくなる
    setBusy(false);
    setSummary(`作成 ${ok}件${err ? ` ／ 失敗 ${err}件` : ''}${ngTotal ? ` ／ 要修正の指摘 ${ngTotal}件` : ''}`);
    notify(abortRef.current ? `中止しました（${ok}件作成）` : `${ok}件の特記事項を作成しました`);
  }

  return (
    <Modal
      title="特記事項の一括作成"
      subtitle={effScope === 'all' ? `${date} ／ 全職員` : `${date} ／ ${staffName} さん担当分`}
      // 作成中は閉じさせない。閉じても走り続け、結果が見えなくなる
      onClose={() => { if (busy) { notify('作成中です。中止する場合は「中止」を押してください'); return; } onClose(); }}
      width={780}
      footer={
        <>
          {busy && <button className="bt del" onClick={() => { abortRef.current = true; notify('中止しています…'); }}>中止</button>}
          <span className="sumline">{summary}</span>
          <div className="spacer"></div>
          <button className="bt save" disabled={busy} onClick={() => { void start(); }}>一括作成を開始</button>
        </>
      }
    >
      <div className="sec">
        <h3>作成条件</h3>
        <div className="grid2">
          <div className="fld"><label htmlFor="bScope">対象</label>
            <select id="bScope" value={effScope} disabled={!sup || busy}
              onChange={(e) => { setScope(e.target.value as 'staff' | 'all'); reset(); }}>
              <option value="staff">表示中の職員のみ</option>
              <option value="all">この日の全職員</option>
            </select></div>
          <div className="fld"><label htmlFor="bOver">すでに記入がある記録</label>
            <select id="bOver" value={over} disabled={busy}
              onChange={(e) => { setOver(e.target.value as 'skip' | 'over'); reset(); }}>
              <option value="skip">上書きしない（未入力のみ作成）</option>
              <option value="over">上書きして作り直す</option>
            </select></div>
        </div>
        <div className="grid3" style={{ marginTop: 12 }}>
          <div className="fld"><label htmlFor="bStyle">文体・分量</label>
            <select id="bStyle" value={styleMode} disabled={busy}
              onChange={(e) => setStyleMode(e.target.value as 'profile' | 'fix')}>
              <option value="profile">利用者ごとの設定に従う</option>
              <option value="fix">一括で指定する</option>
            </select></div>
          <div className="fld"><label htmlFor="bTone">文体</label>
            {/* legacy は「一括で指定する」を選ぶまで disabled（:1018 / :2894-2897） */}
            <select id="bTone" value={tone} disabled={styleMode !== 'fix' || busy}
              onChange={(e) => setTone(e.target.value as RecordPrefs['tone'])}>
              <option value="polite">です・ます調</option><option value="plain">である調</option>
            </select></div>
          <div className="fld"><label htmlFor="bLen">分量</label>
            <select id="bLen" value={length} disabled={styleMode !== 'fix' || busy}
              onChange={(e) => setLength(e.target.value as RecordPrefs['length'])}>
              <option value="short">簡潔</option><option value="normal">標準</option><option value="long">詳しく</option>
            </select></div>
        </div>
        {/* input の直後が span であること。.chk input:checked+span が効かなくなる */}
        <label className="chk" style={{ display: 'block', marginTop: 14 }}>
          <input type="checkbox" id="bIncomplete" checked={incomplete} disabled={busy}
            onChange={(e) => { setIncomplete(e.target.checked); reset(); }} /><span>実績時間が未入力の予定も対象にする</span>
        </label>
        <div className="warnbox" style={{ marginTop: 14 }} id="bWarn">
          定型文モードで <b>{shown.length}件</b> を作成します（オフライン・無料）。<br />
          ⚙設定でClaude AIに切り替えると、利用者ごとの計画・過去記録をふまえた文章になります。<br />
          <b>作成後は必ず担当者が内容を確認し、事実と相違がないか点検してください。</b>
        </div>
      </div>

      <div className="sec">
        <h3>対象一覧 <span className="bchip" id="bCount">{shown.length}件</span></h3>
        <div className="bprog"><div className="bar" id="bBar" style={{ width: `${pct}%` }}></div></div>
        <div className="plist" id="bList">
          {/*
            * 取得できていないことを「対象0件」と同じ見た目にすると、作成漏れに気づけない。
            * ただし実行中（frozen）は、保存のたびに走る再取得で行が消えないよう、
            * 掴んだ一覧をそのまま出し続ける
            */}
          {frozen === null && visitRows.status === 'loading' && (
            <div className="empty" style={{ padding: 26 }}><div className="ico">⏳</div><p>読み込んでいます…</p></div>
          )}
          {frozen === null && visitRows.status === 'error' && (
            <div className="empty" style={{ padding: 26 }}><div className="ico">⚠️</div><p>{visitRows.message}</p></div>
          )}
          {(frozen !== null || visitRows.status === 'ready') && (shown.length === 0
            ? (
              <div className="empty" style={{ padding: 26 }}><div className="ico">✓</div>
                <p>条件に合う記録はありません。<br />条件を変えるか、日付・職員を切り替えてください。</p>
              </div>
            )
            : shown.map((r) => {
              const s = states[r.visit.visitId] ?? { st: 'wait' };
              return (
                <div className={`brow ${s.st}`} key={r.visit.visitId} role="button" tabIndex={0}
                  onClick={() => {
                    if (busy) return;
                    onClose();
                    setDate(r.date);
                    setStaffId(r.staffId);
                    openRecord(r.visit.visitId);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}>
                  <span className="ic">{bulkIcon(s.st)}</span>
                  <span className="tm">{r.record?.actualStart || r.visit.startTime}〜{r.record?.actualEnd || r.visit.endTime}</span>
                  <span><span className="nm">{r.resident?.name ?? r.visit.residentId} 様</span>
                    <span className="stf">{r.staffName}／{r.visit.serviceName}</span></span>
                  <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {s.st === 'done' && <span className="bchip lc">定型文</span>}
                    {s.st === 'done' && (s.ng > 0
                      ? <span className="bchip ng">要修正 {s.ng}</span>
                      : <span className="bchip ok">指摘なし</span>)}
                    {s.st === 'err' && <span className="bchip ng">{s.msg.slice(0, 22)}</span>}
                  </span>
                </div>
              );
            }))}
        </div>
      </div>
    </Modal>
  );
}
