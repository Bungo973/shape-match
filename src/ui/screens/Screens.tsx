// 非战斗阶段的各个画面：开局神器、路线页、战后奖励、精英神器、营地、结果页。
import { useState } from 'react';
import { DEFAULT_CONFIG, shapeFits, SHAPES, type ArtifactKey, type Pos, type RunState } from '../../engine';
import { ArtifactCard, InsertBadge, InsertCard } from '../components';
import { UpgradePicker } from './UpgradePicker';

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

export function MapScreen({ run, onStart, onEdit }: { run: RunState; onStart: () => void; onEdit: () => void }) {
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
        <button onClick={onEdit}>
          调整棋盘{run.inventory.length > 0 ? `（随身匣 ${run.inventory.length}）` : ''}
        </button>
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
      <span>护盾 {run.player.shield}</span>
      <span>金币 {run.gold}</span>
      <span>
        已安装嵌片{' '}
        {run.installed.map((i) => (
          <InsertBadge key={i.id} type={i.type} size={22} />
        ))}
        {run.installed.length === 0 && '无'}
      </span>
      {run.inventory.length > 0 && (
        <span>
          随身匣{' '}
          {run.inventory.map((i) => (
            <InsertBadge key={i.id} type={i.type} size={22} />
          ))}
        </span>
      )}
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
  const fits = (shape: keyof typeof SHAPES) => shapeFits(shape, { installed: run.installed, size: { rows: 8, cols: 8 }, maxInstalled: DEFAULT_CONFIG.maxInstalledInserts });
  return (
    <div className="screen">
      <h2>胜利！获得 {reward.goldGained} 金币</h2>
      <p className="sub">选择一块嵌片放入随身匣，之后在非战斗阶段嵌入棋盘。</p>
      <div className="cards">
        {reward.choices.map((c, i) => (
          <div key={`${c.type}-${i}`} className="card-wrap">
            <InsertCard type={c.type} shape={SHAPES[c.shape]} slot={c.slot} placeable={fits(c.shape)} onPick={() => onPick(i)} selected={keep === i} />
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

export function CampScreen({
  run,
  onRest,
  onUpgrade,
  onEdit,
}: {
  run: RunState;
  onRest: () => void;
  onUpgrade: (id: string, cells: Pos[]) => string | null;
  onEdit: () => void;
}) {
  const [upgrading, setUpgrading] = useState(false);
  const hasInsert = run.installed.length + run.inventory.length > 0;
  const canUpgrade = hasInsert && run.gold >= DEFAULT_CONFIG.upgradeCost;
  return (
    <div className="screen">
      <h2>营地</h2>
      <p className="sub">升级与休息二选一；嵌入棋盘不占用这次选择。</p>
      {upgrading ? (
        <UpgradePicker run={run} onUpgrade={onUpgrade} onCancel={() => setUpgrading(false)} />
      ) : (
        <>
          <div className="cards">
            <button className="card option" onClick={onRest}>
              <div className="card-title">休息</div>
              <div className="card-text">
                回复 {DEFAULT_CONFIG.restHeal} 生命（当前 {run.player.hp} / {run.player.maxHp}）
              </div>
            </button>
            <button className="card option" disabled={!canUpgrade} onClick={() => setUpgrading(true)}>
              <div className="card-title">升级嵌片</div>
              <div className="card-text">
                花 {DEFAULT_CONFIG.upgradeCost} 金币，给一块拥有的嵌片增加{run.artifacts.includes('fineChisel') ? '两' : '一'}个相邻覆盖格。
              </div>
              {!hasInsert && <div className="card-note warn">还没有嵌片</div>}
              {hasInsert && run.gold < DEFAULT_CONFIG.upgradeCost && <div className="card-note warn">金币不足（{run.gold}）</div>}
            </button>
          </div>
          <div className="actions">
            <button onClick={onEdit}>调整棋盘{run.inventory.length > 0 ? `（随身匣 ${run.inventory.length}）` : ''}</button>
          </div>
        </>
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
