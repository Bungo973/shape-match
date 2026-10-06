# 文档时间线目录

按时间顺序列出各文档的产生与重要修订，并标注当前状态。想知道冲分模式“现在是什么规则”，看 [SCORE_MODE](SCORE_MODE.md)；想知道“为什么走到这里”，看 [DESIGN_JOURNAL](DESIGN_JOURNAL.md)；数值改动看 [BALANCE_LOG](BALANCE_LOG.md)；规则冲突时的权威顺序见 [HANDOFF_AUDIT](HANDOFF_AUDIT.md#文档权威顺序)。新增或大改文档时，在本页对应日期下追加一行。

**状态标记**：现行 = 当前规则依据；讨论稿 = 尚未定案；待修订 = 内容仍按嵌片体系写，方块构筑定案后需改；记录 = 决策或过程记录；停用 = 不作为实现依据。

## 2026-09-26 · 概念探索

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [MAP_IDEAS](MAP_IDEAS.md) | 早期三种地图方案（配方盘、星盘、实验室） | 停用，已改为固定九战 |
| [GRAVITY_DESIGN](GRAVITY_DESIGN.md) | Boss 重力异常：首版只上下反转 | 现行 |

## 2026-09-27 · 规则成形与交接

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [PRD](PRD.md) | 产品范围、设计支柱、MVP 与验收标准 | 待修订 |
| [GAME_RULES](GAME_RULES.md) | 战斗与成长的统一规则源：基数 × 倍率、结算顺序 | 现行（§5 嵌片待修订） |
| [SPECIAL_TILES](SPECIAL_TILES.md) | 四种无属性炸弹、生成优先级、匹配归组、组合矩阵 | 现行 |
| [BOARD_SIZE_DECISION](BOARD_SIZE_DECISION.md) | 棋盘定为 8×8 的理由 | 现行 |
| [INSERT_DESIGN](INSERT_DESIGN.md) | 嵌片池、触发引擎与波次结算、**防卡壳五条规矩** | 记录（嵌片已移出一局流程；触发引擎与五条规矩仍适用） |
| [ARTIFACT_DESIGN](ARTIFACT_DESIGN.md) | 神器设计空间与首版 12 件 | 现行（依赖嵌片的几件待修订） |
| [ENEMY_DESIGN](ENEMY_DESIGN.md) | 九战学习顺序、倍率侵蚀、嵌片压制、重力异常 | 现行（第 6 场嵌片压制待修订） |
| [MAP](MAP.md) | 固定九战路线、战后流程、金币、事件、商店 | 待修订 |
| [DESIGN_BACKLOG](DESIGN_BACKLOG.md) | 非数值设计引导：每一步决策、敌人、构筑、信息 | 记录 |
| [NEXT_DESIGN_PROPOSALS](NEXT_DESIGN_PROPOSALS.md) | 开工前的一轮提案 | 停用，仅作灵感 |
| [PLAN](PLAN.md) | 阶段 0–4 实施计划 | 现行 |
| [CONVENTIONS](CONVENTIONS.md) | 玩法信息规范、技术栈与目录、代码与测试规范 | 现行 |
| [HANDOFF_AUDIT](HANDOFF_AUDIT.md) | 交接审查：文档权威顺序与缺口清单 | 现行 |
| [THEME_STORY](THEME_STORY.md) | 《地底秘藏》主题与九战故事线 | 现行 |
| [ART_DIRECTION](ART_DIRECTION.md) | 美术基调与 AI 资产流程 | 现行 |
| [ASSET_PLAN](ASSET_PLAN.md) | 完整美术资产清单与第一批提示词 | 现行 |
| [BOARD_INSERT_VISUAL](BOARD_INSERT_VISUAL.md) | 棋盘与嵌片覆盖层的视觉规范 | 待修订 |

代码：规则引擎核心、第一批嵌片、战斗状态与回合流程。

## 2026-09-28 · 第一段落可玩、试玩与转向

| 时间 | 文档 | 内容 | 状态 |
| --- | --- | --- | --- |
| 上午 | [ENEMY_DESIGN](ENEMY_DESIGN.md#第一段落的意图脚本2026-09-28-确定行为数值占位) | 第一段落三战敌人脚本 | 现行 |
| 上午 | [MAP](MAP.md#生成细则2026-09-28-确定) | 嵌片奖励生成细则（稳定／构筑／惊喜） | 待修订 |
| 下午 | [ASSET_BATCH2](ASSET_BATCH2.md) | 第二批素材：神器图标、嵌片图标、敌人 | 现行（已接入） |
| 傍晚 | [BALANCE_LOG](BALANCE_LOG.md) | 第一次数值校准：护盾上限 20、倍率封顶 ×4、敌人约翻倍 | 记录 |
| 晚上 | [CARD_DESIGN](CARD_DESIGN.md) | 以嵌片卡取代交换的尝试 | 记录（已否决） |
| 晚上 | [DESIGN_JOURNAL](DESIGN_JOURNAL.md) | 诊断“选择没有正反馈”；决定去掉嵌片、改做方块构筑；实现正反馈层 | 记录 |
| 晚上 | [BALANCE_LOG](BALANCE_LOG.md) | 主动特殊匹配基数 ×2，敌人生命上调约 20% | 记录 |
| 深夜 | [TIMELINE](TIMELINE.md) | 本页：文档时间线目录 | 现行 |
| 深夜 | [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) · [GAME_RULES](GAME_RULES.md) | 消除流畅化（各列独立下落）；倍率改为连续倍率槽（6/10/14/18/22，封顶 ×6） | 现行 |

代码：可玩灰盒、神器、第一段落流程与棋盘编辑器、第二批素材、模拟器、嵌片卡原型（`?mode=card`）、正反馈层、各列独立下落、连续倍率槽。

## 2026-09-29 · 方块构筑

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [BLOCK_BUILD](BLOCK_BUILD.md) | 方块构筑讨论稿：升级只有 4 种方块 + 3 类炸弹，等级 × 基础值（十字炸弹已撤回）；条件神器、闪电引线；传统道具 | 讨论稿（部分已定） |
| [BOARD_SIZE_DECISION](BOARD_SIZE_DECISION.md) · [BALANCE_LOG](BALANCE_LOG.md) · [ENEMY_DESIGN](ENEMY_DESIGN.md) | 棋盘改为 10×10；敌人生命 ×2.1 | 现行 |
| [GAME_RULES](GAME_RULES.md) · [BALANCE_LOG](BALANCE_LOG.md) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) | 主角护盾改为每回合清空、不带入下一场，上限 40；敌人攻击校准 | 现行 |
| [GAME_RULES](GAME_RULES.md) · [BALANCE_LOG](BALANCE_LOG.md) | 升级表原型：方块等级、炸弹加成取代特殊匹配 ×2；各项强度对比 | 现行（原型） |
| [BLOCK_BUILD](BLOCK_BUILD.md) · [MAP](MAP.md) · [GAME_RULES](GAME_RULES.md) | 战后奖励改为升级三选一，营地升级任选一项；一局流程移除嵌片 | 现行 |
| [ARTIFACT_DESIGN](ARTIFACT_DESIGN.md) · [GAME_RULES](GAME_RULES.md) · [BALANCE_LOG](BALANCE_LOG.md) | 5 件方块构筑神器（A18–A22）；共振底座、锁位共鸣器下架 | 现行 |
| [ENEMY_DESIGN](ENEMY_DESIGN.md) · [ASSET_BATCH3](ASSET_BATCH3.md) · [THEME_STORY](THEME_STORY.md) | 九战敌人阵容（三层三家族），色封与石化，第三批素材 | 现行 |
| [BALANCE_LOG](BALANCE_LOG.md) | 九战接通：第二、三层敌人上线，素材接入，整局校准（熟练 89% / 新手 66% 通关） | 记录 |

## 2026-09-30 · 炸弹与连锁

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) · [GAME_RULES](GAME_RULES.md) | 方向改为“多出炸弹与连锁”；交换规则原型：只允许可匹配交换、炸弹换位即引爆、死局自动重排 | 记录 |
| [GAME_RULES](GAME_RULES.md) · [SPECIAL_TILES](SPECIAL_TILES.md) · [CONVENTIONS](CONVENTIONS.md) | 新交换规则定案，旧规则移除 | 现行 |
| [ENEMY_DESIGN](ENEMY_DESIGN.md) · [BALANCE_LOG](BALANCE_LOG.md) | 敌人生命 ×1.15 | 现行 |
| [ENEMY_DESIGN](ENEMY_DESIGN.md) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 三拍循环兜底模板；碎甲、穿刺（夺宝客）、强化；第二、三层重排与校准 | 现行 |
| [ARTIFACT_DESIGN](ARTIFACT_DESIGN.md) · [GAME_RULES](GAME_RULES.md) · [BALANCE_LOG](BALANCE_LOG.md) | 神器盘点：删除 8 件，反应线圈改写，现行 9 件 | 现行 |
| [BLOCK_BUILD](BLOCK_BUILD.md) · [GAME_RULES](GAME_RULES.md) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) | 炸弹升级重做为本场爆破等级（越炸越强，每场重置，三类独立） | 现行（原型数值） |
| [ARTIFACT_DESIGN](ARTIFACT_DESIGN.md) · [GAME_RULES](GAME_RULES.md) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) | 累加触发类神器：引信匣、溢流护符、余震核心（进度跨战斗保留） | 现行（原型数值） |
| [ENEMY_DESIGN](ENEMY_DESIGN.md) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 试玩太简单：敌人每拍都攻击，难度目标下调到模拟熟练约 65–72% | 现行（原型数值） |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 转向讨论：三消冲分原型（`?mode=score`），每关 12 步凑目标分，未达标按差距扣血 | 原型，待试玩 |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 冲分改为 5 回合、前期目标降低；回合开始类神器：火药桶、虹彩原石 | 原型，待试玩 |
| [VISUAL_STYLE](VISUAL_STYLE.md) · [prototypes/style-samples.html](prototypes/style-samples.html) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) | 转向冲分 + 作品集：美术素材停用，画面纯代码绘制；四种样板中选定“构成”风格 | 现行 |
| [VISUAL_STYLE](VISUAL_STYLE.md) | 冲分正式界面第一版（`src/game/`）：构成风格的棋盘与页面外框，接入引擎整局流程；旧 PixiJS 界面停用 | 现行（待试玩） |
| [prototypes/tiles-bombs.html](prototypes/tiles-bombs.html) | 方块与炸弹样板：换掉黑半圆的三套方块组（四色／两种五色）、四种炸弹方案；正式界面棋盘随窗口放大。定案：四色绿菱形 + 黑块白标炸弹，已接入正式界面 | 现行 |
| [VISUAL_STYLE](VISUAL_STYLE.md#声音第一版2026-09-30待试听) | 合成音效第一版：木琴／玻璃／方波三套音色可切换，五声音阶随连锁升高；连锁音阶可切换为谢泼德音调（无限上升的错觉） | 待试听 |
| [README](../README.md) | 仓库清理：删除旧 PixiJS 界面（`src/ui/`）、美术素材（`assets/`、`public/game/`）与素材脚本，README 改写为冲分现状 | 现行 |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 冲分手感的结构性事实；精简：四色等级合并为方块基数、去掉充能、神器只留 6 件；金币养成：升级全部移到商店，剩余步数换金币 | 现行（原型数值） |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 关卡结构：第 3、6、9 关为首领关（六条规则），通关后可继续无尽模式；目标分上调 | 现行（原型数值） |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [SPECIAL_TILES](SPECIAL_TILES.md) | 连锁产弹格改为拐角／刚落定的格；前两关降目标；道具（锤子、手套、炸药包、洗牌），商店随机上架，是否耗步为原型开关 | 现行（原型） |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 倍率不封顶、爆破等级每级 +0.1 倍率、首领关降目标；道具改版（新增雷管、炸药包改放五连、锤子降价） | 现行（原型数值） |
| [SCORE_MODE](SCORE_MODE.md) · [VISUAL_STYLE](VISUAL_STYLE.md) | 冲分模式现行规则汇总（流程、计分、炸弹、首领、目标、金币、商店、道具、神器、待定项）；页面外框补充首领、道具栏、商店、图标 | 现行 |
| [SCORE_MODE](SCORE_MODE.md#神器) · [ARTIFACT_DESIGN](ARTIFACT_DESIGN.md#分级神器池2026-10-06) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 道具定为不耗步；神器仿《小丑牌》分三级，商店上架神器、神器栏 5 格可半价卖出；全池约 31 件分三批，第一批计分类 7 件已做 | 现行（原型数值） |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [VISUAL_STYLE](VISUAL_STYLE.md) · [BALANCE_LOG](BALANCE_LOG.md) | 神器触发反馈（逐件抖动、弹数值、倍率逐档跳）；第二批炸弹类 6 件，范围类改为稀有 | 现行（原型数值） |
| [SCORE_MODE](SCORE_MODE.md#神器) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 色封下 0 分也弹出说明；第三批节奏、金币与规则类 12 件，神器池 31 件全部到位 | 现行（原型数值） |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [VISUAL_STYLE](VISUAL_STYLE.md) · [SCORE_MODE](SCORE_MODE.md) | 修结算卡闪回；神器栏 6 格、升级降为 8 起每级 +4；神器侧边栏（宽屏常驻、窄屏抽屉） | 现行（原型数值） |
| [SCORE_MODE](SCORE_MODE.md#任务) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [BALANCE_LOG](BALANCE_LOG.md) | 每关可选任务：开关前一易一难二选一，易给金币、难给神器；第 3–9 关目标上调约 10% | 现行（原型数值） |
| [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [SCORE_MODE](SCORE_MODE.md) | 删去自由手、沙漏；弱引导（停手 5 秒提示一步，优先做炸弹）；“低压”关不出倍率任务 | 现行 |
| [SCORE_MODE](SCORE_MODE.md) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) | 商店付费刷新（3 起每次 +1）；道具待重新设计 | 现行 |
| [SCORE_MODE](SCORE_MODE.md#道具) · [DESIGN_JOURNAL](DESIGN_JOURNAL.md) · [VISUAL_STYLE](VISUAL_STYLE.md) | 道具重做：关内掉落（五连或连锁 ≥ 8 层），手套、吸管、洗牌、放大镜、回声；商店不再卖道具 | 原型，待试玩 |

**2026-09-30 起停用**：[ART_DIRECTION](ART_DIRECTION.md)、[ASSET_PLAN](ASSET_PLAN.md)、[ASSET_BATCH2](ASSET_BATCH2.md)、[ASSET_BATCH3](ASSET_BATCH3.md)、[BOARD_INSERT_VISUAL](BOARD_INSERT_VISUAL.md)（美术素材不再使用，视觉以 VISUAL_STYLE 为准）；[THEME_STORY](THEME_STORY.md) 中的敌人与故事线随打怪模式搁置。
