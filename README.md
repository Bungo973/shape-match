# 三消冲分 × 肉鸽

每关在 5 回合、15 步内凑够目标分，连锁越深倍率越高；关卡之间用升级和神器构筑。画面和音效全部由代码生成（“构成”风格：红圆、蓝方、黄三角、绿菱形，黑色专留给炸弹），用作个人网站作品集。

## 运行

```bash
npm install
npm run dev        # 本地试玩（加 ?seed=123 固定开局）
npm test           # 规则引擎测试
npm run typecheck  # 引擎、界面、模拟器的类型检查
npm run sim        # 数值模拟，见 docs/BALANCE_LOG.md
npm run build      # 打包到 dist/
```

## 目录

| 位置 | 内容 |
| --- | --- |
| `src/engine/` | 规则引擎：纯状态转换，给定状态、动作和种子产生新状态与事件日志 |
| `src/game/` | 界面：Canvas 棋盘（`board/`）、整局流程（`Game.tsx`）、合成音效（`audio.ts`） |
| `src/sim/`、`scripts/sim.ts` | 自动玩家与批量模拟 |
| `docs/prototypes/` | 可直接在浏览器打开的视觉样板 |

## 文档

- [文档时间线](docs/TIMELINE.md)：每份文档何时产生、现在是否有效，从这里找起。
- [视觉与声音规范](docs/VISUAL_STYLE.md)：构成风格的画面、动作、页面外框与音效。
- [设计探索记录](docs/DESIGN_JOURNAL.md)：方向性尝试、试玩结论与决定。
- [战斗与成长规则](docs/GAME_RULES.md)：结算顺序、升级与神器数值（冲分模式的规则与目标分见设计探索记录第 9–10 节）。
- [数值记录](docs/BALANCE_LOG.md)：每次校准的原因与模拟结果。

2026-09-30 起转向冲分模式，打怪相关的敌人、护盾、毒气与美术素材文档已停用，仅作记录，状态以时间线为准。
