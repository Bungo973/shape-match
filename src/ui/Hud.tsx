// 战斗中的状态栏：玩家、敌人、神器条与结算明细。交换模式与嵌片卡模式共用。
import { DEFAULT_CONFIG, poisonDecay, poisonThreshold, type ActionLog, type ArtifactKey, type BattleState, type Intent } from '../engine';
import { ArtifactCard } from './components';

export const REASON_TEXT: Record<string, string> = {
  sameColor: '同色方块不能交换',
  notAdjacent: '只能交换相邻的格子',
  noAp: '行动力不足',
  notBomb: '只能点燃炸弹',
  battleOver: '战斗已结束',
  outOfBounds: '卡片必须整块放在棋盘内',
  badShape: '形状不符',
  noCard: '没有这张卡',
  cardMode: '卡牌模式下不能交换',
};

function intentText(intent: Intent, chargeBonus: number): string {
  return intent.parts
    .map((p) => {
      switch (p.kind) {
        case 'attack':
          return `攻击 ${p.amount + chargeBonus}`;
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
      }
    })
    .join(' · ');
}

export function Bar({ value, max, kind = 'hp' }: { value: number; max: number; kind?: 'hp' | 'poison' }) {
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
        <span className="chip shield" title={DEFAULT_CONFIG.playerShieldRetain < 1 ? '护盾只挡本回合的敌人行动，敌人行动后清空' : undefined}>
          护盾 {b.player.shield}
          {DEFAULT_CONFIG.playerShieldRetain < 1 && <small className="dim">本回合</small>}
        </span>
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
      </div>
    </div>
  );
}

export function ArtifactStrip({ artifacts }: { artifacts: ArtifactKey[] }) {
  return (
    <div className="artifact-strip">
      {artifacts.map((k) => (
        <ArtifactCard key={k} k={k} compact />
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
      <Bar value={b.enemy.hp} max={b.enemy.def.maxHp} />
      <div className="row">
        <span className="chip shield">护盾 {b.enemy.shield}</span>
        <span className="chip intent">意图：{b.enemy.stunPending ? '（将被眩晕取消）' : intentText(b.enemy.intent, b.enemy.chargeBonus)}</span>
      </div>
      <div className="row">
        <span className="label">毒气</span>
        <Bar value={b.enemy.poison} max={poisonThreshold(b.enemy.def.maxHp)} kind="poison" />
        <span className="note">回合末 −{poisonDecay(b.enemy.def.maxHp)}</span>
      </div>
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
            <b className="c-atk">伤害 {st.finalEffects.attack}</b>
            <b className="c-sh">护盾 {st.finalEffects.shield}</b>
            <b className="c-po">毒气 {st.finalEffects.poison}</b>
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
