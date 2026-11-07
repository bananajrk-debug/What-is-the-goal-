// なにが目的なん？ ONLINE v18 — Express + Socket.io（サーバー権威型）
// v18：メンテナンス中にコードを更新（再起動）しても、メンテナンスが続くように（端末の署名つきの控えから復元）
// v17：管理者画面をタブ化・運営は誰の試合でも見えないように観戦できる・お知らせの自動復元（署名つきの控え）・NCは1分ごと＋増えたときに報告
// v16：NGワード・ブロック・NCの検算・端末情報（管理者用）・プロフィール・シーズン制ランキング・練習モード・PWA・プライバシーポリシー
// メンテナンスモード（再開時刻の表示とミニゲーム）・フィードバック（採用でNCプレゼント）・お詫びNC付きお知らせ・ロッカーのお気に入り／お知らせページ・管理者画面（ユーザー管理／利用停止／警告／個別メッセージ／全員へのお知らせ）・通報（5人以上で管理者に通知）／録音ボイス・全エモートの動き・ガチャ演出強化とラインナップ・季節報酬と殿堂チャリの豪華化・短い引き継ぎコード／タイトル画面とロゴ・季節報酬の飾りを手描きに・描画の軽量化・エンドレスランキングにコース表示／自転車の種類（ペニー・ファージング等）・フレンドの観戦・ガチャ演出・ショップ限定アイテム／坂道（上りはブーストしないと遅い）・ときどき道に泥（踏むと3秒スピードダウン）・ランキングは端末バックアップでも復元
// フレンドは承認制（申請 → 相手が承認してはじめて両方のリストに入る）
// 対戦（ルームロビー / CPU / フレンドのワンタップ参加）＋ ランクマッチ（チャリランク）＋ エンドレスラン ＋ ランキング ＋ チャット/エモート
// フレンドは「ユーザー名」で検索・追加。ユーザー名はサーバーの名簿（names.json）で重複しないように管理する
'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

/* ===== 共通定数 ===== */
const BASE = 110, HW = 112.5, LIMIT = 25, TICK = 1 / 30;
const OBS = { car: { w: 19, l: 26 }, bus: { w: 23, l: 58 }, cone: { w: 7, l: 7 }, cop: { w: 19, l: 27 } };
const BIKE_W = 5, BIKE_L = 10;
const COP_DX = 28, COP_BACK = -36, COP_FRONT = 40, COP_BLOCK = 70;
// 日本は左側通行：左2車線＝自分と同じ向き、右2車線＝対向車。車は自分の向きの車線しか走らない（逆走しない）
const SAME = [-84, -28], ONC = [28, 84], LANES = [-84, -28, 28, 84];
const STEER_ACC = 1500;  // 横移動の加速度（指の動きになめらかに追従）
const DRIFT = 0.28;      // カーブで外側へ流される強さ
const EMOTES = ['wave', 'thumbs', 'laugh', 'wheelie', 'dance', 'clap', 'bow', 'angry', 'cry', 'heart', 'sleep', 'gg',
  'think', 'shock', 'cool', 'peace', 'flex', 'fire', 'party', 'crowne', 'rocket', 'hofe', 'ramen', 'yoyu'];
const BOT_AFTER = 18;    // ランクマッチ：この秒数だけ相手が見つからなければランクCPUと対戦
const BOT_NAMES = ['チャリ太郎', 'ペダル姫', '坂道キング', 'ママチャリ番長', '立ちこぎ仮面', '風のミナト', 'ギア3速', 'サドル侍', '向かい風', 'ベル鳴らし'];
const CPU_LINES = ['よろしく！', '負けないよ', 'ナイス！', 'GG！', '手加減しないよ', 'まだまだ！', 'いいね！'];

/* ===== コースの形（クライアントと共通。[長さ, 曲がる角度(度)] の繰り返し） ===== */
const PATHS = [
  [[1400, 0], [900, 60], [1000, 0], [900, -60], [800, 0], [700, -40], [600, 0], [700, 40]],
  [[900, 0], [1000, 40], [500, 0], [1000, -70], [400, 0], [900, 50], [600, 0], [900, -20]],
  [[1200, 0], [1300, 90], [900, 0], [1300, -90], [700, 0]],
  [[700, 0], [500, -30], [300, 0], [500, 30], [900, 0], [600, 35], [300, 0], [600, -35]],
  [[600, 0], [650, 75], [200, 0], [650, -75], [300, 0], [500, -60], [150, 0], [500, 60], [400, 0], [700, 90], [250, 0], [700, -90]],
  [[700, 0], [600, 35], [500, 0], [600, -35], [800, 0], [500, -25], [600, 0], [500, 25]],
  [[600, 0], [600, 60], [300, 0], [600, -60], [500, 0], [700, 80], [300, 0], [700, -80]],
  [[800, 0], [900, 90], [600, 0], [900, -90], [500, 0]]
];
/* ===== 坂道（クライアントと共通。[開始位置, 上り長さ, 頂上の長さ, 下り長さ, 高さ]） ===== */
const HILLS = [[], [], [], [], [[1200, 600, 300, 600, 70]],
  [[600, 450, 500, 450, 55], [2900, 400, 300, 500, 70]],
  [[400, 700, 300, 600, 90], [2500, 600, 400, 700, 110]],
  [[300, 450, 300, 450, 60], [2200, 500, 250, 400, 75]]];
function elev(ci, s) {
  const hs = HILLS[ci]; if (!hs || !hs.length) return 0;
  const L = PATH[ci].L; let r = s % L; if (r < 0) r += L;
  let e = 0;
  for (const [s0, up, top, dn, h] of hs) {
    const u = r - s0;
    if (u < 0 || u > up + top + dn) continue;
    if (u < up) e += h * (1 - Math.cos(Math.PI * u / up)) / 2;
    else if (u < up + top) e += h;
    else e += h * (1 + Math.cos(Math.PI * (u - up - top) / dn)) / 2;
  }
  return e;
}
const grade = (ci, s) => (elev(ci, s + 6) - elev(ci, s - 6)) / 12;
// 坂による前進の倍率：上りはブーストしないと大きく遅くなる／下りは少し速い。泥の上は半分
function moveMul(R, p) {
  const g = grade(R.course || 0, p.z);
  let m = g > 0 ? (p.boost > 0 ? Math.max(0.82, 1 - g * 0.9) : Math.max(0.45, 1 - g * 2.6)) : 1 + Math.min(0.3, -g * 1.4);
  if (p.mud > 0) m *= 0.5;
  return m;
}
// 泥（ごくまれに道路に出る。踏むと3秒スピードダウン。ぶつかってもアウトにはならない）
const MUD_W = 15, MUD_L = 20, MUD_RATE = Number(process.env.MUD_RATE) || 1;   // 泥の出やすさ（テスト用。ふだんは1＝ごく稀）
function addMud(R, x, z) { if (!R.mud) R.mud = []; if (clearAt(R, x, z, MUD_W, MUD_L) && !R.mud.some(m => Math.abs(m.z - z) < 120)) R.mud.push({ id: R.nid++, x, z }); }
function mudCheck(R, i, p, dt) {
  if (p.mud > 0) p.mud = Math.max(0, p.mud - dt);
  for (const m of R.mud || []) if (Math.abs(m.x - p.x) < MUD_W + BIKE_W - 2 && Math.abs(m.z - p.z) < MUD_L + BIKE_L - 4) {
    if (p.mudId !== m.id) { if (!(p.mud > 0)) prog(R, i, 'mud'); p.mud = 3; p.mudId = m.id; }   // 踏んだ瞬間から3秒間
  }
}
const mudSnap = R => (R.mud || []).map(m => ({ id: m.id, x: r1(m.x), z: r1(m.z) }));
const PATH = PATHS.map(def => {
  let L = 0;
  const P = def.map(([len, deg]) => { const o = { s0: L, len, k: deg * Math.PI / 180 / len }; L += len; return o; });
  return { P, L };
});
function curv(ci, s) {
  const pa = PATH[ci] || PATH[0];
  let r = s % pa.L; if (r < 0) r += pa.L;
  for (const p of pa.P) if (r < p.s0 + p.len) return p.k;
  return 0;
}

const rooms = new Map();
const attOf = r => (r < 3 ? 0 : r < 6 ? 1 : r % 2);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = n => Math.round(n * 10) / 10;

/* ===== 入力値の検証（見た目データは性能に一切影響しない） ===== */
const clean = (v, def) => (typeof v === 'string' && /^[\w-]{1,24}$/.test(v)) ? v : def;
const cleanUid = v => (typeof v === 'string' && /^[\w-]{8,64}$/.test(v)) ? v : '';
const cleanFid = v => (typeof v === 'string' && /^F-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(v)) ? v : '';   // 旧フレンドID（v6）…移行のためだけに使う
const cleanPk = v => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v)) ? v : '';             // フレンド用の内部キー（端末UUIDのハッシュ。画面には出さない）
// ランキング用：ログインIDは外に出さず、秘密の鍵でハッシュした値（h）で本人を見分ける
const RANK_SECRET = process.env.RANK_SECRET || crypto.createHash('sha256').update('nm-rank:' + (process.env.RENDER_SERVICE_ID || '') + ':' + (process.env.RENDER_EXTERNAL_HOSTNAME || 'local')).digest('hex');
const hmac = t => crypto.createHmac('sha256', RANK_SECRET).update(t).digest('hex');
const hidCache = new Map();
const hidOf = id => { if (!id) return ''; let h = hidCache.get(id); if (!h) { h = hmac('h:' + id).slice(0, 16); if (hidCache.size > 5000) hidCache.clear(); hidCache.set(id, h); } return h; };
const same = (r, id) => !!id && r.h === hidOf(id);
// 署名（記録を出したコース c があるときはそれも含める。古いバックアップはそのまま有効）
const signE = (board, e) => hmac([board, e.h, e.name, board === 'run' ? e.score : e.rp, e.lv, e.ttl || '', e.ts].join('|') + (Number.isInteger(e.c) ? '|c' + e.c : '')).slice(0, 24);
const courseOk = c => Number.isInteger(c) && c >= 0 && c < PATHS.length;
const pkOf = uid => crypto.createHash('sha256').update('nm-friend:' + uid).digest('hex').slice(0, 16);
const isLoginId = v => typeof v === 'string' && /^NM-[\w-]{3,20}$/.test(v);
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').trim().slice(0, max) : '');
const cleanName = (v, def) => cleanText(v, 10) || def;
const cleanCourse = v => { v = parseInt(v, 10); return v >= 0 && v < PATHS.length ? v : 0; };
const look = (d, defName) => {
  d = (d && typeof d === 'object') ? d : {};
  return {
    name: cleanName(d.name, defName), skin: clean(d.skin, 'default'), hair: clean(d.hair, 'default'), fit: clean(d.fit, 'default'),
    acc: clean(d.acc, 'none'), trail: clean(d.trail, 'none'), bike: clean(d.bike, 'std'), lv: clamp(parseInt(d.lv, 10) || 1, 1, 99), pid: clean(d.id, ''),
    ttl: clean(d.ttl, 'rookie'), pl: clean(d.pl, 'normal'), rp: clamp(parseInt(d.rp, 10) || 0, 0, 99999), pk: ''
  };
};
// プレイヤーの見た目＋（名簿に登録された）ユーザー名。名前は送られてきた値ではなくサーバーの登録名を使う
const lookS = (sock, d, defName) => {
  const L = look(d, defName);
  L.name = (sock && sock.nmRegName) || ('ゲスト' + (sock ? sock.id.replace(/[^0-9]/g, '').slice(-3) || '0' : '0'));
  L.pk = (sock && sock.nmPk) || '';
  return L;
};

/* =====================================================================
   データの保存先
   - 環境変数 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN があれば Upstash Redis（無料枠あり）に保存
     → Render 無料プランのようにサーバーが再起動・スリープしても、名簿とランキングが消えない
   - なければ従来どおり JSON ファイル（再起動で消える環境では消えます）
   ===================================================================== */
const KV_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, ''), KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useKV = !!(KV_URL && KV_TOKEN);
const STORE = {
  async load(key, file) {
    if (useKV) {
      const r = await fetch(KV_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(['GET', 'nm:' + key]) });
      const j = await r.json(); if (j.error) throw new Error(j.error);
      return j.result ? JSON.parse(j.result) : null;
    }
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  },
  save(key, file, data, sync) {
    const body = JSON.stringify(data);
    if (useKV) {
      return fetch(KV_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(['SET', 'nm:' + key, body]) })
        .then(r => r.json()).then(j => { if (j.error) console.warn('保存エラー(' + key + '):', j.error); }).catch(e => console.warn('保存エラー(' + key + '):', e.message));
    }
    if (sync) { try { fs.writeFileSync(file, body); } catch (e) { console.warn('保存エラー(' + key + '):', e.message); } return Promise.resolve(); }
    fs.writeFile(file, body, err => { if (err) console.warn('保存エラー(' + key + '):', err.message); });
    return Promise.resolve();
  }
};
// まとめて保存（3秒ごと）。サーバーが止められるとき（再起動・スリープ）は、待っている保存をすぐ書き出す
const PENDING = new Map();
const saver = (key, file, get, ms) => { let t = null; return () => { if (t) return; PENDING.set(key, () => { clearTimeout(t); t = null; PENDING.delete(key); return STORE.save(key, file, get(), true); }); t = setTimeout(() => { t = null; PENDING.delete(key); STORE.save(key, file, get()); }, ms || 3000); }; };
let stopping = false;
async function flushAndExit(sig) {
  if (stopping) return; stopping = true;
  const jobs = [...PENDING.values()].map(f => f());
  if (jobs.length) console.log(sig + ': 保存してから終了します（' + jobs.length + '件）');
  await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 4000))]);
  process.exit(0);
}
process.on('SIGTERM', () => flushAndExit('SIGTERM'));
process.on('SIGINT', () => flushAndExit('SIGINT'));

/* =====================================================================
   ユーザー名の名簿（重複禁止）：正規化したキー → { name, pk, uid }
   全角/半角・大文字/小文字・ひらがな/カタカナの違いは同じ名前として扱う
   ===================================================================== */
const NAMES_FILE = process.env.NAMES_FILE || path.join(__dirname, 'names.json');
const nameReg = new Map();   // key -> { name, pk, uid, ts }
const pkKey = new Map();     // pk  -> key
const nkey = n => String(n).normalize('NFKC').toLowerCase().replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/\s+/g, '');
function validName(v) {
  if (typeof v !== 'string') return '';
  const n = v.normalize('NFKC').trim(), len = [...n].length;
  if (len < 2 || len > 10) return '';
  if (!/^[\p{L}\p{N}ー・_\-]+$/u.test(n)) return '';
  return n;
}
const RESERVED = new Set(['CPU', 'プレイヤー', 'プレイヤー2', 'ゲスト', '運営', '管理者', '公式', 'admin', 'administrator', 'system', 'システム', 'moderator', 'GM', 'なにが目的なん'].concat(BOT_NAMES).map(nkey));
function loadNames(j) { if (Array.isArray(j)) for (const e of j) if (e && validName(e.name) && cleanPk(e.pk) && cleanUid(e.uid)) { const k = nkey(e.name); if (!nameReg.has(k)) { nameReg.set(k, e); pkKey.set(e.pk, k); } } }
const saveNames = saver('names', NAMES_FILE, () => [...nameReg.values()]);
function nameProblem(n, uid) {            // 使えない理由（使えるなら空文字）
  if (!n) return 'invalid';
  const k = nkey(n);
  if (RESERVED.has(k) || /^ゲスト/.test(n)) return 'reserved';
  if (ngHit(n)) return 'ng';   // NGワード入りの名前は使えない
  const e = nameReg.get(k);
  if (e && e.uid !== uid) return 'taken';
  return '';
}
function claimName(n, uid, pk) {          // 1アカウント1名前：古い名前は手放す
  const k = nkey(n), old = pkKey.get(pk);
  if (old && old !== k) { const oe = nameReg.get(old); if (oe && oe.uid === uid) nameReg.delete(old); }
  nameReg.set(k, { name: n, pk, uid, ts: Date.now() }); pkKey.set(pk, k); saveNames();
}
function suggestName() {
  const pre = ['ライダー', 'チャリ', 'ペダル', 'サドル', 'ギア', 'ベル', 'タイヤ', 'ハンドル'];
  for (let i = 0; i < 50; i++) { const n = pre[Math.floor(Math.random() * pre.length)] + Math.floor(100 + Math.random() * (i < 25 ? 900 : 9900)); if (!nameReg.has(nkey(n))) return n; }
  return 'ライダー' + Date.now().toString().slice(-6);
}
const nameOfPk = pk => { const k = pkKey.get(pk), e = k && nameReg.get(k); return e ? e.name : ''; };

/* ===== ランキング（ranking.json に保存） ===== */
const RANK_FILE = process.env.RANK_FILE || path.join(__dirname, 'ranking.json');
let ranking = [];
function loadRanking(j) { if (Array.isArray(j)) ranking = j.filter(r => r && (typeof r.id === 'string' || typeof r.h === 'string') && Number.isFinite(r.score)).map(r => Object.assign(r, { h: r.h || hidOf(r.id) })).sort((a, b) => b.score - a.score).slice(0, 100); }
const saveRanking = saver('ranking', RANK_FILE, () => ranking);
function submitScore(id, name, score, lv, c) {
  if (!id) return { best: score, rank: 0, improved: false };
  const h = hidOf(id), i = ranking.findIndex(r => r.h === h);
  let best = score, improved = false;
  if (i >= 0) {
    if (score > ranking[i].score) { ranking[i] = { h, name, score, lv, c, ts: Date.now() }; improved = true; }
    else { best = ranking[i].score; ranking[i].name = name; ranking[i].lv = lv; }
  } else { ranking.push({ h, name, score, lv, c, ts: Date.now() }); improved = true; }
  ranking.sort((a, b) => b.score - a.score);
  ranking = ranking.slice(0, 100);
  saveRanking();
  return { best, rank: ranking.findIndex(r => r.h === h) + 1, improved };
}
// 公開するランキングにはログインIDを含めない（自分の行だけ me:true を付ける）
const topN = (n, me) => ranking.slice(0, n).map(r => ({ name: r.name, score: r.score, lv: r.lv || 1, c: courseOk(r.c) ? r.c : undefined, me: same(r, me) }));   // c=記録を出したコース
// チャリランク（RP）ランキング：ランクマッチ終了直後の1回だけ報告を受け付け、1試合で増やせる量にも上限をかける
const RP_FILE = process.env.RP_FILE || path.join(__dirname, 'ranking_rp.json');
let rpBoard = [];
function loadRp(j) { if (Array.isArray(j)) rpBoard = j.filter(r => r && (typeof r.id === 'string' || typeof r.h === 'string') && Number.isFinite(r.rp)).map(r => Object.assign(r, { h: r.h || hidOf(r.id) })).sort((a, b) => b.rp - a.rp).slice(0, 100); }
const saveRp = saver('rp', RP_FILE, () => rpBoard);
/* ===== フレンド申請（承認制）：申請と「承認された／取り消された」のお知らせを保存（相手がオフラインでも届く） ===== */
const FR_FILE = process.env.FRIENDS_FILE || path.join(__dirname, 'friends.json');
const freq = new Map();    // 申請先pk -> Map(申請元pk -> ts)
const fnote = new Map();   // pk -> [{t:'acc'|'dec'|'rm', pk, ts}]  まだ受け取っていないお知らせ
function loadFriends(j) {
  if (!j || typeof j !== 'object') return;
  for (const [to, list] of (Array.isArray(j.req) ? j.req : [])) if (cleanPk(to) && Array.isArray(list)) freq.set(to, new Map(list.filter(x => Array.isArray(x) && cleanPk(x[0])).slice(0, 50)));
  for (const [pk, list] of (Array.isArray(j.note) ? j.note : [])) if (cleanPk(pk) && Array.isArray(list)) fnote.set(pk, list.filter(n => n && cleanPk(n.pk)).slice(-50));
}
const saveFriends = saver('friends', FR_FILE, () => ({ req: [...freq].map(([k, m]) => [k, [...m]]), note: [...fnote] }));

// 保存先が消えた後（ファイル保存で再起動したとき）は、つないできたプレイヤーの端末の記録からランキングを作り直す
// 名前を変えたら、ランキングの表示名も新しい名前に
// 外部DBなしでサーバーの記録が消えていた場合は、本人の端末に残る自己ベストからも戻す
function restoreBoards(id, name, best, rp, lv, ttl, bc) {
  if (!id || !name) return;
  const h = hidOf(id), r = ranking.find(x => x.h === h), q = rpBoard.find(x => x.h === h);
  if (r) { if (r.name !== name) { r.name = name; saveRanking(); } }
  else if (!useKV && best > 0) { ranking.push({ h, name, score: best, lv, c: courseOk(bc) ? bc : undefined, ts: Date.now() }); ranking.sort((a, b) => b.score - a.score); ranking = ranking.slice(0, 100); saveRanking(); }
  if (q) { if (q.name !== name) { q.name = name; saveRp(); } }
  else if (!useKV && rp > 0 && restoreBoards.season === SEASON.id) { rpBoard.push({ h, name, rp, lv, ttl, ts: Date.now() }); rpBoard.sort((a, b) => b.rp - a.rp); rpBoard = rpBoard.slice(0, 100); saveRp(); }
}
function submitRp(id, name, rp, lv, ttl) {
  const h = hidOf(id), i = rpBoard.findIndex(r => r.h === h);
  if (i >= 0) { rp = Math.min(rp, rpBoard[i].rp + 60); rpBoard[i] = { h, name, rp, lv, ttl, ts: Date.now() }; }
  else rpBoard.push({ h, name, rp, lv, ttl, ts: Date.now() });
  rpBoard.sort((a, b) => b.rp - a.rp); rpBoard = rpBoard.slice(0, 100); saveRp();
  return rpBoard.findIndex(r => r.h === h) + 1;
}
/* ===== ランキングの端末バックアップ（サーバーの署名つき）
   サーバーが再起動して保存データが消えても、プレイヤーの端末に残っている「署名つきのランキング」を
   受け取って復元する。署名はサーバーしか作れないので、書き換えたデータは受け付けない。 ===== */
const entryOut = (board, e) => { const o = { h: e.h, name: e.name, lv: e.lv || 1, ttl: e.ttl || '', ts: e.ts || 0 }; if (board === 'run') { o.score = e.score; if (courseOk(e.c)) o.c = e.c; } else o.rp = e.rp; o.sig = signE(board, o); return o; };
function restoreSigned(board, list) {
  if (!Array.isArray(list)) return 0;
  const arr = board === 'run' ? ranking : rpBoard, key = board === 'run' ? 'score' : 'rp';
  let n = 0;
  for (const it of list.slice(0, 150)) {
    if (!it || typeof it.h !== 'string' || !/^[0-9a-f]{16}$/.test(it.h) || typeof it.name !== 'string' || !Number.isFinite(it[key]) || !Number.isFinite(it.ts)) continue;
    const e = { h: it.h, name: cleanName(it.name, 'プレイヤー'), lv: clamp(parseInt(it.lv, 10) || 1, 1, 99), ttl: clean(it.ttl, ''), ts: it.ts, [key]: it[key] };
    if (board === 'run' && it.c != null) { if (!courseOk(it.c)) continue; e.c = it.c; }
    if (board === 'rp' && SEASON.id && it.ts < seasonStart(SEASON.id)) continue;   // 前のシーズンの記録は戻さない
    if (e.name !== it.name || typeof it.sig !== 'string' || it.sig !== signE(board, Object.assign({}, e, { ttl: it.ttl || '' }))) continue;
    const cur = arr.find(x => x.h === e.h);
    if (!cur) { arr.push(e); n++; }
    else if (board === 'run' ? e.score > cur.score : e.ts > (cur.ts || 0)) { Object.assign(cur, e); n++; }
  }
  if (n) {
    if (board === 'run') { ranking.sort((a, b) => b.score - a.score); ranking = ranking.slice(0, 100); saveRanking(); }
    else { rpBoard.sort((a, b) => b.rp - a.rp); rpBoard = rpBoard.slice(0, 100); saveRp(); }
  }
  return n;
}
const myEntry = (board, id) => { const h = hidOf(id), e = (board === 'run' ? ranking : rpBoard).find(x => x.h === h); return e ? entryOut(board, e) : null; };
const rpTop = (n, me) => rpBoard.slice(0, n).map(r => ({ name: r.name, rp: r.rp, lv: r.lv || 1, ttl: r.ttl || 'rookie', me: same(r, me) }));
app.get('/api/ping', (req, res) => res.json({ ok: true }));
app.get('/api/ranking', (req, res) => res.json({ top: topN(50), rp: rpTop(50) }));
app.get('/api/sounds', (req, res) => {
  fs.readdir(path.join(__dirname, 'public', 'sounds'), (err, list) => {
    res.json({ files: err ? [] : list.filter(f => /^[\w-]+\.(mp3|m4a|ogg|wav)$/i.test(f)) });
  });
});

/* =====================================================================
   障害物（車線を守る交通AI：追い越し・減速・車間距離。すり抜けなし）
   ===================================================================== */
function addObs(R, k, x, z, v0, dir, c) {
  const s = OBS[k];
  const o = { id: R.nid++, k, x, z, d: dir, v0, vz: v0 * dir, c: c || 0, w: s.w, l: s.l, passed: false, cp: {}, tx: null, lock: 0 };
  R.obs.push(o);
  return o;
}
const clearAt = (R, x, z, w, l) => !R.obs.some(q => Math.abs(q.x - x) < q.w + w + 4 && Math.abs(q.z - z) < q.l + l + 40);
const hitObs = (o, p) => Math.abs(o.x - p.x) < o.w + BIKE_W && Math.abs(o.z - p.z) < o.l + BIKE_L;
const nearestLane = (x, lanes) => lanes.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a);
const laneIdx = x => LANES.indexOf(nearestLane(x, LANES));
function copRule(o, p, isAtt) {
  const dx = Math.abs(o.x - p.x), gap = p.z - o.z;
  if (dx < COP_DX && gap > COP_BACK && gap < COP_FRONT) return true;               // 接触・割り込み
  if (isAtt && p.brk > 0 && dx < 30 && gap > 0 && gap < COP_BLOCK) return true;   // 急ブレーキで通行妨害
  return false;
}
function laneOpen(R, o, lx, riders) {
  for (const q of R.obs) {
    if (q === o || Math.abs(q.x - lx) >= o.w + q.w + 2) continue;
    const d = (q.z - o.z) * o.d;
    if (d > -(o.l + q.l + 60) && d < o.l + q.l + 170) return false;
  }
  for (const p of riders) {     // 自転車のすぐ前に割り込まない（理不尽な接触を防ぐ）
    if (!p || Math.abs(p.x - lx) >= o.w + BIKE_W + 16) continue;
    const d = (p.z - o.z) * o.d;
    if (d > -(o.l + 40) && d < o.l + 240) return false;
  }
  return true;
}
function separate(R, riders) {
  const vs = R.obs;
  for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) {
    const o = vs[a], q = vs[b];
    if (Math.abs(o.x - q.x) >= o.w + q.w - 1) continue;
    const lim = o.l + q.l + 2;
    if (Math.abs(q.z - o.z) >= lim) continue;
    let front, back;
    if (o.k === 'cone') { front = o; back = q; }
    else if (q.k === 'cone') { front = q; back = o; }
    else if (o.d === q.d) { if ((q.z - o.z) * o.d > 0) { front = q; back = o; } else { front = o; back = q; } }
    else continue;
    if (back.k === 'cone') continue;
    back.z = front.z - back.d * lim;
    if (back.vz * back.d > front.vz * back.d) back.vz = front.vz;
  }
  // 同じ向きの車は自転車に後ろから突っ込まない（パトカーを除く）
  for (const o of vs) {
    if (o.k === 'cone' || o.k === 'cop' || o.d < 0) continue;
    for (const p of riders) {
      if (!p || Math.abs(o.x - p.x) >= o.w + BIKE_W) continue;
      const g = p.z - o.z;
      if (g > 0 && g < o.l + BIKE_L + 1) { o.z = p.z - (o.l + BIKE_L + 1); if (o.vz > p.v) o.vz = p.v; }
    }
  }
}
function traffic(R, dt, riders) {
  for (const o of R.obs) {
    if (o.k === 'cone') continue;
    const dir = o.d;
    let gap = 1e9, leadV = 0, found = false;
    const chk = (qx, qz, qw, ql, qv) => {
      if (Math.abs(qx - o.x) >= o.w + qw - 2) return;
      const d = (qz - o.z) * dir - (o.l + ql);
      if (d > -(o.l + ql) && d < gap) { gap = d; leadV = qv * dir; found = true; }
    };
    for (const q of R.obs) if (q !== o) chk(q.x, q.z, q.w, q.l, q.vz);
    if (dir > 0 && o.k !== 'cop') for (const p of riders) if (p) chk(p.x, p.z, BIKE_W, BIKE_L, p.v);
    let target = o.v0;
    if (found && gap < 260 && leadV < o.v0 - 3) {
      if (o.k !== 'bus' && !o.lock && o.tx == null) {           // 遅い車がいたら隣の車線へ追い越し
        const lanes = dir > 0 ? SAME : ONC, cur = nearestLane(o.x, lanes);
        const alt = lanes.find(l => l !== cur && laneOpen(R, o, l, riders));
        if (alt != null) { o.tx = alt; o.lock = 2; }
      }
      target = Math.min(target, Math.max(0, leadV + Math.max(0, gap - 12) * 1.4)); // 追い越せなければ減速して車間をとる
    }
    const cur = o.vz * dir;
    o.vz = (cur + clamp(target - cur, -340 * dt, 150 * dt)) * dir;
    if (o.tx != null) {
      const dx = o.tx - o.x, st = (o.k === 'cop' ? 120 : 70) * dt;
      o.x += clamp(dx, -st, st);
      if (Math.abs(dx) < 0.6) { o.x = o.tx; o.tx = null; }
    }
    if (o.lock) o.lock = Math.max(0, o.lock - dt);
  }
  for (const o of R.obs) o.z += o.vz * dt;
  separate(R, riders);
}
const obsSnap = R => (R.obs || []).map(o => ({ id: o.id, k: o.k, x: r1(o.x), z: r1(o.z), c: o.c, vz: r1(o.vz), d: o.d }));

/* ===== 自転車の横移動（アナログ入力＋加速度でなめらかに） ===== */
const inS = inp => (inp && Number.isFinite(inp.s)) ? clamp(inp.s, -1, 1) : ((inp && inp.r) ? 1 : 0) - ((inp && inp.l) ? 1 : 0);
function steerRider(R, p, inp, maxV, dt) {
  const tv = inS(inp) * maxV;
  p.vx = (p.vx || 0) + clamp(tv - (p.vx || 0), -STEER_ACC * dt, STEER_ACC * dt);
  const drift = -curv(R.course, p.z) * p.v * p.v * DRIFT;
  const nx = clamp(p.x + (p.vx + drift) * dt, -HW + 14, HW - 14);
  if ((nx <= -HW + 14 && p.vx < 0) || (nx >= HW - 14 && p.vx > 0)) p.vx = 0;
  p.x = nx;
}
function prog(R, i, k, extra) { if (R.ids[i]) io.to(R.ids[i]).emit('prog', Object.assign({ k, cpu: !!R.isCpu }, extra || {})); }
function copPasses(R) {
  for (const o of R.obs) if (o.k === 'cop') R.P.forEach((p, i) => {
    if (p && !o.cp[i] && o.z - o.l > p.z + BIKE_L) { o.cp[i] = 1; prog(R, i, 'cop_pass'); }
  });
}

/* =====================================================================
   対戦モード（攻守交代・4ポイント先取・サドンデス）
   ===================================================================== */
const mkRider = (R, i, x, z) => ({ x, z, v: BASE, vx: 0, brk: 0, brakes: 3, boost: 0, cd: 0, bike: R.bikes[i], skin: R.skins[i], hair: R.hairs[i], fit: R.fits[i], acc: R.accs[i], trail: R.trails[i] });
function newRound(R) {
  R.att = attOf(R.round);
  const d = 1 - R.att;
  R.P = [];
  R.P[R.att] = mkRider(R, R.att, rnd(-30, 30), 60);
  R.P[d] = mkRider(R, d, rnd(-30, 30), 0);
  R.obs = []; R.mud = []; R.nid = 1; R.fx = null;
  R.inp = [{ s: 0 }, { s: 0 }];
  R.act = [false, false]; R.actK = [null, null];
  R.state = 'count'; R.timer = 3; R.el = 0;
  R.nextCar = rnd(1.6, 3);
  R.patrolAt = Math.random() < 0.7 ? rnd(5, 12) : 1e9;
  R.msg = ''; R.sub = '';
}
function resetMatch(R) { R.sc = [0, 0]; R.hist = []; R.round = 0; newRound(R); }
function endRound(R, w, pen, text) {
  if (w >= 0) {
    R.sc[w]++;
    if (R.ids[w]) { io.to(R.ids[w]).emit('reward', { gain: 10, ov: text === '追い抜き成功！' }); ecoAddSid(R.ids[w], 10); }
  }
  if (pen >= 0) R.sc[pen] = Math.max(0, R.sc[pen] - 1);
  for (const i of [0, 1]) prog(R, i, 'round', { win: w === i, dist: Math.max(0, Math.floor((R.P[i] ? R.P[i].z : 0) / 10)) });
  R.hist.push(w);
  R.msg = w >= 0 ? 'POINT GET!' : 'DRAW';
  R.sub = (w >= 0 ? R.names[w] + '  ' : '') + text;
  R.state = 'result'; R.timer = 2.8;
}
function afterResult(R) {
  const w = R.hist[R.hist.length - 1];
  if (w >= 0 && (R.sc[w] >= 4 || R.round >= 6)) {
    R.state = 'match';
    R.msg = 'MATCH WINNER: ' + R.names[w];
    R.sub = R.round >= 6 ? 'サドンデス決着' : '';
    for (const i of [0, 1]) {
      prog(R, i, 'match', { win: w === i, ranked: !!R.ranked, bot: !!R.bot, oppRp: R.rps[1 - i] || 0 });
      const sk = R.ranked && R.ids[i] && io.sockets.sockets.get(R.ids[i]); if (sk) sk.rkOk = true;   // RPランキングへの報告を1回だけ許可
    }
    return;
  }
  R.round++; newRound(R);
}
function updateCpuInp(R) {
  if (!R.isCpu || R.state !== 'play') return;
  const cpuSlot = 1, cpuP = R.P[cpuSlot], playerP = R.P[0];
  if (!cpuP) return;
  let targetX = cpuP.x;
  const sk = R.skill == null ? 0.5 : R.skill;   // ランクCPUは相手のランクが高いほど上手くなる
  const ahead = R.obs.filter(o => o.k !== 'cop' && (o.z - cpuP.z) > -20 && o.z - cpuP.z < 200 + sk * 160 && Math.abs(o.x - cpuP.x) < 60);
  const cop = R.obs.find(o => o.k === 'cop' && o.z < cpuP.z + 30 && cpuP.z - o.z < 320);
  if (cop && Math.abs(cop.x - cpuP.x) < 46) {
    targetX = cop.x > cpuP.x ? cop.x - 66 : cop.x + 66;
    if (Math.abs(targetX) > HW - 14) targetX = cop.x > cpuP.x ? cop.x + 66 : cop.x - 66;
  } else if (ahead.length) {
    ahead.sort((a, b) => a.z - b.z);
    const dg = ahead[0];
    if (Math.abs(dg.x - cpuP.x) < 36) targetX = dg.x > 0 ? dg.x - 60 : dg.x + 60;
  } else if ((R.mud || []).some(m => m.z - cpuP.z > 0 && m.z - cpuP.z < 140 + sk * 80 && Math.abs(m.x - cpuP.x) < 30)) {
    const m = R.mud.find(m => m.z - cpuP.z > 0 && m.z - cpuP.z < 140 + sk * 80 && Math.abs(m.x - cpuP.x) < 30);
    targetX = m.x > cpuP.x ? m.x - 45 : m.x + 45;
  } else if (playerP) {
    if (R.att === cpuSlot) targetX = playerP.x + Math.sin(R.el * 3) * 45;
    else targetX = (playerP.z - cpuP.z) < 50 ? playerP.x + (playerP.x > 0 ? -50 : 50) : playerP.x;
  }
  targetX = clamp(targetX, -HW + 14, HW - 14);
  R.inp[cpuSlot] = { s: clamp((targetX - cpuP.x) / (52 - sk * 22), -1, 1) };
  if (R.el >= 3) {
    if (R.att === cpuSlot) {
      if (!cop && playerP && Math.abs(playerP.x - cpuP.x) < 26 + sk * 10 && (cpuP.z - playerP.z) < 30 + sk * 20 && cpuP.brakes > 0 && cpuP.brk <= 0 && Math.random() < 0.15 + sk * 0.35) R.act[cpuSlot] = true;
    } else if (cpuP.cd <= 0 && cpuP.boost <= 0) {
      // 上手いCPUは前の攻撃側と横にずれたタイミングでブースト
      if (sk < 0.45 || !playerP || Math.abs(playerP.x - cpuP.x) > 34 - sk * 10 || Math.random() < 0.03) R.act[cpuSlot] = true;
    }
  }
}
function step(R, dt) {
  if (R.state === 'count') { R.timer -= dt; if (R.timer <= 0) R.state = 'play'; return; }
  if (R.state === 'result') { R.timer -= dt; if (R.timer <= 0) afterResult(R); return; }
  if (R.state !== 'play') return;
  R.el += dt;
  if (R.isCpu) updateCpuInp(R);

  const att = R.att, d = 1 - att, A = R.P[att], B = R.P[d];
  if (!A || !B) return;
  steerRider(R, A, R.inp[att], 285, dt);
  steerRider(R, B, R.inp[d], 230, dt);
  if (R.el >= 3) {
    if (R.act[att] && A.brakes > 0 && A.brk <= 0) { A.brakes--; A.brk = 0.8; prog(R, att, 'brake'); }
    if (R.act[d] && B.cd <= 0 && B.boost <= 0) { B.boost = 1; B.cd = 3.5; prog(R, d, 'boost'); }
  }
  R.act = [false, false];
  if (A.brk > 0) { A.v = Math.max(0, A.v - 800 * dt); A.brk -= dt; } else A.v = Math.min(BASE, A.v + 120 * dt);
  if (B.boost > 0) { B.v = Math.min(220, B.v + 600 * dt); B.boost -= dt; } else B.v = Math.max(BASE, B.v - 300 * dt);
  B.cd = Math.max(0, B.cd - dt);
  mudCheck(R, att, A, dt); mudCheck(R, d, B, dt);
  A.mm = moveMul(R, A); B.mm = moveMul(R, B);
  A.z += A.v * A.mm * dt; B.z += B.v * B.mm * dt;

  const front = Math.max(A.z, B.z), back = Math.min(A.z, B.z);
  R.nextCar -= dt;
  if (R.nextCar <= 0) {
    R.nextCar = rnd(2, 3.6);
    if (Math.random() < 0.06 * MUD_RATE) addMud(R, LANES[Math.floor(Math.random() * 4)] + rnd(-12, 12), front + rnd(460, 600));   // ごくまれに泥
    if (Math.random() < 0.62) {
      const x = ONC[Math.random() < 0.5 ? 0 : 1] + rnd(-6, 6), z = front + rnd(560, 660);
      if (clearAt(R, x, z, 19, 26)) addObs(R, 'car', x, z, rnd(70, 110), -1, Math.floor(rnd(0, 6)));
    } else {
      const x = SAME[Math.random() < 0.5 ? 0 : 1] + rnd(-6, 6), z = front + rnd(420, 560);
      if (clearAt(R, x, z, 19, 26)) addObs(R, 'car', x, z, rnd(40, 65), 1, Math.floor(rnd(0, 6)));
    }
  }
  if (R.el >= R.patrolAt) { R.patrolAt = 1e9; addObs(R, 'cop', SAME[Math.random() < 0.5 ? 0 : 1], back - 260, 175, 1); }
  traffic(R, dt, R.P);
  R.obs = R.obs.filter(o => o.z > back - 360 && o.z < front + 900);
  R.mud = (R.mud || []).filter(m => m.z > back - 200);
  copPasses(R);

  const lost = [null, null];
  for (const o of R.obs) for (const i of [0, 1]) {
    const p = R.P[i];
    if (o.k === 'cop') { if (copRule(o, p, i === att)) lost[i] = 'cop'; }
    else if (hitObs(o, p)) lost[i] = lost[i] || 'car';
  }
  if (lost[0] && lost[1]) { R.fx = { who: [0, 1], kind: lost[0] }; return endRound(R, -1, -1, '相打ち！'); }
  for (const i of [0, 1]) if (lost[i]) {
    R.fx = { who: [i], kind: lost[i] };
    return lost[i] === 'cop'
      ? endRound(R, 1 - i, i, R.names[i] + ' パトカー違反で逮捕！(-1pt)')
      : endRound(R, 1 - i, -1, R.names[i] + ' 車と衝突！');
  }
  const gap = A.z - B.z, dx = Math.abs(A.x - B.x);
  if (dx < 22 && gap < 18 && gap > -12) { R.fx = { who: [d], kind: 'bike' }; prog(R, att, 'brake_hit'); return endRound(R, att, -1, '攻撃側に激突！'); }
  if (B.z > A.z + 12) { prog(R, d, 'overtake'); return endRound(R, d, -1, '追い抜き成功！'); }
  if (R.el >= LIMIT) endRound(R, att, -1, 'ブロック成功(時間切れ)');
}
function riderSnap(p) {
  return { x: r1(p.x), z: r1(p.z), v: r1(p.v * (p.mm || 1)), mud: p.mud > 0 ? r1(p.mud) : 0, vx: r1(p.vx || 0), brk: p.brk > 0 ? 1 : 0, brakes: p.brakes, boost: p.boost > 0 ? 1 : 0, cd: r1(p.cd), bcd: r1(p.bcd || 0), bike: p.bike, skin: p.skin, hair: p.hair, fit: p.fit, acc: p.acc, trail: p.trail };
}
function snapV(R, slot) {
  const att = R.att, d = 1 - att;
  const bgGap = (R.P && R.P[att] && R.P[d]) ? Math.max(0, R.P[att].z - R.P[d].z) : 999;
  const bgBx = (R.P && R.P[d]) ? R.P[d].x : 0;
  const bgBoost = (R.P && R.P[d]) ? R.P[d].boost > 0 : false;
  const P = (R.P || []).map((p, i) => {
    if (!p) return null;
    // 攻撃側には後ろ（追越側）の位置を送らない（ブースト中のみ見える）
    if ((R.state === 'play' || R.state === 'count') && slot === att && i !== slot && p.boost <= 0) return null;
    return riderSnap(p);
  });
  return {
    mode: 'versus', s: R.state, t: r1(R.timer), rd: R.round, att: R.att, sc: R.sc, hist: R.hist, msg: R.msg, sub: R.sub, el: r1(R.el),
    course: R.course || 0, bgGap: r1(bgGap), bgBx: r1(bgBx), bgBoost, names: R.names, lvs: R.lvs, ranked: !!R.ranked, fx: R.fx, P, obs: obsSnap(R), mud: mudSnap(R)
  };
}

/* =====================================================================
   エンドレスラン（1人・どこまで行けるか）
   ===================================================================== */
const EN = { BASE: 130, MAX: 330, ACC: 2.4, STEER: 260 };
function resetEndless(R) {
  R.P = [{ x: 0, z: 0, v: EN.BASE, vx: 0, brk: 0, bcd: 0, boost: 0, cd: 0, brakes: 0, bike: R.bikes[0], skin: R.skins[0], hair: R.hairs[0], fit: R.fits[0], acc: R.accs[0], trail: R.trails[0] }];
  R.obs = []; R.mud = []; R.nid = 1; R.fx = null;
  R.inp = [{ s: 0 }, { s: 0 }]; R.act = [false, false]; R.actK = [null, null];
  R.state = 'count'; R.timer = 3; R.el = 0;
  R.score = 0; R.bonus = 0; R.combo = 0; R.comboT = 0; R.nearN = 0; R.ev = [];
  R.nextCar = 1.2; R.nextCop = rnd(9, 13); R.sentOver = false; R.msg = ''; R.sub = '';
}
function spawnWave(R, p) {
  const lvl = Math.min(1, R.el / 150), z = p.z + rnd(580, 660);
  // 近くの障害物の車線を調べ、必ず1車線は通れるようにする
  const used = new Set(R.obs.filter(o => o.k !== 'cop' && Math.abs(o.z - z) < 200).map(o => laneIdx(o.x)));
  const free = [0, 1, 2, 3].filter(i => !used.has(i));
  if (free.length < 2) return;
  const keep = free[Math.floor(Math.random() * free.length)];
  const cand = free.filter(i => i !== keep).sort(() => Math.random() - 0.5);
  if (Math.random() < 0.045 * MUD_RATE) addMud(R, LANES[Math.floor(Math.random() * 4)] + rnd(-10, 10), z - rnd(120, 220));   // ごくまれに泥
  const r = Math.random();
  if (r < 0.12 + lvl * 0.06) { const li = cand[0]; for (let i = 0; i < 3; i++) addObs(R, 'cone', LANES[li] + rnd(-5, 5), z + i * 26, 0, 1); return; }
  const sameC = cand.filter(i => i < 2);
  if (r < 0.24 && sameC.length) { addObs(R, 'bus', LANES[sameC[0]] * 0.98, z, rnd(35, 50), 1); return; }
  const n = Math.min(cand.length, Math.random() < 0.35 + lvl * 0.4 ? (Math.random() < lvl * 0.5 ? 3 : 2) : 1);
  for (let k = 0; k < n; k++) {
    const li = cand[k], onc = li >= 2;
    addObs(R, 'car', LANES[li] + rnd(-6, 6), z + rnd(-30, 30), onc ? rnd(60, 110) : rnd(40, 70), onc ? -1 : 1, Math.floor(rnd(0, 6)));
  }
}
function overEndless(R, kind, reason) {
  const p = R.P[0];
  R.state = 'over'; R.fx = { who: [0], kind }; R.msg = 'GAME OVER'; R.sub = reason;
  R.score = Math.floor(p.z / 10) + R.bonus;
  const res = submitScore(R.hostId, R.names[0], R.score, R.lvs[0], R.course || 0);
  const coins = Math.floor(R.score / 40), sid = R.ids[0];
  if (coins > 0) { io.to(sid).emit('reward', { gain: coins }); ecoAddSid(sid, coins); }
  prog(R, 0, 'run', { score: R.score, dist: Math.floor(p.z / 10) });
  io.to(sid).emit('endless_over', { score: R.score, dist: Math.floor(p.z / 10), bonus: R.bonus, reason, kind, coins, best: res.best, rank: res.rank, improved: res.improved, top: topN(10, R.hostId), tok: myEntry('run', R.hostId) });
}
function stepEndless(R, dt) {
  if (R.state === 'count') { R.timer -= dt; if (R.timer <= 0) R.state = 'play'; return; }
  if (R.state !== 'play') return;
  R.el += dt;
  const p = R.P[0];
  steerRider(R, p, R.inp[0], EN.STEER, dt);
  if (R.act[0]) {
    if (R.actK[0] === 'brake') { if (p.bcd <= 0) { p.brk = 0.7; p.bcd = 1.3; prog(R, 0, 'brake'); } }
    else if (p.cd <= 0 && p.boost <= 0) { p.boost = 1.3; p.cd = 4; prog(R, 0, 'boost'); }
  }
  R.act = [false, false];
  const target = Math.min(EN.MAX, EN.BASE + R.el * EN.ACC);
  if (p.brk > 0) { p.brk -= dt; p.v = Math.max(target * 0.35, p.v - 420 * dt); }
  else if (p.boost > 0) { p.boost -= dt; p.v = Math.min(target + 160, p.v + 520 * dt); }
  else { const df = target - p.v; p.v += Math.sign(df) * Math.min(Math.abs(df), 170 * dt); }
  p.cd = Math.max(0, p.cd - dt); p.bcd = Math.max(0, p.bcd - dt);
  mudCheck(R, 0, p, dt); p.mm = moveMul(R, p);
  p.z += p.v * p.mm * dt;
  R.comboT -= dt; if (R.comboT <= 0) R.combo = 0;

  const lvl = Math.min(1, R.el / 150);
  R.nextCar -= dt;
  if (R.nextCar <= 0) { R.nextCar = rnd(1.3, 2.1) - lvl * 0.85; spawnWave(R, p); }
  R.nextCop -= dt;
  if (R.nextCop <= 0) {
    R.nextCop = rnd(11, 17) - lvl * 5;
    const x = nearestLane(p.x, SAME);   // 自分に近い車線を後ろから走ってくる（サイレンで予告）
    if (clearAt(R, x, p.z - 330, 19, 27)) addObs(R, 'cop', x, p.z - 330, p.v + 90, 1);
  }
  for (const o of R.obs) if (o.k === 'cop') o.v0 = Math.max(o.v0, p.v + 75);
  traffic(R, dt, R.P);
  R.obs = R.obs.filter(o => o.z > p.z - 420 && o.z < p.z + 900);
  R.mud = (R.mud || []).filter(m => m.z > p.z - 200);
  copPasses(R);

  for (const o of R.obs) {
    if (o.k === 'cop') { if (copRule(o, p, true)) return overEndless(R, 'cop', 'パトカーの進路妨害で逮捕！'); continue; }
    if (hitObs(o, p)) return overEndless(R, 'car', o.k === 'cone' ? '工事現場に突っ込んだ！' : o.k === 'bus' ? 'バスに激突！' : '車と衝突！');
    if (!o.passed && (o.z + o.l < p.z - BIKE_L)) {
      o.passed = true;
      if (o.k !== 'cone' && Math.abs(o.x - p.x) < o.w + BIKE_W + 20) {   // ニアミスボーナス
        R.combo++; R.comboT = 3.5; R.nearN++;
        const b = 15 * Math.min(R.combo, 8);
        R.bonus += b; R.ev.push({ t: 'near', n: R.combo, b });
      }
    }
  }
  R.score = Math.floor(p.z / 10) + R.bonus;
}
function snapE(R) {
  const s = {
    mode: 'endless', s: R.state, t: r1(R.timer), el: r1(R.el), course: R.course, names: R.names, lvs: R.lvs, fx: R.fx,
    score: R.score, combo: R.combo, rd: 0, att: 0, sc: [0, 0], hist: [], msg: R.msg, sub: R.sub,
    P: [riderSnap(R.P[0])], obs: obsSnap(R), mud: mudSnap(R), ev: R.ev
  };
  R.ev = [];
  return s;
}

/* ===== ゲームループ（30Hz） ===== */
setInterval(() => {
  for (const R of rooms.values()) {
    if (R.state === 'lobby') continue;
    if (R.mode === 'endless') {
      if (R.state === 'over' && R.sentOver) continue;
      stepEndless(R, TICK);
      if (R.state === 'over') R.sentOver = true;
      const se = snapE(R);
      io.to(R.ids[0]).emit('st', se);
      if (R.spec && R.spec.size) for (const sid of R.spec) io.to(sid).emit('st', se);
      continue;
    }
    if (!R.isCpu && !R.ids[1]) continue;
    step(R, TICK);
    for (const i of [0, 1]) if (R.ids[i]) io.to(R.ids[i]).emit('st', snapV(R, i));
    if (R.spec && R.spec.size) { const sv = snapV(R, -1); for (const sid of R.spec) io.to(sid).emit('st', sv); }   // 観戦者には両方の位置を見せる
  }
}, TICK * 1000);

/* =====================================================================
   ルーム・フレンド・チャット
   ===================================================================== */
const byId = new Map();   // ログインID(NM-…) -> socket.id
const owners = new Map(); // ログインID -> 端末UUID（なりすまし防止の簡易チェック）
const byPk = new Map();   // フレンド用内部キー -> socket.id
const byFid = new Map();  // 旧フレンドID(v6) -> socket.id（古いフレンド登録を自動で移行するためだけに使う）
const sockOf = sid => sid && io.sockets.sockets.get(sid);
/* ===== 観戦（フレンドの試合を見る） ===== */
const specs = new Map();   // 観戦者のsocket.id -> ルームコード
const SPEC_MAX = 8;
function canWatch(R) { return !!R && R.state !== 'lobby' && (R.mode === 'endless' || R.isCpu || !!R.ids[1]); }
function specVisible(R) { let n = R.spec ? R.spec.size : 0; if (R.hid) for (const sid of R.hid) if (R.spec.has(sid)) n--; return n; }
function specCount(R) { const n = specVisible(R); for (const i of [0, 1]) if (R.ids[i]) io.to(R.ids[i]).emit('spec_n', n); }
function specLeave(socket) {
  const code = specs.get(socket.id); if (!code) return;
  specs.delete(socket.id); const R = rooms.get(code);
  if (R && R.spec) { R.spec.delete(socket.id); if (R.hid) R.hid.delete(socket.id); specCount(R); }
}
function specEnd(sid, why) { specs.delete(sid); const sk = sockOf(sid); if (sk) sk.emit('spec_end', { why }); }
// 試合が終わってルームが消えた・ロビーに戻ったら観戦も終わり
setInterval(() => {
  for (const [sid, code] of specs) {
    const R = rooms.get(code);
    if (!sockOf(sid)) { specs.delete(sid); if (R && R.spec) R.spec.delete(sid); continue; }
    if (!R) specEnd(sid, '試合が終わりました');
    else if (R.state === 'lobby') { R.spec.delete(sid); specEnd(sid, 'ルームのロビーに戻りました'); }
  }
}, 1000);
function statusOf(sid) {
  const sk = sockOf(sid);
  if (!sk) return 'offline';
  if (rankQ.some(q => q.sid === sid)) return 'playing';
  const R = sk.data && rooms.get(sk.data.code);
  if (!R) return 'online';
  return (R.mode === 'versus' && !R.isCpu && !R.ids[1]) ? 'waiting' : 'playing';
}
// フレンド申請まわり
const inboxOf = pk => [...(freq.get(pk) || new Map())].map(([from, ts]) => ({ pk: from, name: nameOfPk(from) || '（名前なし）', ts, s: statusOf(byPk.get(from)) })).sort((a, b) => b.ts - a.ts);
function pushInbox(pk) { const sk = sockOf(byPk.get(pk)); if (sk) sk.emit('friend_inbox', inboxOf(pk)); }
function notify(pk, n) {   // オンラインならすぐ届ける。オフラインなら保存して次の接続で届ける
  n.name = nameOfPk(n.pk) || ''; n.ts = Date.now();
  const sk = sockOf(byPk.get(pk));
  if (sk) sk.emit('friend_notice', [n]);
  else { const a = fnote.get(pk) || []; a.push(n); fnote.set(pk, a.slice(-50)); saveFriends(); }
}
function delReq(to, from) { const m = freq.get(to); if (m && m.delete(from)) { if (!m.size) freq.delete(to); saveFriends(); return true; } return false; }
function setLook(R, i, L) { R.names[i] = L.name; R.bikes[i] = L.bike || 'std'; R.skins[i] = L.skin; R.hairs[i] = L.hair; R.fits[i] = L.fit; R.accs[i] = L.acc; R.trails[i] = L.trail; R.lvs[i] = L.lv; R.pids[i] = L.pid; R.pks[i] = L.pk; R.ttls[i] = L.ttl; R.pls[i] = L.pl; R.rps[i] = L.rp; }
function newRoom(code, socket, d, extra) {
  const R = Object.assign({
    code, ids: [socket.id, null], names: ['プレイヤー', 'プレイヤー2'], bikes: ['std', 'std'], skins: ['default', 'default'], hairs: ['default', 'default'], fits: ['default', 'default'],
    accs: ['none', 'none'], trails: ['none', 'none'], lvs: [1, 1], pids: ['', ''], pks: ['', ''], ttls: ['rookie', 'rookie'], pls: ['normal', 'normal'], rps: [0, 0], ready: [false, false],
    course: cleanCourse(d && d.course), hostId: clean(d && d.id, ''), hostPk: socket.nmPk || '', mode: 'versus', isCpu: false,
    inp: [{ s: 0 }, { s: 0 }], act: [false, false], actK: [null, null], state: 'wait', sc: [0, 0], hist: [], round: 0, P: [], obs: [], nid: 1
  }, extra || {});
  setLook(R, 0, lookS(socket, d, 'プレイヤー'));
  return R;
}
function roomInfo(R, me) {
  return {
    code: R.code, me, course: R.course, state: R.state,
    players: [0, 1].map(i => R.ids[i] ? { name: R.names[i], pk: R.pks[i], bike: R.bikes[i], skin: R.skins[i], hair: R.hairs[i], fit: R.fits[i], acc: R.accs[i], trail: R.trails[i], lv: R.lvs[i], ttl: R.ttls[i], pl: R.pls[i], rp: R.rps[i], ready: !!R.ready[i] } : null)
  };
}
function sendRoom(R) { for (const i of [0, 1]) if (R.ids[i]) io.to(R.ids[i]).emit('room', roomInfo(R, i)); }
function leaveRoom(socket) {
  specLeave(socket);
  const R = rooms.get(socket.data && socket.data.code);
  if (R) {
    const slot = socket.data.slot;
    if (R.mode === 'versus' && !R.isCpu && !R.ranked && slot === 1 && R.ids[0]) {
      // ゲストが抜けた → ホストはルームロビーへ戻って次の相手を待つ
      R.ids[1] = null; R.ready = [false, false]; R.state = 'lobby'; R.P = []; R.obs = []; R.names[1] = 'プレイヤー2';
      io.to(R.ids[0]).emit('room_note', { t: 'guest_left' });
      sendRoom(R);
    } else {
      const other = R.ids[1 - slot];
      if (other) {
        if (R.ranked && R.state !== 'match') {
          // ランクマッチ中に相手が抜けた → 残った側の勝ち（抜けた側はクライアントで敗北扱い）
          io.to(other).emit('rank_forfeit', { oppRp: R.rps[slot] || 0 });
          const os2 = io.sockets.sockets.get(other); if (os2) os2.rkOk = true;
        } else io.to(other).emit('left');
        const os = io.sockets.sockets.get(other); if (os) os.data = {};
      }
      rooms.delete(R.code);
    }
  }
  socket.data = {};
}
function blocked(sa, sb) { const a = sockOf(sa), b = sockOf(sb); return !!(a && b && ((a.nmBlocks && a.nmBlocks.has(b.nmPk)) || (b.nmBlocks && b.nmBlocks.has(a.nmPk)))); }
function joinRoom(socket, R, d, reply) {
  if (!R) return reply({ ok: false, err: 'ルームが見つかりません' });
  if (R.mode !== 'versus' || R.ids[1] || R.isCpu) return reply({ ok: false, err: 'ルームに参加できません' });
  if (R.state !== 'lobby') return reply({ ok: false, err: 'ルームは対戦中です' });
  if (R.ids[0] === socket.id) return reply({ ok: false, err: '自分のルームには参加できません' });
  if (R.banned && socket.nmPk && R.banned.has(socket.nmPk)) return reply({ ok: false, err: 'このルームにはホストの判断で参加できません' });
  if (blocked(R.ids[0], socket.id)) return reply({ ok: false, err: 'このルームには参加できません' });
  leaveRoom(socket);
  R.ids[1] = socket.id; R.ready = [false, false];
  setLook(R, 1, lookS(socket, d, 'プレイヤー2'));
  socket.data = { code: R.code, slot: 1 };
  reply({ ok: true });
  sendRoom(R);
}
const oppInfo = (R, i) => ({ name: R.names[i], pk: (R.isCpu && i === 1) ? '' : R.pks[i], lv: R.lvs[i], rp: R.rps[i], ttl: R.ttls[i], pl: R.pls[i], bike: R.bikes[i], skin: R.skins[i], hair: R.hairs[i], fit: R.fits[i], acc: R.accs[i], trail: R.trails[i], bot: !!(R.bot && i === 1), cpu: !!(R.isCpu && i === 1) });
function startRoomMatch(R) {
  resetMatch(R);
  for (const i of [0, 1]) io.to(R.ids[i]).emit('start', { slot: i, course: R.course, mode: 'versus', room: true, opp: oppInfo(R, 1 - i) });
}

/* =====================================================================
   ランクマッチ（RPが近い相手と自動マッチング。見つからなければランクCPU）
   ===================================================================== */
const rankQ = [];   // { sid, rp, t0, d }
const qRemove = sid => { const i = rankQ.findIndex(q => q.sid === sid); if (i >= 0) rankQ.splice(i, 1); };
let rkSeq = 1;
function startRanked(a, b) {
  const sa = io.sockets.sockets.get(a.sid); if (!sa) return;
  const code = 'RK_' + (rkSeq++);
  const R = newRoom(code, sa, a.d, b ? { ranked: true } : { ranked: true, bot: true, isCpu: true });
  R.course = Math.floor(Math.random() * PATHS.length);
  R.rps[0] = a.rp;
  if (b) {
    const sb = io.sockets.sockets.get(b.sid); if (!sb) { rankQ.push(a); return; }
    R.ids[1] = b.sid; setLook(R, 1, lookS(sb, b.d, 'プレイヤー2')); R.rps[1] = b.rp;
    sb.data = { code, slot: 1 };
  } else {
    const lv = R.lvs[0] || 1, pick = arr => arr[Math.floor(Math.random() * arr.length)];
    setLook(R, 1, {
      name: pick(BOT_NAMES), skin: pick(['default', 'gold', 'cyber', 'ocean', 'neon', 'tiger', 'mint', 'sunset']), hair: pick(['helmet', 'short_b', 'spiky', 'pony', 'mohawk', 'bob']),
      fit: pick(['jersey', 'racer', 'hoodie', 'happi', 'aloha', 'suit']), acc: pick(['none', 'cap', 'sunglass', 'goggles', 'headphone']), trail: pick(['none', 'fire', 'spark', 'bubble']), bike: pick(['std', 'road', 'mtb', 'bmx', 'std', 'road']),
      lv: clamp(lv + Math.floor(rnd(-3, 4)), 1, 99), pid: '', pk: '', ttl: 'rookie', pl: 'normal', rp: clamp(Math.round(a.rp + rnd(-60, 60)), 0, 99999)
    });
    R.skill = clamp(0.25 + a.rp / 1700, 0.25, 0.95);
  }
  rooms.set(code, R);
  sa.data = { code, slot: 0 };
  resetMatch(R);
  for (const i of [0, 1]) if (R.ids[i]) io.to(R.ids[i]).emit('start', { slot: i, course: R.course, mode: 'versus', room: false, ranked: true, opp: oppInfo(R, 1 - i) });
}
function tryMatch() {
  const now = Date.now();
  for (let i = rankQ.length - 1; i >= 0; i--) if (!io.sockets.sockets.get(rankQ[i].sid)) rankQ.splice(i, 1);
  rankQ.sort((a, b) => a.t0 - b.t0);
  for (let i = 0; i < rankQ.length; i++) {
    const a = rankQ[i], wa = (now - a.t0) / 1000;
    let best = -1, bd = 1e9;
    for (let j = i + 1; j < rankQ.length; j++) {
      const b = rankQ[j], w = Math.max(wa, (now - b.t0) / 1000), win = 150 + w * 25, d = Math.abs(a.rp - b.rp);
      if (blocked(a.sid, b.sid)) continue;   // どちらかがブロックしていたらマッチしない
      if (d <= win && d < bd) { bd = d; best = j; }
    }
    if (best >= 0) { const b = rankQ[best]; rankQ.splice(best, 1); rankQ.splice(i, 1); startRanked(a, b); return tryMatch(); }
  }
}
setInterval(() => {
  tryMatch();
  const now = Date.now();
  for (const q of rankQ.slice()) {
    const w = (now - q.t0) / 1000;
    if (w >= BOT_AFTER) { qRemove(q.sid); startRanked(q, null); continue; }
    io.to(q.sid).emit('rank_wait', { t: Math.floor(w), n: rankQ.length, bot: BOT_AFTER });
  }
}, 1000);

/* =====================================================================
   NGワード（チャット・ユーザー名）と個人情報のガード
   ・チャットでは引っかかった部分を「＊」に置き換える
   ・ユーザー名にNGワードが入っていたら登録できない
   ・管理者画面から言葉を追加・削除できる（MOD.ng）
   ===================================================================== */
// ひらがなに直してから探す言葉（カタカナ・全角半角・大文字小文字の違いは同じ扱い）
const NG_ANY = ['しね', 'しんで', '死ね', '死んで', '氏ね', '4ね', 'タヒね', 'ころす', 'ころせ', '殺す', '殺せ', '殺した', 'きえろ', '消えろ', 'うざい', 'うぜえ', 'うぜー', 'きもい', 'きっしょ', 'きしょい',
  'ばかやろ', 'ばかじゃね', 'ばかじゃない', '馬鹿', 'あほ', '阿呆', 'くそが', 'くそやろう', 'くたばれ', 'ぶさいく', 'ぶっころ', 'ぶっ殺',
  'ちんこ', 'ちんぽ', 'まんこ', 'せっくす', 'おっぱい', 'えっち', 'sex', 'fuck', 'shit', 'bitch', 'dick', 'porn', 'がいじ', '障害者', 'しょうがいしゃ', '池沼', 'ちしょう', 'きちがい', '基地外', '気違い'];
// カタカナのまま探す短い悪口（ひらがなにすると「ちかすぎ」などに誤反応するため）
const NG_KATA = ['カス', 'ゴミ', 'クズ', 'バカ', 'ブス', 'デブ', 'ザコ', 'ハゲ', 'チビ', 'ガキ'];
const kata2hira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const NG_SKIP = /[\s・_\-ー〜~.,!?！？。、*＊'"()（）「」]/;
function ngWords() { return NG_ANY.concat(MOD.ng || []).map(w => kata2hira(String(w).normalize('NFKC').toLowerCase()).replace(new RegExp(NG_SKIP.source, 'g'), '')).filter(w => w.length >= 2); }
// 文字列の中のNGワードの位置を探す（記号や伸ばし棒をはさんでもヒット）
function ngScan(s) {
  s = String(s || '').normalize('NFKC');
  const chars = [...s], norm = [], map = [];
  chars.forEach((ch, i) => { if (NG_SKIP.test(ch)) return; norm.push(kata2hira(ch.toLowerCase())); map.push(i); });
  const ns = norm.join(''), hits = [];
  for (const w of ngWords()) { let p = ns.indexOf(w); while (p >= 0) { hits.push([map[p], map[p + w.length - 1]]); p = ns.indexOf(w, p + 1); } }
  for (const w of NG_KATA) { const re = new RegExp('(?<![ァ-ヶー])' + w + '(?![ァ-ヶ])', 'g'); let m; while ((m = re.exec(s))) { const a = [...s.slice(0, m.index)].length; hits.push([a, a + w.length - 1]); } }   // 「カスタード」などは除く
  return { chars, hits };
}
const ngHit = s => ngScan(s).hits.length > 0;
function ngMask(s) {
  const { chars, hits } = ngScan(s);
  for (const [a, b] of hits) for (let i = a; i <= b; i++) chars[i] = '＊';
  let out = chars.join('');
  // 個人情報（電話番号・URL・SNSのID）も隠す
  out = out.replace(/\d[\d\-‐ー ]{5,}\d/g, m => '＊'.repeat([...m].length))
    .replace(/(https?:\/\/|www\.)\S+/gi, m => '＊'.repeat(Math.min(8, m.length)))
    .replace(/\S+\.(com|jp|net|org|me|ly|io|gg|tv)\b\S*/gi, m => '＊'.repeat(Math.min(8, m.length)))
    .replace(/[@＠][\w.]{2,}/g, m => '＊'.repeat(Math.min(8, m.length)))
    .replace(/(line|ライン|らいん|insta|インスタ|tiktok|ティックトック|discord|ディスコ)\s*(id|ＩＤ|アイディー)?\s*[:：は]?\s*[\w.\-]{3,}/gi, m => '＊'.repeat(Math.min(10, [...m].length)));
  return { text: out, hit: out !== String(s || '').normalize('NFKC') };
}

/* =====================================================================
   端末情報（管理者だけが見られる）：同じ「おまかせ」名前の人を見分けるため
   ===================================================================== */
function parseUA(ua, dv) {
  ua = String(ua || ''); const touch = !!(dv && dv.touch);
  let os = '不明', model = '', br = 'ブラウザ', m;
  if ((m = ua.match(/iPhone OS (\d+)[._](\d+)/))) { os = 'iOS ' + m[1] + '.' + m[2]; model = 'iPhone'; }
  else if ((m = ua.match(/iPad.*OS (\d+)[._](\d+)/))) { os = 'iPadOS ' + m[1] + '.' + m[2]; model = 'iPad'; }
  else if ((m = ua.match(/Android (\d+(\.\d+)?)/))) { os = 'Android ' + m[1]; const mm = ua.match(/Android [\d.]+;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\sBuild|\))/i); model = mm ? mm[1].trim() : 'Android'; if (model === 'K') model = 'Android端末'; }
  else if (/Macintosh/.test(ua)) { if (touch) { os = 'iPadOS'; model = 'iPad'; } else { m = ua.match(/Mac OS X (\d+)[._](\d+)/); os = 'macOS' + (m ? ' ' + m[1] + '.' + m[2] : ''); model = 'Mac'; } }
  else if (/Windows NT/.test(ua)) { os = 'Windows'; model = 'PC'; }
  else if (/CrOS/.test(ua)) { os = 'ChromeOS'; model = 'Chromebook'; }
  else if (/Linux/.test(ua)) { os = 'Linux'; model = 'PC'; }
  if (/Line\//i.test(ua)) br = 'LINEアプリ内'; else if (/Instagram/i.test(ua)) br = 'Instagramアプリ内'; else if (/FBAN|FBAV/i.test(ua)) br = 'Facebookアプリ内';
  else if (/TikTok|musical_ly/i.test(ua)) br = 'TikTokアプリ内'; else if (/EdgA?\//.test(ua)) br = 'Edge'; else if (/SamsungBrowser/.test(ua)) br = 'Samsungブラウザ';
  else if (/CriOS|Chrome\//.test(ua)) br = 'Chrome'; else if (/FxiOS|Firefox\//.test(ua)) br = 'Firefox'; else if (/Safari\//.test(ua)) br = 'Safari';
  const dm = dv && typeof dv.model === 'string' ? dv.model.replace(/[<>&"'`]/g, '').trim().slice(0, 30) : '';   // Chrome系は端末から機種名を教えてもらえる
  if (dm) model = dm;
  return { os, model, br, s: [model, os, br].filter(Boolean).join('・') + (dv && dv.pwa ? '（ホーム画面）' : '') };
}
function deviceOf(socket, dv) {
  const h = socket.handshake.headers || {}, ua = String(h['user-agent'] || '').slice(0, 240);
  const ip = String(h['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim();
  dv = dv && typeof dv === 'object' ? dv : {};
  const p = parseUA(ua, dv), sv = v => typeof v === 'string' ? v.replace(/[<>&"'`]/g, '').slice(0, 40) : '';
  return { s: p.s, os: p.os, model: p.model, br: p.br, ua, scr: sv(dv.scr), dpr: Number(dv.dpr) || 0, lang: sv(dv.lang), tz: sv(dv.tz), pwa: !!dv.pwa,
    net: ip ? crypto.createHash('sha256').update('nm-net:' + ip).digest('hex').slice(0, 6) : '', t: Date.now() };
}

/* =====================================================================
   プロフィール（ブロスタ風）：アイコン・ひとこと・成績。ほかのプレイヤーも見られる
   Upstashでは1人1キー（nm:prof:<pk>）で保存（大きくなりすぎないように）
   ===================================================================== */
const PROF_FILE = process.env.PROF_FILE || path.join(__dirname, 'profiles.json');
const PROF = new Map();   // pk -> profile
let profLoaded = false;
const saveProfFile = saver('prof', PROF_FILE, () => Object.fromEntries([...PROF].filter(([, p]) => p && !p._miss)), 4000);
function loadProf(j) { if (useKV) return; if (j && typeof j === 'object') for (const [pk, p] of Object.entries(j)) if (cleanPk(pk) && p && typeof p === 'object') PROF.set(pk, p); profLoaded = true; }
async function getProf(pk) {
  if (PROF.has(pk)) { const p = PROF.get(pk); return p && p._miss ? null : p; }
  if (!useKV) return null;
  try { const p = await STORE.load('prof:' + pk); PROF.set(pk, p || { _miss: 1 }); return p || null; } catch (e) { return null; }
}
const profTimers = new Map();
function putProf(pk, p) {
  PROF.set(pk, p);
  if (!useKV) return saveProfFile();
  if (profTimers.has(pk)) return;
  profTimers.set(pk, setTimeout(() => { profTimers.delete(pk); STORE.save('prof:' + pk, null, PROF.get(pk)); }, 5000));
  PENDING.set('prof:' + pk, () => { clearTimeout(profTimers.get(pk)); profTimers.delete(pk); PENDING.delete('prof:' + pk); return STORE.save('prof:' + pk, null, PROF.get(pk), true); });
}
const PROF_MSG = 20;   // ひとことの種類の数（クライアントの PROF_MSGS と同じ）
function cleanProf(d) {
  const k = v => (typeof v === 'string' && /^[\w-]{1,24}$/.test(v)) ? v : '';
  const n = (v, a, b) => clamp(Math.floor(Number(v) || 0), a, b);
  const st = d && typeof d.st === 'object' && d.st ? d.st : {};
  const ic = d && d.ic && typeof d.ic === 'object' ? { c: k(d.ic.c), k: k(d.ic.k) } : null;
  const look = {}; for (const c of ['bike', 'skin', 'hair', 'fit', 'acc']) look[c] = k(d && d.look && d.look[c]) || (c === 'acc' ? 'none' : c === 'bike' ? 'std' : 'default');
  return {
    lv: n(d && d.lv, 1, 99), ic: ic && ic.c && ic.k ? ic : null, msg: n(d && d.msg, 0, PROF_MSG - 1), bg: n(d && d.bg, 0, 11), look,
    ttl: k(d && d.ttl) || 'rookie', pl: k(d && d.pl) || 'normal', rp: n(d && d.rp, 0, 99999), sBest: n(d && d.sBest, 0, 99999), rkTop: n(d && d.rkTop, 0, 6), seaTop: n(d && d.seaTop, -1, 6),
    tro: n(d && d.tro, 0, 999), st: { wins: n(st.wins, 0, 1e7), plays: n(st.plays, 0, 1e7), best: n(st.best, 0, 1e8), dist: n(st.dist, 0, 1e9), items: n(st.items, 0, 9999), login: n(st.login, 0, 99999), over: n(st.over, 0, 1e7), fr: n(st.fr, 0, 999) }
  };
}

/* =====================================================================
   シーズン（チャリランクは毎月1日 0:00 にリセット。日本時間）
   ===================================================================== */
const SEASON_FILE = process.env.SEASON_FILE || path.join(__dirname, 'season.json');
const JST = 9 * 3600e3;
const seasonIdAt = t => { const d = new Date(t + JST); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const seasonStart = id => { const [y, m] = id.split('-').map(Number); return Date.UTC(y, m - 1, 1) - JST; };
const seasonEnd = id => { const [y, m] = id.split('-').map(Number); return Date.UTC(y, m, 1) - JST; };
let SEASON = { id: '', hist: [] };
const saveSeason = saver('season', SEASON_FILE, () => SEASON, 1000);
function loadSeason(j) { if (j && typeof j.id === 'string') SEASON = { id: j.id, hist: Array.isArray(j.hist) ? j.hist.slice(-12) : [] }; }
const seasonInfo = () => ({ id: SEASON.id, start: seasonStart(SEASON.id), end: seasonEnd(SEASON.id), prev: SEASON.hist[SEASON.hist.length - 1] || null });
function checkSeason() {
  const now = seasonIdAt(Date.now());
  if (!SEASON.id) { SEASON.id = now; saveSeason(); return; }
  if (SEASON.id === now) return;
  // シーズン終了：上位10人を記録して、RPランキングをリセット
  SEASON.hist.push({ id: SEASON.id, top: rpBoard.slice(0, 10).map(r => ({ name: r.name, rp: r.rp, lv: r.lv || 1, ttl: r.ttl || 'rookie' })) });
  SEASON.hist = SEASON.hist.slice(-12);
  SEASON.id = now; rpBoard = []; saveRp(); saveSeason();
  console.log('シーズン切り替え: ' + now);
  io.emit('season', seasonInfo());
}
setInterval(checkSeason, 60e3);

/* =====================================================================
   NCの検算（不正チェック）
   NCや持ち物はプレイヤーの端末に保存しているので、書き換えられる可能性がある。
   サーバーが知っている「もらえたはずのNCの上限」と、端末から届く「NC＋持ち物の価値」を比べて、
   多すぎる人を管理者画面に出す（自動で罰したりはしない。最後は管理者が判断する）
   ===================================================================== */
const ECO_FILE = process.env.ECO_FILE || path.join(__dirname, 'economy.json');
let ECO = {};
const saveEco = saver('eco', ECO_FILE, () => ECO, 5000);
function loadEco(j) { if (j && typeof j === 'object') ECO = j; }
const ECO_DAY = 2000;      // 1日にクエスト・ログボなどで増やせるNCの目安（多めに見積もる）
const RANK_BONUS = [0, 100, 150, 200, 300, 400, 1000];
const lvBonusSum = (a, b) => { let s = 0; for (let L = a + 1; L <= b; L++) s += 30 + L * 5; return s; };
function ecoBound(e, lv, rk, ach, pulls, sea, now) {
  const days = Math.max(1, Math.ceil((now - e.bt) / 864e5));
  let rb = 0; for (let i = (e.rk0 || 0) + 1; i <= rk; i++) rb += RANK_BONUS[i] || 0;
  return Math.round(e.b + (e.srv || 0) * 1.55 + (e.gift || 0) + lvBonusSum(e.lv0 || 1, lv) + rb + Math.max(0, ach - (e.ach0 || 0)) * 1000
    + Math.max(0, pulls - (e.p0 || 0)) * 15 + Math.max(0, sea - (e.s0 || 0)) * 3000 + days * ECO_DAY + 500);
}
function ecoAdd(pk, k, n) { const e = pk && ECO[pk]; if (!e || !(n > 0)) return; e[k] = (e[k] || 0) + n; saveEco(); }
const ecoAddSid = (sid, n) => { const sk = sockOf(sid); if (sk) ecoAdd(sk.nmPk, 'srv', n); };

/* =====================================================================
   運営（管理者）機能：お知らせ・警告・個別メッセージ・利用停止・通報
   管理者は「アカウントの秘密ID（uid）」で判定する。名前を変えても管理者のまま。
   ADMIN_HASHES に入っているのは uid をハッシュ化したもの（元の uid は分からない）。
   ほかの人を管理者にしたいときは、環境変数 ADMIN_UIDS に uid をカンマ区切りで入れる。
   ※停止・お知らせなどは Upstash（外部DB）を設定していないと、Renderの再起動で消えます
   ===================================================================== */
const ADMIN_HASHES = new Set(['c1a56d65affa4e9ef80e2556ad7c292bb8ed6222c723ee9cd57627fa5fb5989e']);   // 運営アカウント
const adminHash = uid => crypto.createHash('sha256').update('nm-admin:' + uid).digest('hex');
const isAdminUid = uid => !!uid && (ADMIN_HASHES.has(adminHash(uid)) || (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(uid));
const REPORT_ALERT = 5;        // ちがうプレイヤー何人から通報されたら管理者画面の一番上に出すか
const MOD_FILE = process.env.MOD_FILE || path.join(__dirname, 'moderation.json');
const MOD = { notices: [], bans: {}, warns: {}, pmsg: {}, reports: {}, seen: {}, feedback: [], gifts: {}, claims: {}, maint: { on: false }, nid: Math.floor(Date.now() / 1000) };   // 番号は時刻から始める（データが消えても前の番号とかぶらない）
const GIFT_MAX = 100000;      // 1回に配れるNCの上限
MOD.born = Date.now();        // このモデレーションデータが作られた時刻（保存データを読めたら、その値に置きかわる）
// お知らせの署名：プレイヤーの端末に控えを持たせて、サーバーのデータが消えたときに元に戻すため
const signN = n => hmac(['notice', n.id, n.kind, n.title, n.body || '', n.t, n.pin ? 1 : 0, n.gift || 0].join('|')).slice(0, 24);
function loadMod(j) {
  if (!j || typeof j !== 'object') return;
  for (const k of ['bans', 'warns', 'pmsg', 'reports', 'seen', 'gifts', 'claims']) if (j[k] && typeof j[k] === 'object') MOD[k] = j[k];
  if (Array.isArray(j.feedback)) MOD.feedback = j.feedback.slice(0, 300);
  if (Array.isArray(j.ng)) MOD.ng = j.ng.filter(w => typeof w === 'string').slice(-300);
  if (j.maint && typeof j.maint === 'object') MOD.maint = j.maint;
  if (Array.isArray(j.notices)) MOD.notices = j.notices.slice(0, 100);
  for (const n of MOD.notices) if (!n.sig) n.sig = signN(n);
  MOD.nid = Math.max(1, parseInt(j.nid, 10) || 1);
  MOD.born = Number(j.born) || 1;
}
const saveMod = saver('mod', MOD_FILE, () => MOD, 2000);
const KINDS = { update: 'アップデート', maint: 'メンテナンス', info: 'お知らせ', event: 'イベント', important: '重要' };
const txt = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, '').trim().slice(0, n) : '';
const banOf = pk => { const b = pk && MOD.bans[pk]; if (!b) return null; if (b.until && b.until < Date.now()) { delete MOD.bans[pk]; saveMod(); return null; } return b; };
const repCount = pk => { const r = MOD.reports[pk]; return r ? new Set(r.list.map(x => x.from)).size : 0; };
const adminSockets = () => [...io.sockets.sockets.values()].filter(s => s.isAdmin);
function userRow(pk) {
  const name = nameOfPk(pk), sid = byPk.get(pk), sk = sockOf(sid), seen = MOD.seen[pk] || {}, b = banOf(pk);
  const ec = ECO[pk];
  return { pk, name: name || seen.n || '（名前なし）', reg: !!name, dv: seen.d || '', net: seen.net || '', eco: ec && ec.flag ? 1 : 0, nc: ec && ec.c != null ? ec.c : null, nct: ec && ec.t || 0, lv: (sk && sk.nmLv) || seen.lv || 1, online: !!sk, st: sk ? statusOf(sid) : 'offline', seen: seen.t || 0, since: seen.c || 0,
    rep: repCount(pk), warn: (MOD.warns[pk] || []).length, ban: b ? { until: b.until || 0, reason: b.reason || '' } : null };
}
function flagged() { return Object.keys(MOD.reports).filter(pk => repCount(pk) >= REPORT_ALERT).map(pk => Object.assign(userRow(pk), { reasons: MOD.reports[pk].list.slice(-10) })).sort((a, b) => b.rep - a.rep); }
// 停止中のユーザーは、お知らせを見る以外の操作をできなくする
const BAN_ALLOW = new Set(['maint_restore', 'hello', 'notices_get', 'warn_ack', 'pg', 'msg_read', 'eco', 'nc_fix_ok']);
// メンテナンス中（管理者以外）にできること
const MAINT_ALLOW = new Set(['maint_restore', 'hello', 'notices_get', 'warn_ack', 'pg', 'msg_read', 'notice_claim', 'gift_claim', 'feedback', 'name_check', 'eco', 'nc_fix_ok', 'profile_set', 'blocks_set']);
// メンテナンスの状態にも署名をつけて、プレイヤーと運営の端末に控えを持たせる
// → メンテナンス中にコードを更新してサーバーが再起動しても、つながった端末の控えからメンテナンスを再開できる
const maintCore = m => ({ on: !!m.on, until: Number(m.until) || 0, msg: String(m.msg || '').slice(0, 200), auto: !!m.auto, t: Number(m.t) || 0 });
const signM = m => { const c = maintCore(m); return hmac(['maint', c.on ? 1 : 0, c.until, c.msg, c.auto ? 1 : 0, c.t].join('|')).slice(0, 24); };
const maintInfo = () => { const m = MOD.maint || { on: false }; const c = maintCore(m); return Object.assign(c, { sig: c.t ? signM(c) : '', born: MOD.born }); };
function kickForMaint(sk) { try { qRemove(sk.id); leaveRoom(sk); } catch (e) {} }
function setMaint(on, o) {
  if (on) {
    MOD.maint = { on: true, until: o.until || 0, msg: o.msg || '', auto: !!o.auto, t: Date.now() };
    for (const sk of io.sockets.sockets.values()) if (!sk.isAdmin) kickForMaint(sk);
  } else MOD.maint = { on: false, t: Date.now() };
  saveMod(); io.emit('maint', maintInfo());
}
// 端末から届いたメンテナンスの控えを確かめて、サーバーが知っている状態より新しければ使う
function restoreMaint(m) {
  if (!m || typeof m !== 'object') return false;
  const c = maintCore(m), now = Date.now();
  if (!c.t || c.t > now + 60e3 || m.sig !== signM(c)) return false;           // 署名がちがう・未来の時刻 → 使わない
  if ((MOD.maint && MOD.maint.t || 0) >= c.t) return false;                    // サーバーのほうが新しい
  if (c.on) {
    if (c.t >= MOD.born) return false;                                          // サーバーのデータが消えていないなら戻さない
    if (c.until ? c.until <= now || c.until - c.t > 2 * 864e5 : now - c.t > 6 * 3600e3) return false;   // 古すぎる控えは使わない
  }
  MOD.maint = c; saveMod();
  if (c.on) { for (const sk of io.sockets.sockets.values()) if (!sk.isAdmin) kickForMaint(sk); console.log('メンテナンスを端末の控えから再開しました'); }
  io.emit('maint', maintInfo());
  return true;
}
// 「時間になったら自動で終了」
setInterval(() => { const m = MOD.maint; if (m && m.on && m.auto && m.until && Date.now() >= m.until) setMaint(false); }, 5000);
function giveGift(pk, amount, title, text) {
  amount = Math.max(0, Math.min(GIFT_MAX, Math.round(Number(amount) || 0)));
  if (!amount) return null;
  const g = { id: MOD.nid++, amount, title: title || '運営からのプレゼント', text: text || '', t: Date.now() };
  (MOD.gifts[pk] = MOD.gifts[pk] || []).push(g); MOD.gifts[pk] = MOD.gifts[pk].slice(-20);
  const sk = sockOf(byPk.get(pk)); if (sk) sk.emit('gifts', [g]);
  return g;
}
const claimedBy = pk => Object.keys(MOD.claims).filter(id => MOD.claims[id].includes(pk)).map(Number);
function applyBan(sk, b) {
  if (!sk) return;
  sk.banned = b;
  if (b) { try { qRemove(sk.id); leaveRoom(sk); } catch (e) {} sk.emit('banned', { until: b.until || 0, reason: b.reason || '' }); }
  else sk.emit('unbanned');
}
// ログイン時に届けるもの（停止・警告・個別メッセージ・お知らせ）
function deliverMod(socket) {
  const pk = socket.nmPk; if (!pk) return;
  MOD.seen[pk] = Object.assign(MOD.seen[pk] || { c: Date.now() }, { t: Date.now(), n: socket.nmRegName || socket.nmName || (MOD.seen[pk] || {}).n || '', lv: socket.nmLv });
  const dv = socket.nmDv;
  if (dv) {   // 端末の要約だけ名簿に、くわしい情報はプロフィールの中（管理者だけが見られる）に保存
    const se = MOD.seen[pk]; se.d = dv.s; se.net = dv.net;
    se.ds = [dv.s].concat((se.ds || []).filter(x => x !== dv.s)).slice(0, 3);
    getProf(pk).then(p => { p = Object.assign({}, p || {}); p._dv = dv; p._dvs = [{ s: dv.s, net: dv.net, scr: dv.scr, t: dv.t }].concat((p._dvs || []).filter(x => x.s !== dv.s || x.net !== dv.net)).slice(0, 5); putProf(pk, p); });
  }
  saveMod();
  socket.isAdmin = isAdminUid(socket.nmUid);
  socket.emit('admin', socket.isAdmin);
  socket.emit('nmeta', { born: MOD.born });
  socket.emit('notices', MOD.notices);
  socket.emit('claimed', claimedBy(pk));
  socket.emit('maint', maintInfo());
  const gs = MOD.gifts[pk] || []; if (gs.length) socket.emit('gifts', gs);
  if (socket.isAdmin) socket.emit('adm_fbn', MOD.feedback.filter(f => f.st === 'new').length);
  const ws = (MOD.warns[pk] || []).filter(w => !w.ack); if (ws.length) socket.emit('warns', ws);
  const ms = MOD.pmsg[pk] || []; if (ms.length) socket.emit('pmsgs', ms);
  const b = banOf(pk); if (b) applyBan(socket, b); else socket.banned = null;
}

io.on('connection', socket => {
  // ===== 運営機能（停止中は使えない操作をはじく） =====
  socket.use(([ev], next) => {
    if (socket.banned && !BAN_ALLOW.has(ev)) return;
    if (MOD.maint && MOD.maint.on && !socket.isAdmin && !MAINT_ALLOW.has(ev)) return;   // メンテナンス中は遊べない
    next();
  });
  // お詫びNCなどの受け取り（サーバーで1人1回だけにする）
  socket.on('notice_claim', (d, cb) => {
    const pk = socket.nmPk, id = parseInt(d && d.id, 10), n = MOD.notices.find(x => x.id === id);
    if (!pk || !n || !n.gift) return rp(cb)({ ok: false, err: '受け取れません' });
    const l = MOD.claims[id] = MOD.claims[id] || [];
    if (l.includes(pk)) return rp(cb)({ ok: false, err: 'もう受け取っています' });
    l.push(pk); saveMod(); ecoAdd(pk, 'gift', n.gift); rp(cb)({ ok: true, amount: n.gift, id });
  });
  socket.on('gift_claim', (d, cb) => {
    const pk = socket.nmPk, id = parseInt(d && d.id, 10), l = pk && MOD.gifts[pk], g = l && l.find(x => x.id === id);
    if (!g) return rp(cb)({ ok: false, err: 'もう受け取っています' });
    MOD.gifts[pk] = l.filter(x => x.id !== id); if (!MOD.gifts[pk].length) delete MOD.gifts[pk];
    saveMod(); ecoAdd(pk, 'gift', g.amount); rp(cb)({ ok: true, amount: g.amount, id });
  });
  // フィードバック（ご意見・要望・バグ報告）
  socket.on('feedback', (d, cb) => {
    const pk = socket.nmPk, text = txt(d && d.text, 600), cat = txt(d && d.cat, 20) || 'その他', now = Date.now();
    if (!pk) return rp(cb)({ ok: false, err: '接続中です。少し待ってからもう一度送ってください' });
    if (text.length < 4) return rp(cb)({ ok: false, err: 'もう少しくわしく書いてください' });
    const mine = MOD.feedback.filter(f => f.pk === pk && now - f.t < 864e5);
    if (mine.length >= 5) return rp(cb)({ ok: false, err: 'フィードバックは1日5件までです' });
    if (mine.some(f => now - f.t < 30e3)) return rp(cb)({ ok: false, err: '少し時間をあけてから送ってください' });
    const f = { id: MOD.nid++, pk, name: socket.nmRegName || socket.nmName || 'プレイヤー', lv: socket.nmLv || 1, cat, text, t: now, st: 'new' };
    MOD.feedback.unshift(f); MOD.feedback = MOD.feedback.slice(0, 300); saveMod();
    rp(cb)({ ok: true });
    const nn = MOD.feedback.filter(x => x.st === 'new').length;
    for (const s of adminSockets()) { s.emit('adm_fb', { name: f.name, cat }); s.emit('adm_fbn', nn); }
  });
  // ===== ブロック（チャット・マッチング・ルーム参加・フレンド申請を止める） =====
  socket.on('blocks_set', d => { socket.nmBlocks = new Set((Array.isArray(d) ? d : []).map(cleanPk).filter(Boolean).slice(0, 200)); });
  // ===== プロフィール =====
  socket.on('profile_set', d => {
    const pk = socket.nmPk; if (!pk || !d || typeof d !== 'object') return;
    const now = Date.now(); if (now - (socket.profT || 0) < 2500) return; socket.profT = now;
    getProf(pk).then(old => { const p = Object.assign(cleanProf(d), { t: now }); if (old) { p._dv = old._dv; p._dvs = old._dvs; } putProf(pk, p); });
  });
  socket.on('profile_get', async (d, cb) => {
    cb = rp(cb); if (!d || typeof d !== 'object') return cb({ ok: false });
    let pk = cleanPk(d.pk);
    if (!pk && typeof d.name === 'string') { const e = nameReg.get(nkey(validName(d.name) || '')); if (e) pk = e.pk; }
    if (!pk) return cb({ ok: false, err: 'プレイヤーが見つかりません' });
    const p = await getProf(pk), name = nameOfPk(pk) || (MOD.seen[pk] || {}).n || 'プレイヤー', sk = sockOf(byPk.get(pk));
    const out = p ? Object.assign({}, p) : null; if (out) { delete out._dv; delete out._dvs; }   // 端末情報は管理者以外には見せない
    cb({ ok: true, pk, name, reg: !!nameOfPk(pk), online: !!sk, st: sk ? statusOf(sk.id) : 'offline', p: out, ban: !!banOf(pk) });
  });
  // ===== NCの検算（端末から「NC＋持ち物の価値」が届く） =====
  socket.on('eco', d => {
    const pk = socket.nmPk; if (!pk || !d || typeof d !== 'object') return;
    const now = Date.now(); if (now - (socket.ecoT || 0) < 6000) return; socket.ecoT = now;
    const n = k => clamp(Math.floor(Number(d[k]) || 0), 0, 1e9);
    const coins = n('coins'), w = coins + n('inv'), lv = clamp(n('lv'), 1, 99), rk = clamp(n('rk'), 0, 6), ach = n('ach'), pulls = n('pulls'), sea = n('sea');
    let e = ECO[pk];
    if (!e || e.reset) e = ECO[pk] = { b: w, bt: now, lv0: lv, rk0: rk, ach0: ach, p0: pulls, s0: sea, srv: 0, gift: 0 };   // 最初の報告を基準にする
    const bound = ecoBound(e, lv, rk, ach, pulls, sea, now);
    e.c = coins; e.w = w; e.bound = bound; e.t = now;
    if (w > bound) {
      const first = !e.flag; e.flag = { t: (e.flag && e.flag.t) || now, w, bound };
      if (first) { const name = nameOfPk(pk) || socket.nmName || 'プレイヤー'; for (const s of adminSockets()) s.emit('adm_alert', { name, n: 0, eco: 1 }); }
    }
    saveEco();
  });
  socket.on('nc_fix_ok', () => { const e = socket.nmPk && ECO[socket.nmPk]; if (e && e.fix != null) { delete e.fix; e.reset = true; delete e.flag; saveEco(); } });
  // お知らせの復元：サーバーのデータが消えていたら、端末に残っている署名つきの控えから戻す
  socket.on('maint_restore', m => restoreMaint(m));
  socket.on('notices_restore', d => {
    const pk = socket.nmPk; if (!pk || !d || typeof d !== 'object') return;
    let changed = false;
    for (const n of (Array.isArray(d.list) ? d.list : []).slice(0, 50)) {
      if (!n || typeof n !== 'object') continue;
      const c = { id: parseInt(n.id, 10), kind: KINDS[n.kind] ? n.kind : 'info', title: txt(n.title, 60), body: txt(n.body, 2000), t: Number(n.t) || 0, pin: !!n.pin };
      const g = Math.max(0, Math.min(GIFT_MAX, Math.round(Number(n.gift) || 0))); if (g) c.gift = g;
      if (!(c.id > 0) || !c.title || c.t >= MOD.born || n.sig !== signN(c) || MOD.notices.some(x => x.id === c.id)) continue;
      c.sig = n.sig; MOD.notices.push(c); MOD.nid = Math.max(MOD.nid, c.id + 1); changed = true;
    }
    // 受け取り済みのお詫びNCも戻す（二重に受け取れないように）
    for (const id of (Array.isArray(d.claimed) ? d.claimed : []).slice(0, 100)) {
      const n = MOD.notices.find(x => x.id === parseInt(id, 10)); if (!n || !n.gift) continue;
      const l = MOD.claims[n.id] = MOD.claims[n.id] || []; if (!l.includes(pk)) { l.push(pk); changed = true; }
    }
    if (!changed) return;
    MOD.notices.sort((a, b) => b.t - a.t); MOD.notices = MOD.notices.slice(0, 100); saveMod();
    io.emit('notices', MOD.notices); socket.emit('claimed', claimedBy(pk));
  });
  socket.on('notices_get', (d, cb) => { if (typeof d === 'function') cb = d; rp(cb)({ notices: MOD.notices }); });
  socket.on('warn_ack', id => { const pk = socket.nmPk, l = pk && MOD.warns[pk]; if (!l) return; for (const w of l) if (w.id === id) w.ack = Date.now(); saveMod(); });
  socket.on('msg_read', () => { const pk = socket.nmPk, l = pk && MOD.pmsg[pk]; if (!l) return; l.forEach(m => { m.read = 1; }); saveMod(); });
  // 通報（同じ相手には1日1回・1日20件まで）
  socket.on('report', (d, cb) => {
    const me = socket.nmPk, pk = cleanPk(d && d.pk);
    if (!me || !socket.nmRegName) return rp(cb)({ ok: false, err: 'ユーザー名を登録してから通報できます' });
    if (!pk || pk === me || !pkKey.has(pk)) return rp(cb)({ ok: false, err: 'このプレイヤーは通報できません' });
    const now = Date.now(), r = MOD.reports[pk] = MOD.reports[pk] || { list: [] };
    if (r.list.some(x => x.from === me && now - x.t < 864e5)) return rp(cb)({ ok: false, err: 'このプレイヤーはすでに通報済みです（24時間に1回まで）' });
    socket.repDay = (socket.repDay || []).filter(t => now - t < 864e5); if (socket.repDay.length >= 20) return rp(cb)({ ok: false, err: '通報の回数が多すぎます' });
    socket.repDay.push(now);
    r.list.push({ from: me, fromName: socket.nmRegName, reason: txt(d.reason, 20) || 'その他', text: txt(d.text, 120), where: txt(d.where, 20), t: now });
    r.list = r.list.slice(-60); saveMod();
    rp(cb)({ ok: true });
    if (repCount(pk) >= REPORT_ALERT) for (const s of adminSockets()) s.emit('adm_alert', { name: nameOfPk(pk), n: repCount(pk) });
  });
  // ----- ここから管理者だけ -----
  const adm = fn => (d, cb) => { if (typeof d === 'function') { cb = d; d = {}; } if (!socket.isAdmin) return rp(cb)({ ok: false, err: '管理者ではありません' }); try { fn(d || {}, rp(cb)); } catch (e) { console.error(e); rp(cb)({ ok: false, err: 'エラー' }); } };
  socket.on('adm_overview', adm((d, cb) => cb({ ok: true, live: [...rooms.values()].filter(canWatch).length, born: MOD.born, ng: MOD.ng || [], ngBase: NG_ANY.length + NG_KATA.length, ecoFlags: Object.keys(ECO).filter(pk => ECO[pk].flag).map(pk => Object.assign(userRow(pk), { w: ECO[pk].flag.w, bound: ECO[pk].flag.bound, coins: ECO[pk].c })).sort((a, b) => (b.w - b.bound) - (a.w - a.bound)).slice(0, 50), maint: maintInfo(), fbNew: MOD.feedback.filter(f => f.st === 'new').length, online: io.sockets.sockets.size, users: new Set([...[...nameReg.values()].map(e => e.pk), ...Object.keys(MOD.seen)]).size, rooms: [...rooms.values()].filter(R => R.state !== 'lobby').length, flagged: flagged(), notices: MOD.notices,
    banned: Object.keys(MOD.bans).filter(pk => banOf(pk)).map(userRow), kv: useKV })));
  socket.on('adm_users', adm((d, cb) => {
    const q = typeof d.q === 'string' ? d.q.normalize('NFKC').toLowerCase().trim() : '', pks = new Set([...nameReg.values()].map(e => e.pk));
    for (const pk of Object.keys(MOD.seen)) pks.add(pk);
    for (const sk of io.sockets.sockets.values()) if (sk.nmPk) pks.add(sk.nmPk);
    let list = [...pks].map(userRow);
    if (q) list = list.filter(u => u.name.normalize('NFKC').toLowerCase().includes(q) || (u.dv || '').toLowerCase().includes(q) || u.net === q || u.pk.startsWith(q));
    const sort = d.sort || 'seen';
    list.sort((a, b) => sort === 'rep' ? b.rep - a.rep : sort === 'lv' ? b.lv - a.lv : sort === 'nc' ? (b.nc || 0) - (a.nc || 0) : (b.online - a.online) || (b.seen - a.seen));
    cb({ ok: true, total: list.length, list: list.slice(0, 5000) });   // 全員を表示
  }));
  socket.on('adm_user', adm(async (d, cb) => { const pk = cleanPk(d.pk); if (!pk) return cb({ ok: false });
    const p = await getProf(pk), net = (MOD.seen[pk] || {}).net, e = ECO[pk];
    const same = net ? Object.keys(MOD.seen).filter(x => x !== pk && MOD.seen[x].net === net).slice(0, 20).map(userRow) : [];
    cb({ ok: true, u: userRow(pk), dv: p && p._dv ? p._dv : null, dvs: (p && p._dvs) || [], same, eco: e ? { c: e.c, w: e.w, bound: e.bound, flag: e.flag || null, fix: e.fix } : null, reports: ((MOD.reports[pk] || {}).list || []).slice(-30).reverse(), warns: (MOD.warns[pk] || []).slice(-20).reverse(), msgs: (MOD.pmsg[pk] || []).slice(-20).reverse() }); }));
  socket.on('adm_action', adm((d, cb) => {
    const pk = cleanPk(d.pk), act = d.act, text = txt(d.text, 300), now = Date.now();
    if (!pk) return cb({ ok: false, err: '相手がいません' });
    const sk = sockOf(byPk.get(pk));
    if (act === 'ban') {
      const days = Number(d.days), until = days > 0 ? now + days * 864e5 : 0;   // 0=無期限
      MOD.bans[pk] = { until, reason: text || '利用規約違反', by: socket.nmRegName || '運営', t: now }; applyBan(sk, MOD.bans[pk]);
    } else if (act === 'unban') { delete MOD.bans[pk]; applyBan(sk, null); }
    else if (act === 'warn') {
      if (!text) return cb({ ok: false, err: '警告の内容を入れてください' });
      const w = { id: MOD.nid++, text, t: now }; (MOD.warns[pk] = MOD.warns[pk] || []).push(w); MOD.warns[pk] = MOD.warns[pk].slice(-30); if (sk) sk.emit('warns', [w]);
    } else if (act === 'msg') {
      if (!text) return cb({ ok: false, err: 'メッセージを入れてください' });
      const m = { id: MOD.nid++, title: txt(d.title, 40) || '運営からのお知らせ', text, t: now }; (MOD.pmsg[pk] = MOD.pmsg[pk] || []).push(m); MOD.pmsg[pk] = MOD.pmsg[pk].slice(-30); if (sk) sk.emit('pmsgs', [m]);
    } else if (act === 'clearrep') delete MOD.reports[pk];
    else if (act === 'ncfix') {   // NCを指定した数に戻す（端末につながったときに反映）
      const c = Math.max(0, Math.round(Number(d.amount) || 0)); const e = ECO[pk] = ECO[pk] || { b: 0, bt: now };
      e.fix = c; delete e.flag; saveEco(); if (sk) sk.emit('nc_fix', { coins: c });
    }
    else if (act === 'ncok') { const e = ECO[pk]; if (e) { e.reset = true; delete e.flag; saveEco(); } }   // 問題なしとして、今の値を基準にし直す
    else if (act === 'gift') { if (!giveGift(pk, d.amount, txt(d.title, 40) || '運営からのプレゼント', text)) return cb({ ok: false, err: 'NCの数を入れてください' }); }
    else return cb({ ok: false, err: '不明な操作' });
    saveMod(); cb({ ok: true, u: userRow(pk) });
  }));
  // 全員へのお知らせ（アップデート・メンテナンスなど）
  socket.on('adm_notice', adm((d, cb) => {
    const title = txt(d.title, 60), body = txt(d.body, 2000), kind = KINDS[d.kind] ? d.kind : 'info';
    if (!title) return cb({ ok: false, err: 'タイトルを入れてください' });
    const gift = Math.max(0, Math.min(GIFT_MAX, Math.round(Number(d.gift) || 0)));   // お詫びNC（0なら無し）
    const n = { id: MOD.nid++, kind, title, body, t: Date.now(), pin: !!d.pin };
    if (gift) n.gift = gift;
    n.sig = signN(n);
    MOD.notices.unshift(n); MOD.notices = MOD.notices.slice(0, 100); saveMod();
    io.emit('notice_new', n); cb({ ok: true, n });
  }));
  socket.on('adm_notice_del', adm((d, cb) => { const id = parseInt(d.id, 10); MOD.notices = MOD.notices.filter(n => n.id !== id); delete MOD.claims[id]; saveMod(); io.emit('notices', MOD.notices); cb({ ok: true }); }));
  // NGワードの追加・削除（基本のリストに足す言葉）
  // 試合中のルーム一覧（運営の観戦用）
  socket.on('adm_rooms', adm((d, cb) => {
    const list = [];
    for (const R of rooms.values()) {
      if (!canWatch(R)) continue;
      const ps = [0, 1].map(i => { const sk = sockOf(R.ids[i]); return sk ? { name: R.names[i], pk: sk.nmPk || '', lv: R.lvs[i] } : (R.isCpu && i === 1 ? { name: 'CPU', pk: '', lv: R.lvs[i], cpu: 1 } : null); });
      if (!ps[0] || !ps[0].pk) continue;
      list.push({ mode: R.mode, ranked: !!R.ranked, cpu: !!R.isCpu, tut: !!R.tut, ps, sc: R.sc || [0, 0], rd: R.round || 0, spec: specVisible(R), me: !!(R.spec && R.spec.has(socket.id)) });
    }
    cb({ ok: true, list });
  }));
  socket.on('adm_ng', adm((d, cb) => {
    MOD.ng = MOD.ng || []; const w = txt(d.w, 20);
    if (d.act === 'add' && w && !MOD.ng.includes(w)) MOD.ng.push(w);
    if (d.act === 'del') MOD.ng = MOD.ng.filter(x => x !== w);
    MOD.ng = MOD.ng.slice(-300); saveMod(); cb({ ok: true, ng: MOD.ng });
  }));
  socket.on('adm_ngtest', adm((d, cb) => cb({ ok: true, out: ngMask(txt(d.text, 100)).text })));
  // フィードバック一覧・採用（採用するとNCをプレゼント）
  socket.on('adm_fb_list', adm((d, cb) => cb({ ok: true, list: MOD.feedback.slice(0, 300) })));
  socket.on('adm_fb_act', adm((d, cb) => {
    const id = parseInt(d.id, 10), f = MOD.feedback.find(x => x.id === id);
    if (!f) return cb({ ok: false, err: '見つかりません' });
    if (d.act === 'adopt') {
      const amount = Math.max(0, Math.min(GIFT_MAX, Math.round(Number(d.amount) || 0)));
      f.st = 'adopted'; f.reward = amount; f.at = Date.now();
      if (amount) giveGift(f.pk, amount, '💡 フィードバック採用', txt(d.text, 300) || 'あなたのフィードバックが採用されました！ありがとうございます。');
    } else if (d.act === 'reject') f.st = 'done';
    else if (d.act === 'del') MOD.feedback = MOD.feedback.filter(x => x.id !== id);
    else return cb({ ok: false });
    saveMod(); cb({ ok: true });
    const nn = MOD.feedback.filter(x => x.st === 'new').length; for (const s of adminSockets()) s.emit('adm_fbn', nn);
  }));
  // メンテナンスの開始・終了
  socket.on('adm_maint', adm((d, cb) => {
    if (d.on) { const until = Number(d.until) || 0; setMaint(true, { until: until > Date.now() ? until : 0, msg: txt(d.msg, 200), auto: !!d.auto }); }
    else setMaint(false);
    cb({ ok: true, maint: maintInfo() });
  }));

  socket.data = {};
  const rp = cb => (typeof cb === 'function' ? cb : () => {});
  const myRoom = () => rooms.get(socket.data && socket.data.code);

  // 接続のたびに：ログインID（非公開）を登録し、ユーザー名を名簿で確認（未登録なら登録、他人が使用中なら変更をお願いする）
  socket.on('hello', d => {
    const id = clean(d && d.id, ''), uid = cleanUid(d && d.uid);
    if (!id || !uid) return;
    const owner = owners.get(id), sid = byId.get(id);
    if (owner && owner !== uid && sid && sid !== socket.id && sockOf(sid)) { socket.emit('id_conflict'); return; }
    owners.set(id, uid);
    socket.nmId = id; byId.set(id, socket.id); socket.nmUid = uid;
    const pk = pkOf(uid);
    if (socket.nmPk && socket.nmPk !== pk && byPk.get(socket.nmPk) === socket.id) byPk.delete(socket.nmPk);
    socket.nmPk = pk; byPk.set(pk, socket.id);
    socket.nmLv = clamp(parseInt(d && d.lv, 10) || 1, 1, 99);
    socket.nmName = validName(d && d.name) || '';
    socket.nmDv = deviceOf(socket, d && d.dv);
    socket.nmBlocks = new Set((Array.isArray(d && d.blocks) ? d.blocks : []).map(cleanPk).filter(Boolean).slice(0, 200));
    const lf = cleanFid(d && d.fid); if (lf) { socket.nmFid = lf; byFid.set(lf, socket.id); }
    const n = validName(d && d.name), why = nameProblem(n, uid);
    if (!why) {
      claimName(n, uid, pk); socket.nmRegName = n; socket.emit('name_status', { ok: true, name: n });
      socket.emit('friend_inbox', inboxOf(pk));
      const nt = fnote.get(pk); if (nt && nt.length) { nt.forEach(x => { x.name = nameOfPk(x.pk) || x.name || ''; }); socket.emit('friend_notice', nt); fnote.delete(pk); saveFriends(); }
      restoreBoards.season = clean(d && d.season, '');
      restoreBoards(id, n, clamp(parseInt(d && d.best, 10) || 0, 0, 1e7), clamp(parseInt(d && d.rp, 10) || 0, 0, 99999), socket.nmLv, clean(d && d.ttl, 'rookie'), d ? parseInt(d.bestC, 10) : undefined);
    }
    else { socket.nmRegName = null; socket.emit('name_status', { ok: false, reason: why, name: n || '', suggest: suggestName() }); }
    deliverMod(socket);   // 停止・警告・お知らせ・管理者かどうか
    socket.emit('season', seasonInfo());
    const e = ECO[pk]; if (e && e.fix != null) socket.emit('nc_fix', { coins: e.fix });
  });
  // ユーザー名：入力中の空きチェック／登録（変更）／おまかせ候補
  socket.on('name_check', (v, cb) => { const n = validName(v), why = nameProblem(n, socket.nmUid); rp(cb)(why ? { ok: false, reason: why } : { ok: true, name: n }); });
  socket.on('name_suggest', (d, cb) => { if (typeof d === 'function') cb = d; rp(cb)({ name: suggestName() }); });
  socket.on('name_claim', (v, cb) => {
    if (!socket.nmUid) return rp(cb)({ ok: false, reason: 'nohello' });
    const now = Date.now(); if (now - (socket.lastNameT || 0) < 1500) return rp(cb)({ ok: false, reason: 'busy' }); socket.lastNameT = now;
    const n = validName(v), why = nameProblem(n, socket.nmUid);
    if (why) return rp(cb)({ ok: false, reason: why, suggest: suggestName() });
    claimName(n, socket.nmUid, socket.nmPk); socket.nmRegName = n; if (MOD.seen[socket.nmPk]) MOD.seen[socket.nmPk].n = n;
    restoreBoards(socket.nmId, n, 0, 0, socket.nmLv, 'rookie');   // ランキングの表示名も新しい名前に
    const R = myRoom(); if (R && R.state === 'lobby' && socket.data.slot != null) { R.names[socket.data.slot] = n; sendRoom(R); }
    rp(cb)({ ok: true, name: n });
  });
  // フレンドの在席状況（内部キーで問い合わせ。名前が変わっても追いかける。v6以前の登録は自動で移行）
  socket.on('friends_status', (list, cb) => {
    const o = {};
    (Array.isArray(list) ? list.slice(0, 50) : []).forEach(f => {
      if (cleanPk(f)) { const sid = byPk.get(f), sk = sockOf(sid), R = sk && sk.data && rooms.get(sk.data.code); o[f] = { s: statusOf(sid), name: nameOfPk(f) || undefined, lv: sk ? sk.nmLv : undefined, w: canWatch(R) ? (R.ranked ? 'rank' : R.mode === 'endless' ? 'run' : R.isCpu ? 'cpu' : 'vs') : undefined }; }
      else if (cleanFid(f) || isLoginId(f)) {
        const sid = cleanFid(f) ? byFid.get(f) : byId.get(f), sk = sockOf(sid);
        o[f] = { s: statusOf(sid), pk: sk && sk.nmPk ? sk.nmPk : undefined, name: sk && sk.nmRegName ? sk.nmRegName : undefined };
      }
    });
    rp(cb)(o);
  });
  // ユーザー名でフレンド検索（完全一致＋前方一致。オフラインの人も名簿から見つかる）
  socket.on('friend_lookup', (q, cb) => {
    const raw = typeof q === 'string' ? q.normalize('NFKC').trim().slice(0, 12) : '';
    if (!raw) return rp(cb)({ list: [] });
    const k = nkey(raw), out = [], add = e => { const sid = byPk.get(e.pk), sk = sockOf(sid); out.push({ name: e.name, pk: e.pk, s: statusOf(sid), lv: sk ? sk.nmLv : null, me: e.pk === socket.nmPk }); };
    const ex = nameReg.get(k); if (ex) add(ex);
    if (k.length >= 1) for (const [kk, e] of nameReg) { if (out.length >= 8) break; if (kk !== k && kk.startsWith(k)) add(e); }
    rp(cb)({ list: out });
  });
  socket.on('ranking', (d, cb) => { if (typeof d === 'function') cb = d; rp(cb)({ top: topN(30, socket.nmId) }); });
  socket.on('pg', (d, cb) => rp(cb)(1));   // 通信の遅れを測る（操作の先読み補正に使用）
  // 端末バックアップ用の署名つきランキング／復元
  socket.on('rank_backup', (d, cb) => { if (typeof d === 'function') cb = d; rp(cb)({ run: ranking.map(e => entryOut('run', e)), rp: rpBoard.map(e => entryOut('rp', e)), mine: { run: myEntry('run', socket.nmId), rp: myEntry('rp', socket.nmId) } }); });
  socket.on('rank_restore', (d, cb) => {
    if (socket.restored || !d || typeof d !== 'object') return rp(cb)({ added: 0 });
    socket.restored = true;
    rp(cb)({ added: restoreSigned('run', d.run) + restoreSigned('rp', d.rp) });
  });
  socket.on('rank_top', (d, cb) => { if (typeof d === 'function') cb = d; rp(cb)({ top: rpTop(30, socket.nmId), season: seasonInfo() }); });
  socket.on('rank_report', (d, cb) => {
    if (!socket.rkOk || !d) return rp(cb)({ ok: false });
    socket.rkOk = false;
    const id = clean(d.id, ''); if (!id) return rp(cb)({ ok: false });
    if (d.season !== SEASON.id) return rp(cb)({ ok: false, err: 'season' });
    rp(cb)({ ok: true, rank: submitRp(id, socket.nmRegName || 'ゲスト', clamp(parseInt(d.rp, 10) || 0, 0, 99999), clamp(parseInt(d.lv, 10) || 1, 1, 99), clean(d.ttl, 'rookie')) });
  });
  // ランクマッチの待ち行列に入る／抜ける
  socket.on('rank_q', d => {
    leaveRoom(socket); qRemove(socket.id);
    const L = look(d, 'プレイヤー');
    rankQ.push({ sid: socket.id, rp: L.rp, t0: Date.now(), d });
    socket.emit('rank_wait', { t: 0, n: rankQ.length, bot: BOT_AFTER });
    tryMatch();
  });
  socket.on('rank_cancel', () => qRemove(socket.id));

  socket.on('solo', d => {
    leaveRoom(socket); qRemove(socket.id);
    const code = 'SOLO_' + socket.id, R = newRoom(code, socket, d, { isCpu: true });
    if (d && d.tut) { R.skill = 0.05; R.tut = true; }   // 練習モード：とても弱いCPU
    setLook(R, 1, { name: 'CPU', bike: ['std', 'road', 'mtb', 'bmx', 'mini'][Math.floor(Math.random() * 5)], skin: ['default', 'gold', 'cyber', 'ocean'][Math.floor(Math.random() * 4)], hair: ['helmet', 'short_b', 'spiky'][Math.floor(Math.random() * 3)], fit: ['jersey', 'racer', 'hoodie'][Math.floor(Math.random() * 3)], acc: 'none', trail: 'none', lv: clamp((R.lvs[0] || 1) + Math.floor(rnd(-2, 3)), 1, 99), pid: '', pk: '', ttl: 'rookie', pl: 'normal', rp: 0 });
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    resetMatch(R);
    socket.emit('start', { slot: 0, course: R.course, mode: 'versus', room: false, opp: oppInfo(R, 1) });
  });
  socket.on('endless', d => {
    leaveRoom(socket); qRemove(socket.id);
    const code = 'RUN_' + socket.id, R = newRoom(code, socket, d, { mode: 'endless' });
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    resetEndless(R);
    socket.emit('start', { slot: 0, course: R.course, mode: 'endless', room: false });
  });
  socket.on('create', (d, cb) => {
    if (typeof d === 'function') { cb = d; d = {}; }
    leaveRoom(socket); qRemove(socket.id);
    let code; do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
    const R = newRoom(code, socket, d);
    R.state = 'lobby';
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    rp(cb)({ code });
    sendRoom(R);
  });
  socket.on('join', (d, cb) => {
    const code = (d && typeof d === 'object') ? d.code : d;
    joinRoom(socket, rooms.get(String(code)), d, rp(cb));
  });
  // フレンドの部屋にワンタップ参加（部屋コード不要）
  socket.on('join_friend', (d, cb) => {
    const tp = cleanPk(d && d.targetPk);
    const R = [...rooms.values()].find(r => tp && r.hostPk === tp && r.mode === 'versus' && r.state === 'lobby' && !r.ids[1] && !r.isCpu && r.ids[0] !== socket.id);
    if (!R) return rp(cb)({ ok: false, err: 'フレンドは今ルームで待っていません' });
    joinRoom(socket, R, d, rp(cb));
  });
  socket.on('room_ready', v => { const R = myRoom(); if (!R || R.state !== 'lobby' || socket.data.slot !== 1) return; R.ready[1] = !!v; sendRoom(R); });
  // ===== フレンド申請（承認制） =====
  socket.on('friend_req', (to, cb) => {
    const me = socket.nmPk; to = cleanPk(to);
    if (!me || !socket.nmRegName) return rp(cb)({ ok: false, err: 'ユーザー名を登録してから申請してください' });
    if (!to || to === me) return rp(cb)({ ok: false, err: 'このプレイヤーには申請できません' });
    if (!nameOfPk(to)) return rp(cb)({ ok: false, err: 'プレイヤーが見つかりません' });
    const tsk = sockOf(byPk.get(to)); if ((tsk && tsk.nmBlocks && tsk.nmBlocks.has(me)) || (socket.nmBlocks && socket.nmBlocks.has(to))) return rp(cb)({ ok: true, state: 'sent', name: nameOfPk(to) });
    if (delReq(me, to)) {   // 相手からも申請が来ていた → その場で成立
      notify(to, { t: 'acc', pk: me }); pushInbox(me);
      return rp(cb)({ ok: true, state: 'mutual', name: nameOfPk(to) });
    }
    const m = freq.get(to) || new Map();
    if (!m.has(me) && m.size >= 50) return rp(cb)({ ok: false, err: '相手の申請がいっぱいです' });
    m.set(me, Date.now()); freq.set(to, m); saveFriends(); pushInbox(to);
    rp(cb)({ ok: true, state: 'sent', name: nameOfPk(to) });
  });
  socket.on('friend_inbox', (d, cb) => { if (typeof d === 'function') cb = d; rp(cb)(socket.nmPk ? inboxOf(socket.nmPk) : []); });
  socket.on('friend_answer', (d, cb) => {
    const me = socket.nmPk, from = cleanPk(d && d.pk);
    if (!me || !from || !delReq(me, from)) return rp(cb)({ ok: false, err: '申請が見つかりません（取り消された可能性があります）' });
    notify(from, { t: d.ok ? 'acc' : 'dec', pk: me });
    rp(cb)({ ok: true, name: nameOfPk(from) });
  });
  socket.on('friend_cancel', to => { const me = socket.nmPk; to = cleanPk(to); if (me && to && delReq(to, me)) pushInbox(to); });
  socket.on('friend_remove', to => {   // 片方が削除したら、相手のリストからも消える
    const me = socket.nmPk; to = cleanPk(to); if (!me || !to) return;
    delReq(to, me); delReq(me, to); notify(to, { t: 'rm', pk: me });
  });
  // ホストがゲストをキック（そのルームには再参加できない）
  socket.on('room_kick', () => {
    const R = myRoom(); if (!R || R.state !== 'lobby' || socket.data.slot !== 0 || !R.ids[1]) return;
    const gs = sockOf(R.ids[1]);
    R.banned = R.banned || new Set(); if (R.pks[1]) R.banned.add(R.pks[1]);
    const name = R.names[1];
    R.ids[1] = null; R.ready = [false, false]; R.names[1] = 'プレイヤー2'; R.pks[1] = '';
    if (gs) { gs.data = {}; gs.emit('kicked', { code: R.code }); }
    socket.emit('room_note', { t: 'kicked', name });
    sendRoom(R);
  });
  socket.on('room_course', v => { const R = myRoom(); if (!R || R.state !== 'lobby' || socket.data.slot !== 0) return; R.course = cleanCourse(v); sendRoom(R); });
  socket.on('room_look', d => { const R = myRoom(); if (!R || R.state !== 'lobby') return; setLook(R, socket.data.slot, lookS(socket, d, R.names[socket.data.slot])); sendRoom(R); });
  socket.on('room_start', () => {
    const R = myRoom();
    if (!R || R.state !== 'lobby' || socket.data.slot !== 0) return;
    if (!R.ids[1]) return socket.emit('room_note', { t: 'need_guest' });
    if (!R.ready[1]) return socket.emit('room_note', { t: 'need_ready' });
    startRoomMatch(R);
  });
  socket.on('toroom', () => {
    const R = myRoom();
    if (!R || R.isCpu || R.mode !== 'versus' || R.state !== 'match') return;
    R.state = 'lobby'; R.ready = [false, false]; R.P = []; R.obs = [];
    sendRoom(R);
  });
  // チャット・エモート（ルーム内の2人に配信）
  socket.on('chat', d => {
    const R = myRoom(); if (!R || R.mode === 'endless') return;
    const nowT = Date.now(); if (nowT - (socket.lastChat || 0) < 600) return; socket.lastChat = nowT;
    const t = d && d.t; let v = d && d.v;
    if (t === 'e') { if (!EMOTES.includes(v)) return; }
    else if (t === 'x') { v = cleanText(v, 30); if (!v) return; v = ngMask(v).text; }   // NGワード・個人情報は＊に
    else return;
    const slot = socket.data.slot, msg = { from: slot, name: R.names[slot], t, v };
    for (const i of [0, 1]) if (R.ids[i]) { const rs = sockOf(R.ids[i]); if (rs && rs !== socket && rs.nmBlocks && rs.nmBlocks.has(socket.nmPk)) continue; io.to(R.ids[i]).emit('chat', msg); }   // ブロックした相手のチャットは届けない
    if (R.spec) for (const sid of R.spec) io.to(sid).emit('chat', msg);
    if (R.isCpu && Math.random() < 0.6) setTimeout(() => {
      if (!rooms.has(R.code) || !R.ids[0]) return;
      const emo = Math.random() < 0.4;
      io.to(R.ids[0]).emit('chat', { from: 1, name: 'CPU', t: emo ? 'e' : 'x', v: emo ? EMOTES[Math.floor(Math.random() * 6)] : CPU_LINES[Math.floor(Math.random() * CPU_LINES.length)] });
    }, 900 + Math.random() * 900);
  });
  socket.on('inp', d => {
    const R = myRoom(); if (!R) return;
    R.inp[socket.data.slot] = (d && Number.isFinite(d.s)) ? { s: clamp(d.s, -1, 1) } : { l: !!(d && d.l), r: !!(d && d.r) };
  });
  socket.on('act', d => {
    const R = myRoom(); if (!R) return;
    R.act[socket.data.slot] = true;
    R.actK[socket.data.slot] = (d && d.k === 'brake') ? 'brake' : 'boost';
  });
  socket.on('again', () => {
    const R = myRoom(); if (!R) return;
    if (R.mode === 'endless') { if (R.state === 'over') resetEndless(R); }
    else if (R.state === 'match' && !R.ranked) resetMatch(R);   // ランクマッチは毎回マッチングし直す
  });
  socket.on('leave', () => { qRemove(socket.id); leaveRoom(socket); });
  // フレンドの試合を観戦する（見るだけ。操作やチャットはできない）
  socket.on('spectate', (d, cb) => {
    const pk = cleanPk(d && d.pk), sid = pk && byPk.get(pk), sk = sockOf(sid);
    const hid = !!(d && d.hidden && socket.isAdmin);   // 運営の観戦は相手に表示しない
    if (!sk) return rp(cb)({ ok: false, err: hid ? 'そのプレイヤーはオフラインです' : 'フレンドはオフラインです' });
    if (sid === socket.id) return rp(cb)({ ok: false, err: '自分は観戦できません' });
    const R = rooms.get(sk.data && sk.data.code);
    if (!canWatch(R)) return rp(cb)({ ok: false, err: '今は試合をしていません' });
    R.spec = R.spec || new Set();
    if (!hid && !R.spec.has(socket.id) && specVisible(R) >= SPEC_MAX) return rp(cb)({ ok: false, err: '観戦の人数がいっぱいです（' + SPEC_MAX + '人まで）' });
    qRemove(socket.id); leaveRoom(socket);
    R.spec.add(socket.id); specs.set(socket.id, R.code);
    R.hid = R.hid || new Set(); if (hid) R.hid.add(socket.id); else R.hid.delete(socket.id);
    const follow = R.ids[0] === sid ? 0 : 1;
    rp(cb)({ ok: true });
    socket.emit('spec_start', { hidden: hid, follow, mode: R.mode, course: R.course || 0, names: R.names, ranked: !!R.ranked, cpu: !!R.isCpu, target: nameOfPk(pk) || R.names[follow],
      players: [0, 1].map(i => (R.ids[i] || (R.isCpu && i === 1)) ? { name: R.names[i], lv: R.lvs[i], bike: R.bikes[i], skin: R.skins[i], hair: R.hairs[i], fit: R.fits[i], acc: R.accs[i], trail: R.trails[i] } : null) });
    specCount(R);
  });
  socket.on('spec_leave', () => specLeave(socket));
  socket.on('disconnect', () => {
    if (socket.nmId && byId.get(socket.nmId) === socket.id) byId.delete(socket.nmId);
    if (socket.nmFid && byFid.get(socket.nmFid) === socket.id) byFid.delete(socket.nmFid);
    if (socket.nmPk && byPk.get(socket.nmPk) === socket.id) byPk.delete(socket.nmPk);
    qRemove(socket.id); leaveRoom(socket); specLeave(socket);
  });
});

const PORT = process.env.PORT || 3000;
// 保存データを読み込んでから受付開始
(async () => {
  for (const [key, file, fn] of [['names', NAMES_FILE, loadNames], ['ranking', RANK_FILE, loadRanking], ['rp', RP_FILE, loadRp], ['friends', FR_FILE, loadFriends], ['mod', MOD_FILE, loadMod], ['season', SEASON_FILE, loadSeason], ['eco', ECO_FILE, loadEco], ['prof', PROF_FILE, loadProf]]) {
    try { fn(await STORE.load(key, file)); } catch (e) { console.warn('読み込みエラー(' + key + '):', e.message); }
  }
  checkSeason();
  console.log('保存先: ' + (useKV ? 'Upstash Redis' : 'JSONファイル') + ' / 名簿 ' + nameReg.size + '人 / ランキング ' + ranking.length + '件 / RP ' + rpBoard.length + '件');
  server.listen(PORT, () => console.log('listening on ' + PORT));
  // Render無料プランのスリープ（＝保存データが消える）を防ぐため、自分のURLへ10分ごとにアクセス
  // （Upstashを設定済みなら不要なので動かさない。止めたいときは環境変数 KEEP_AWAKE=0）
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl && !useKV && process.env.KEEP_AWAKE !== '0') {
    setInterval(() => { fetch(selfUrl + '/api/ping').catch(() => {}); }, 10 * 60 * 1000);
    console.log('スリープ防止: ON（' + selfUrl + '）');
  }
})();
