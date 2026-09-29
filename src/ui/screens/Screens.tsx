// 非战斗阶段的各个画面：开局神器、路线页、战后奖励、精英神器、营地、结果页。
import { useState } from 'react';
import { campUpgradeAmount, DEFAULT_CONFIG, UPGRADE_KEYS, type ArtifactKey, type RunState, type UpgradeKey } from '../../engine';
import { ArtifactCard, UpgradeCard } from '../components';

const LEVEL_SHORT: Record<UpgradeKey, string> = { attack: '攻', shield: '盾', poison: '毒', catalyst: '催', line: '直线', area: '3×3', color: '五连' };

const TIER_TEXT = { minion: '小怪', elite: '精英', boss: '首领' } as const;

export function StarterScreen({ run, onPick }: { run: RunState; onPick: (k: ArtifactKey) => void }) {
  return (
    <div className="screen">
      <h2>选择一件起始神器</h2>
      <p className="sub">神器整局持续生效，满足条件自动触发。</p>
      <div className="cards">
        {run.starterChoices.map((k) => (
          <ArtifactCard key={k} k={k} onPick={() => onPick(k)} />
        ))}
      </div>
    </div>
  );
}

export function MapScreen({ run, onStart }: { run: RunState; onStart: () => void }) {
  return (
    <div className="screen">
      <h2>地下入口 · 第一段落</h2>
      <div className="route">
        {run.route.map((node, i) => {
          const n = i + 1;
          const state = n <= run.battleIndex ? 'done' : n === run.battleIndex + 1 ? 'next' : 'later';
          return (
            <div key={n} className={`node ${state} tier-${node.tier}`}>
              <div className="node-idx">第 {n} 战</div>
              <div className="node-name">{node.enemy.name}</div>
              <div className="node-tier">{TIER_TEXT[node.tier]}</div>
              {state === 'done' && <div className="node-mark">已击败</div>}
            </div>
          );
        })}
      </div>
      <RunSummary run={run} />
      <div className="actions">
        <button className="primary" onClick={onStart}>
          开始第 {run.battleIndex + 1} 战
        </button>
      </div>
    </div>
  );
}

function RunSummary({ run }: { run: RunState }) {
  return (
    <div className="summary">
      <span>
        生命 {run.player.hp} / {run.player.maxHp}
      </span>
      {DEFAULT_CONFIG.playerShieldCarryOver ? <span>护盾 {run.player.shield}</span> : null}
      <span>金币 {run.gold}</span>
      <span className="levels-summary">
        升级
        {UPGRADE_KEYS.map((k) => (
          <span key={k} className={run.levels[k] > 1 ? '' : 'dim'}>
            {LEVEL_SHORT[k]} {run.levels[k]}
          </span>
        ))}
      </span>
      <div className="summary-artifacts">
        {run.artifacts.map((k) => (
          <ArtifactCard key={k} k={k} compact />
        ))}
      </div>
    </div>
  );
}

export function RewardScreen({ run, onPick, onReroll }: { run: RunState; onPick: (i: number) => void; onReroll: (keep?: number) => void }) {
  const reward = run.reward!;
  const [keep, setKeep] = useState<number | null>(null);
  const goggles = run.artifacts.includes('scavengerGoggles');
  return (
    <div className="screen">
      <h2>胜利！获得 {reward.goldGained} 金币</h2>
      <p className="sub">选择一项升级，立即生效并持续整局。</p>
      <div className="cards">
        {reward.choices.map((c, i) => (
          <div key={`${c.key}-${i}`} className="card-wrap">
            <UpgradeCard upKey={c.key} level={run.levels[c.key]} slot={c.slot} onPick={() => onPick(i)} selected={keep === i} />
            {goggles && (
              <label className="keep">
                <input type="radio" name="keep" checked={keep === i} onChange={() => setKeep(i)} /> 重掷时保留
              </label>
            )}
          </div>
        ))}
      </div>
      <div className="actions">
        <span className="sub">金币 {run.gold}</span>
        <button disabled={run.gold < DEFAULT_CONFIG.rerollCost} onClick={() => onReroll(keep ?? undefined)}>
          重掷（{DEFAULT_CONFIG.rerollCost} 金币）
        </button>
      </div>
    </div>
  );
}

export function ArtifactScreen({ run, onPick }: { run: RunState; onPick: (k: ArtifactKey) => void }) {
  return (
    <div className="screen">
      <h2>精英奖励：选择一件神器</h2>
      <div className="cards">
        {run.artifactChoices.map((k) => (
          <ArtifactCard key={k} k={k} onPick={() => onPick(k)} />
        ))}
      </div>
    </div>
  );
}

export function CampScreen({ run, onRest, onUpgrade }: { run: RunState; onRest: () => void; onUpgrade: (key: UpgradeKey) => string | null }) {
  const [upgrading, setUpgrading] = useState(false);
  const canUpgrade = run.gold >= DEFAULT_CONFIG.upgradeCost;
  const gain = campUpgradeAmount(run);
  return (
    <div className="screen">
      <h2>营地</h2>
      <p className="sub">升级与休息二选一。</p>
      {upgrading ? (
        <>
          <p className="sub">
            花 {DEFAULT_CONFIG.upgradeCost} 金币，任选一项 +{gain} 级（金币 {run.gold}）
          </p>
          <div className="cards compact">
            {UPGRADE_KEYS.map((k) => (
              <UpgradeCard key={k} upKey={k} level={run.levels[k]} gain={gain} onPick={() => onUpgrade(k)} />
            ))}
          </div>
          <div className="actions">
            <button onClick={() => setUpgrading(false)}>返回</button>
          </div>
        </>
      ) : (
        <div className="cards">
          <button className="card option" onClick={onRest}>
            <div className="card-title">休息</div>
            <div className="card-text">
              回复 {DEFAULT_CONFIG.restHeal} 生命（当前 {run.player.hp} / {run.player.maxHp}）
            </div>
          </button>
          <button className="card option" disabled={!canUpgrade} onClick={() => setUpgrading(true)}>
            <div className="card-title">升级</div>
            <div className="card-text">
              花 {DEFAULT_CONFIG.upgradeCost} 金币，任选一种方块或炸弹 +{gain} 级。
            </div>
            {!canUpgrade && <div className="card-note warn">金币不足（{run.gold}）</div>}
          </button>
        </div>
      )}
    </div>
  );
}

export function ResultScreen({ run, onRestart }: { run: RunState; onRestart: () => void }) {
  const won = run.outcome === 'won';
  return (
    <div className="screen result-screen">
      <h1>{won ? '第一段落完成！' : '倒下了……'}</h1>
      <p>
        击败 {won ? run.battleIndex : run.battleIndex - 1} 场 · 本局结算分 {run.totalScore} · 金币 {run.gold}
      </p>
      <RunSummary run={run} />
      <p className="sub">事件、商店与后两个段落将在阶段 3 加入。</p>
      <button className="primary" onClick={onRestart}>
        再来一局
      </button>
    </div>
  );
}
