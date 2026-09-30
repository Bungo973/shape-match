// 战斗中的状态栏：玩家、敌人、神器条与结算明细。交换模式与嵌片卡模式共用。
import { BOMB_NAME, BOMB_UPGRADES, DEFAULT_CONFIG, playerShieldCap, poisonDecay, poisonThreshold, type ActionLog, type ArtifactKey, type BattleState, type Intent } from '../engine';
import { ArtifactCard } from './components';

export const REASON_TEXT: Record<string, string> = {
  sameColor: '同色方块不能交换',
  noMatch: '这样交换不能消除',
  notAdjacent: '只能交换相邻的格子',
  noAp: '行动力不足',
  notBomb: '只能点燃炸弹',
  battleOver: '战斗已结束',
  outOfBounds: '卡片必须整块放在棋盘内',
  badShape: '形状不符',
  noCard: '没有这张卡',
  cardMode: '卡牌模式下不能交换',
  stone: '石块不能交换，只能用炸弹炸掉',
};

const COLOR_NAME = { attack: '攻击', shield: '护盾', poison: '毒气', catalyst: '催化剂' } as const;

/** bonus：蓄力与强化带来的攻击加成 */
function intentText(intent: Intent, bonus: number): string {
  return intent.parts
    .map((p) => {
      switch (p.kind) {
        case 'attack':
          return p.pierce ? `穿刺攻击 ${p.amount + bonus}（一半无视护盾）` : `攻击 ${p.amount + bonus}`;
        case 'defend':
          return `防御 ${p.amount}`;
        case 'charge':
          return `蓄力 +${p.amount}`;
        case 'erodeMultiplier':
          return '侵蚀倍率';
        case 'suppressInsert':
          return '压制嵌片';
        case 'gravityUp':
          return '重力反转';
        case 'sealColor':
          return p.color ? `色封：${COLOR_NAME[p.color]}方块` : '色封';
        case 'petrify':
          return p.row != null ? `石化第 ${p.row + 1} 行 ${p.count} 格` : `石化 ${p.count} 格`;
        case 'shatter':
          return `碎甲（下回合护盾上限 ${Math.floor(DEFAULT_CONFIG.playerShieldCap * DEFAULT_CONFIG.shatterCapRatio)}）`;
        case 'empower':
          return `强化 +${p.amount}`;
      }
    })
    .join(' · ');
}

export function Bar({ value, max, kind = 'hp' }: { value: number; max: number; kind?: 'hp' | 'poison' | 'score' }) {
  return (
    <div className={`bar ${kind}`}>
      <div className="fill" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
      <span>
        {value} / {max}
      </span>
    </div>
  );
}

export function PlayerPanel({ b, gold, apLabel = '行动力' }: { b: BattleState; gold?: number; apLabel?: string }) {
  return (
    <div className="panel player-panel">
      <div className="name">
        炼成师 {gold !== undefined && <span className="turn">金币 {gold}</span>}
      </div>
      <Bar value={b.player.hp} max={b.player.maxHp} />
      <div className="row">
        {!b.goal && <span className="chip shield" title={DEFAULT_CONFIG.playerShieldRetain < 1 ? '护盾只挡本回合的敌人行动，敌人行动后清空' : undefined}>
          护盾 {b.player.shield}
          {DEFAULT_CONFIG.playerShieldRetain < 1 && <small className="dim">本回合</small>}
        </span>}
        <span className="chip">
          {apLabel}
          {Array.from({ length: Math.max(DEFAULT_CONFIG.apPerTurn, b.ap) }, (_, i) => (
            <i key={i} className={`pip ${i < b.ap ? 'on' : ''}`} />
          ))}
        </span>
        <span className="chip catalyst">
          充能
          {Array.from({ length: DEFAULT_CONFIG.chargeCap }, (_, i) => (
            <i key={i} className={`pip violet ${i < b.player.catalystCharges ? 'on' : ''}`} />
          ))}
        </span>
        <span className={`chip ${b.gravity === 'up' ? 'warn' : ''}`}>重力 {b.gravity === 'up' ? `↑ 剩 ${b.gravityTurnsLeft} 回合` : '↓'}</span>
        {b.current.erosionArmed && <span className="chip warn">倍率被侵蚀</span>}
        {b.current.shattered && (
          <span className="chip warn" title="碎甲：本回合护盾上限降低">
            碎甲：护盾上限 {playerShieldCap(b)}
          </span>
        )}
        {b.current.sealedColor && (
          <span className="chip warn" title="本回合该色方块每块只计 1 基数">
            {COLOR_NAME[b.current.sealedColor]}被色封
          </span>
        )}
      </div>
    </div>
  );
}

/** 本场爆破等级：等级与到下一级的进度；n 级时炸掉的每块多计 n−1 基数 */
export function BombHeatPanel({ b }: { b: BattleState }) {
  return (
    <div className="bomb-heat" title="本场每引爆若干枚该类炸弹升一级；n 级时它炸掉的每块方块多计 n−1 基数。每场重置，起始等级来自炸弹升级。">
      <div className="bomb-heat-title">爆破等级（本场）</div>
      {BOMB_UPGRADES.map((k) => {
        const h = b.bombHeat[k];
        const every = DEFAULT_CONFIG.bombHeatEvery[k];
        return (
          <div key={k} className={`bomb-heat-row ${h.level > 1 ? 'hot' : ''}`}>
            <span className="name">{BOMB_NAME[k]}</span>
            <b>{h.level} 级</b>
            <span className="meter">
              <i style={{ width: `${(h.count / every) * 100}%` }} />
            </span>
            <span className="dim">
              {h.count}/{every}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ArtifactStrip({ artifacts, counters }: { artifacts: ArtifactKey[]; counters?: Partial<Record<ArtifactKey, number>> }) {
  return (
    <div className="artifact-strip">
      {artifacts.map((k) => (
        <ArtifactCard key={k} k={k} compact progress={counters?.[k] ?? 0} />
      ))}
    </div>
  );
}

export function EnemyPanel({ b, battleIndex }: { b: BattleState; battleIndex: number }) {
  return (
    <div className="panel enemy-panel">
      <div className="name">
        {b.enemy.def.name}{' '}
        <span className="turn">
          第 {battleIndex} 战 · 第 {b.turn} 回合
        </span>
      </div>
      {b.goal ? (
        <>
          <Bar value={b.totalScore} max={b.goal.target} kind="score" />
          <div className="row">
            <span className="chip intent">
              目标分 {b.goal.target} · 第 {b.turn} / {b.goal.turns} 回合
            </span>
            <span className="note">未达标：按差距比例扣生命</span>
          </div>
        </>
      ) : (
        <>
      <Bar value={b.enemy.hp} max={b.enemy.def.maxHp} />
      <div className="row">
        <span className="chip shield">护盾 {b.enemy.shield}</span>
        <span className="chip intent">意图：{b.enemy.stunPending ? '（将被眩晕取消）' : intentText(b.enemy.intent, b.enemy.chargeBonus + (b.enemy.strength ?? 0))}</span>
        {(b.enemy.strength ?? 0) > 0 && (
          <span className="chip warn" title="强化：此后每次攻击都加上这个数">
            强化 +{b.enemy.strength}
          </span>
        )}
      </div>
      <div className="row">
        <span className="label">毒气</span>
        <Bar value={b.enemy.poison} max={poisonThreshold(b.enemy.def.maxHp)} kind="poison" />
        <span className="note">回合末 −{poisonDecay(b.enemy.def.maxHp)}</span>
      </div>
        </>
      )}
    </div>
  );
}

export function SettlePanel({ b, lastLog, hint, className = '' }: { b: BattleState; lastLog: ActionLog | null; hint: string; className?: string }) {
  const st = lastLog?.settlement;
  const A = lastLog?.result.activeClearsByType;
  return (
    <div className={`panel settle-panel ${className}`}>
      {st && A && lastLog ? (
        <>
          <div className="settle-row">
            <span className="label">主动基数</span>
            <b className="c-atk">攻 {st.baseValues.attack}</b>
            <b className="c-sh">盾 {st.baseValues.shield}</b>
            <b className="c-po">毒 {st.baseValues.poison}</b>
            <span className="dim">
              （方块 攻{A.attack} 盾{A.shield} 毒{A.poison} 催{A.catalyst}
              {artifactBonusText(lastLog)}
              {st.chargesUsed > 0 ? `，充能各 +${st.chargesUsed * DEFAULT_CONFIG.chargeBonus}` : ''}
              {lastLog.result.socketBonuses.attack + lastLog.result.socketBonuses.shield + lastLog.result.socketBonuses.poison > 0 ? '，含加成' : ''}）
            </span>
          </div>
          <div className="settle-row big">
            <span className="mult">× {st.multiplier}</span>
            <span className="dim">
              被动清除 {lastLog.result.passiveClearCount}
              {lastLog.erosionConsumed ? '，被侵蚀降一档' : ''}
            </span>
            <span className="eq">=</span>
            {b.goal ? (
              <b className="c-score">得分 {st.settlementScore}</b>
            ) : (
              <>
                <b className="c-atk">伤害 {st.finalEffects.attack}</b>
                <b className="c-sh">护盾 {st.finalEffects.shield}</b>
                <b className="c-po">毒气 {st.finalEffects.poison}</b>
              </>
            )}
          </div>
          <div className="settle-row dim">
            结算分 {st.settlementScore} · 本场累计 {b.totalScore}
            {st.chargesGained > 0 ? ` · 新充能 +${st.chargesGained}` : ''}
            {lastLog.result.overloadFired ? ' · 过载：本步不获得护盾' : ''}
          </div>
        </>
      ) : (
        <div className="dim">{hint}</div>
      )}
    </div>
  );
}

/** 条件基数类神器本步追加的基数，例如“，神器 攻+3” */
function artifactBonusText(log: ActionLog): string {
  const b = log.artifactBaseBonus;
  const parts = (['attack', 'shield', 'poison', 'catalyst'] as const).filter((c) => b[c] > 0).map((c) => `${SHORT[c]}+${b[c]}`);
  return parts.length ? `，神器 ${parts.join(' ')}` : '';
}

const SHORT = { attack: '攻', shield: '盾', poison: '毒', catalyst: '催' } as const;

