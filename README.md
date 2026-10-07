# 几何消消（Shape Match）

每关在 5 回合、15 步内凑够目标分，连锁越深倍率越高；提前达标省下的步数换成金币，在商店里买升级和道具；每三关一个带特殊规则的首领关，九关通关后可以继续无尽模式。画面和音效全部由代码生成（“构成”风格：红圆、蓝方、黄三角、绿菱形，黑色专留给炸弹），用作个人网站作品集。

## 运行

```bash
npm install
npm run dev        # 本地试玩（加 ?seed=123 固定开局）
npm test           # 规则引擎测试
npm run typecheck  # 引擎、界面、模拟器的类型检查
npm run sim        # 数值模拟，见 docs/BALANCE_LOG.md
npm run build      # 打包到 dist/
```

## 上线

`npm run build` 会先跑类型检查，再把游戏打包到 `dist/`。打包用相对路径，把 `dist/` 里的全部文件原样放到网站根目录或任意子目录（例如 `/games/shape-match/`）都能直接打开；本地可用 `npm run preview` 预览打包结果。存档存在玩家浏览器的本地存储里，不需要服务器。

现在发布在 GitHub Pages：<https://bungo973.github.io/shape-match/>。推送到 `main` 后，`.github/workflows/pages.yml` 会自动测试、打包并发布。

## 目录

| 位置 | 内容 |
| --- | --- |
| `src/engine/` | 规则引擎：纯状态转换，给定状态、动作和种子产生新状态与事件日志 |
| `src/game/` | 界面：Canvas 棋盘（`board/`）、整局流程（`Game.tsx`）、合成音效（`audio.ts`） |
| `src/sim/`、`scripts/sim.ts` | 自动玩家与批量模拟 |
| `docs/prototypes/` | 可直接在浏览器打开的视觉样板 |

## 文档

- [冲分模式现行规则](docs/SCORE_MODE.md)：现在实际生效的规则与数值汇总，想知道“现在是什么样”先看这里。
- [文档时间线](docs/TIMELINE.md)：每份文档何时产生、现在是否有效。
- [视觉与声音规范](docs/VISUAL_STYLE.md)：构成风格的画面、动作、页面外框与音效。
- [设计探索记录](docs/DESIGN_JOURNAL.md)：方向性尝试、试玩结论与决定（冲分模式从第 9 节起）。
- [特殊方块规则](docs/SPECIAL_TILES.md)：炸弹的生成位置、引爆与组合技。
- [战斗与成长规则](docs/GAME_RULES.md)：结算顺序的细节；其中敌人、护盾、毒气部分属于已搁置的打怪模式。
- [数值记录](docs/BALANCE_LOG.md)：每次校准的原因与模拟结果。

2026-09-30 起转向冲分模式。打怪模式时期的文档（敌人、地图、嵌片、美术素材、早期计划等）已移到 `docs/archive/`，仅作记录；各文档状态以时间线为准。
