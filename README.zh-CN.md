# CS2BotImproverPlus

[English](README.md) | **简体中文**

CS2BotImproverPlus 是
[ed0ard/CS2-Bot-Improver](https://github.com/ed0ard/CS2-Bot-Improver) 的下游发行版。项目保留上游的人机系统和
`game/csgo` 安装目录结构，并添加玩家饰品预设

当前版本：**1.4.2**<br>

## Plus 功能

### 玩家饰品预设

- 刀具预设：刀具类型、涂装编号、磨损、模板编号、名称标签、默认刀具、StatTrak 开关和 StatTrak 初始数值
- 手套预设：手套型号、涂装编号、磨损和模板编号
- 武器预设：为每种受支持的武器分别设置涂装编号、磨损、模板编号和名称标签。只有目录数据标记为兼容的皮肤才能
  开启 StatTrak 或纪念品选项
- 为真人玩家设置音乐盒预设

面板将设置结果写入已安装 `PlayerKnifeCustomizer` 插件目录中的 `player_knife_presets.json` 和
`player_gun_presets.json`。该 CounterStrikeSharp 模块在插件列表中显示为 `PlayerCosmetics`

### 预设应用方式

- 刀具、手套、武器和音乐盒预设只应用于真人玩家槽位
- 玩家出生时应用刀具、手套和库存武器预设
- 购买、发放或拾取对应武器时再次应用该武器的预设
- 配置过的掉落刀具会应用对应刀具预设
- 使用已配置 StatTrak 的武器击杀玩家时，对应计数会增加并写回预设配置
- 音乐盒预设会应用到玩家以及回合 MVP 事件
- 应用前根据内置武器目录验证涂装兼容性和磨损范围

### 扩展面板

- 提供刀具、手套、武器和音乐盒预设编辑器，支持目录搜索和图片预览
- 指令卡片支持搜索和点击复制
- 职业战队阵容以可视化卡片显示，可选择 CT/T 并复制完整控制台指令
- 指令页面包含联机连接步骤

### 游戏模式

- **增强人机**会在当前安装的 `gameinfo.gi` 中加入 Metamod 搜索路径，并使用
  `-insecure -console -condebug` 启动 CS2
- **正常匹配**会移除 Metamod 搜索路径、禁用玩家饰品应用，并在启动 CS2 时不额外添加 `-insecure`
- 模式文件根据当前游戏目录中的 `gameinfo.gi` 动态生成

## Plus 安装（Windows）

1. 从 [Plus Releases](https://github.com/numakkiyu/CS2-Bot-Improver-Plus/releases) 下载并解压
   `CS2BotImproverPlus-v1.4.2-windows.zip`。
2. 将 `CS2BotImproverPlus v1.4.2.exe` 放在任意方便的位置。
3. 将 `addons`、`cfg` 和 `overrides` 复制到 CS2 的 `game/csgo` 目录。
4. 打开 Plus 面板；如果未自动识别安装目录，请手动选择 `game/csgo`。
5. 在**增强人机**和**正常匹配**之间切换前必须先关闭 CS2。

---

## CS2-Bot-Improver 功能
1. 让人机的瞄准更强且更接近真人
2. 让人机根据局势熟练地投掷道具
3. 改进人机的移动
4. 修复大多数人机卡住的问题
5. 允许人机购买所有武器，并重新设计其经济管理
6. 优化人机行为，使其能够压枪扫射、甩枪、穿烟射击和背闪
7. 为每个人机分配独立的刀具、手套、武器皮肤、探员模型、音乐盒、头像和个人资料
8. 让人机更聪明、更有组织，并提高对周围环境的警觉性
9. 将人机名称替换为职业选手和随机玩家名称（每位职业选手的特点基于 [HLTV](https://www.hltv.org/) 数据）
10. 移除人机名称前缀
11. 调整游戏规则，使其更适合人机
12. 添加一些能够增加游戏乐趣的指令

### 安装

#### Windows

1. 从 [Releases](https://github.com/ed0ard/CS2-Bot-Improver/releases) 下载最新的 **CS2BotImprover.zip** 并解压

   （如果运行的专用服务器不只用于人机对局，请下载 **CS2BotImprover_rules_unchanged.zip**）

2. 将 **Panel v1.4.2.exe** 放在任意方便的位置

<img width="128" height="128" alt="App" src="https://github.com/user-attachments/assets/7271dc7d-2436-484b-8359-6531f4abd710" />

3. 打开 CS2 根目录并进入 `game/csgo` 目录

<img width="405" height="256" alt="snap_1" src="https://github.com/user-attachments/assets/ae2be90e-6742-4f1f-8e0c-096b728d5dbd" />

3. 复制 `CS2BotImprover` 中剩余的全部文件，并粘贴到 `game/csgo`

<img width="540" height="181" alt="snap_windows" src="https://github.com/user-attachments/assets/6a8645fc-78e7-4f3a-92d3-5d1b6d913918" />

4. 打开 **Panel v1.4.2.exe**，选择 **Bot Mode**，然后点击 **Launch CS2**

<img width="339" height="129" alt="Panel_1" src="https://github.com/user-attachments/assets/dc806991-c940-43cf-a614-f49012fae4a7" />


#### Linux

1. 从 [Releases](https://github.com/ed0ard/CS2-Bot-Improver/releases) 下载最新的 **CS2BotImprover_for_Linux.zip** 并解压

2. 将 **Command.txt** 放在任意方便的位置

3. 打开 CS2 根目录并进入 `game/csgo` 目录

<img width="405" height="256" alt="snap_1" src="https://github.com/user-attachments/assets/ae2be90e-6742-4f1f-8e0c-096b728d5dbd" />

4. 复制 `CS2BotImprover` 中剩余的全部文件，并粘贴到 `game/csgo`

<img width="535" height="180" alt="snap_linux" src="https://github.com/user-attachments/assets/9bda7b1d-43d3-49cf-a283-27b124b894e0" />

5. 在启动项中添加 `-insecure`

<img width="130" height="153" alt="snap_3" src="https://github.com/user-attachments/assets/4c775e36-3fc3-4a19-9cb1-4f0c9327838c" /><br>
<img width="625" height="423" alt="snap_4" src="https://github.com/user-attachments/assets/ac0b0c57-ee67-4e33-96fb-146d14714fc8" />

### 指令

#### 瞄准

`bot_aim mixed`<br>
人机会根据局势灵活选择瞄准位置（默认）

`bot_aim head`<br>
人机优先瞄准头部

`bot_aim body`<br>
人机优先瞄准身体

`bot_aim`<br>
查看当前瞄准模式

#### 道具

`bot_nades off`<br>
人机不会投掷任何道具

`bot_nades normal`<br>
人机遵循与真人玩家基本相同的道具数量限制（默认）

`bot_nades more`<br>
人机使用与 normal 模式相同的决策逻辑，但拥有更高的道具数量限制

`bot_nades max`<br>
人机受到的限制最少，投掷道具前的思考也更少

`bot_nades`<br>
显示当前道具投掷模式

#### 购买

在控制台中输入武器名称，从下一回合开始让所有人机获得该武器

有效的武器名称：<br>
`elite`<br>
`p250`<br>
`fn57`<br>
`deagle`<br>
`cz75a`<br>
`r8`<br>
`bizon`<br>
`p90`<br>
`mp5sd`<br>
`mp9`<br>
`mp7`<br>
`mac10`<br>
`ump45`<br>
`mag7`<br>
`sawedoff`<br>
`nova`<br>
`xm1014`<br>
`famas`<br>
`galilar`<br>
`m4a1`<br>
`m4a1s`<br>
`ak47`<br>
`aug`<br>
`sg556`<br>
`ssg08`<br>
`awp`<br>
`scar20`<br>
`g3sg1`<br>
`negev`<br>
`m249`

`bot_buy`<br>
人机恢复正常购买

#### 战队

如需在对局中添加职业战队，请从 [Commands.txt](https://github.com/ed0ard/CS2-Bot-Improver/blob/main/Commands.txt) 复制指令并粘贴到游戏控制台。也可以按照相同格式添加新战队。

例如，如需将 Vit 添加到 CT，请复制以下指令。

<img width="301" height="237" alt="snap_5" src="https://github.com/user-attachments/assets/a895f3a6-58f8-47dc-b6f5-b60c1b32fecd" />

#### 刀具

瞄准地面并按下键盘上的 `\`，即可在地面生成各种刀具。

#### 跳狙飞人

`scouts_on`<br>
`scouts_off`<br>
对局开始后输入指令，开启或关闭跳狙飞人模式

### 面板指南（仅 Windows）

#### 状态指示灯
🟢 未检测到问题<br>
🟡 需要重启 CS2 才能应用更改<br>
🔴 文件缺失，点击红色指示灯查看缺失文件列表<br>

<img width="481" height="82" alt="Status Lights" src="https://github.com/user-attachments/assets/26a947e2-4e0e-423f-bce8-f220d88509a2" />

### 匹配与人机模式切换
选择所需模式，然后点击 `Launch CS2`

<img width="472" height="179" alt="Mode_2" src="https://github.com/user-attachments/assets/3f9254fa-4cbe-4854-8fd1-0f35228fff77" />

### 设置
点击右上角的 <img width="31" height="32" alt="Settings" src="https://github.com/user-attachments/assets/7f94176b-79f1-4e22-9495-4589c4dea9eb" /> 图标打开 `Settings`

### 指令
点击 `Commands`，再点击指令块即可自动复制，也可以输入关键词搜索

<img width="350" height="420" alt="Screenshot 2026-06-14 090901" src="https://github.com/user-attachments/assets/957cfafb-900d-4450-b985-13d3e8efc375" />

## 常见问题

### 如何与好友进行人机对局

1. 开始一场人机对局并输入所需指令，然后在控制台输入 `status`<br>
<img width="597" height="141" alt="snap_6" src="https://github.com/user-attachments/assets/792c4b4f-1d56-4a39-9186-b301cbff1846" />

2. 复制 `steamid:` 后面的文本，并在前面添加 `connect `（注意中间需要保留空格）<br>
3. 将完整指令发送给好友，让好友粘贴到各自的控制台中

### 如何手动修改难度

1. 打开 CS2 根目录并进入 `game/csgo/overrides` 目录<br>
2. `Low` 为简单难度，`Medium` 为基于 HLTV 数据的混合难度（默认），`High` 为极高难度<br>
3. 启动游戏前，复制对应目录中的 `botprofile.vpk` 并粘贴到 `game/csgo/overrides`

### 如何手动切换到正常在线匹配模式

1. 打开 CS2 根目录并进入 `game/csgo/backup/Online` 目录<br>
2. 复制 `gameinfo.gi` 并粘贴到 `game/csgo` 目录，替换目标文件<br>
3. 删除启动项中的 `-insecure`<br>

完成修改后，如需**再次进行人机对局**，请进入 `game/csgo/backup/WithBots` 目录，按照上述方式替换文件并添加启动项

### 如何手动禁用人机武器皮肤、探员皮肤、音乐盒、刀具和手套

1. 打开 CS2 根目录并进入 `game/csgo/addons/counterstrikesharp/plugins` 目录<br>
2. 将 `BotRandomizer` 文件夹重命名为 `BotRandomizer_disabled`<br>
3. 打开 `addons/counterstrikesharp/configs/core.json`，将 `FollowCS2ServerGuidelines` 设置为 `true`

### 如何手动禁用人机 Steam 个人资料

1. 打开 CS2 根目录并进入 `game/csgo/addons` 目录<br>
2. 将 `BotHider` 文件夹重命名为 `BotHider_disabled`<br>

### 如何在创意工坊地图中正常运行插件

在启动项中添加 `-disable_workshop_command_filtering`

### 如何正常进行滑翔

在游戏控制台中运行 `sv_standable_normal 0.7`

## 致谢
[metamod-source](https://github.com/alliedmodders/metamod-source)<br>
[CounterStrikeSharp](https://github.com/roflmuffin/CounterStrikeSharp)<br>
[Ray-Trace](https://github.com/FUNPLAY-pro-CS2/Ray-Trace)<br>
[CS2-Bullseye-Bot](https://github.com/ed0ard/CS2-Bullseye-Bot)<br>
[CS2-Bot-NadeSystem](https://github.com/ed0ard/CS2-Bot-NadeSystem)<br>
[CS2_ExecAfter_No_Admin](https://github.com/ed0ard/CS2_ExecAfter_No_Admin)，fork 自 [kus](https://github.com/kus)<br>
[CS2-Bot-Randomizer](https://github.com/ed0ard/CS2-Bot-Randomizer)<br>
[CS2-Bot-Hider](https://github.com/XBribo/CS2-Bot-Hider)，作者：[XBribo](https://github.com/XBribo)<br>
[CSGOBetterBots](https://github.com/manicogaming/CSGOBetterBots/blob/master/addons/sourcemod/data/bot_info.json)，作者：[manico](https://github.com/manico)<br>
[CS2-Smarter-Bot](https://github.com/ed0ard/CS2-Smarter-Bot)<br>
[CS2-BotAI](https://github.com/ed0ard/CS2-BotAI)，fork 自 [Austin](https://github.com/Austinbots)<br>
[CS2-BotAI-for-Linux](https://github.com/Austinbots/CS2-BotAI)<br>
[CS2-Bot-Buy](https://github.com/ed0ard/CS2-Bot-Buy)<br>
[RoundDamageRecap](https://github.com/YuGeYu/LBTV-CS2-Bot-Enhancer/tree/main/addons/counterstrikesharp/plugins/RoundDamageRecap)，作者：[YuGeYu](https://github.com/YuGeYu)<br>
[Apple-Style-GUI](https://github.com/ed0ard/Apple-Style-GUI)<br>

## 许可证
AGPL-3.0
