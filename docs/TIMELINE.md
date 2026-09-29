# 文档时间线目录

按时间顺序列出各文档的产生与重要修订，并标注当前状态。想知道“为什么走到这里”，看 [DESIGN_JOURNAL](DESIGN_JOURNAL.md)；数值改动看 [BALANCE_LOG](BALANCE_LOG.md)；规则冲突时的权威顺序见 [HANDOFF_AUDIT](HANDOFF_AUDIT.md#文档权威顺序)。新增或大改文档时，在本页对应日期下追加一行。

**状态标记**：现行 = 当前规则依据；待修订 = 内容仍按嵌片体系写，方块构筑定案后需改；记录 = 决策或过程记录；停用 = 不作为实现依据。

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
| [INSERT_DESIGN](INSERT_DESIGN.md) | 嵌片池、触发引擎与波次结算、**防卡壳五条规矩** | 待修订（嵌片将去掉；触发引擎与五条规矩仍适用） |
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

代码：可玩灰盒、神器、第一段落流程与棋盘编辑器、第二批素材、模拟器、嵌片卡原型（`?mode=card`）、正反馈层。
