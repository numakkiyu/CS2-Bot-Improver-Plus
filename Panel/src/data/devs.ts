export type ThirdPartyProject = {
  name: string;
  version?: string;
  license: string;
  url: string;
  description: string;
  descriptionZh: string;
};

export type ThirdPartyGroup = {
  id: "game" | "panel" | "build" | "data";
  title: string;
  titleZh: string;
  projects: ThirdPartyProject[];
};

export const THIRD_PARTY_GROUPS: ThirdPartyGroup[] = [
  {
    id: "game",
    title: "Game runtime and plugins",
    titleZh: "游戏运行栈与插件",
    projects: [
      {
        name: "CS2-Bot-Improver",
        version: "v1.4.2 source base",
        license: "AGPL-3.0",
        url: "https://github.com/ed0ard/CS2-Bot-Improver",
        description: "Original enhanced-bot codebase used as the upstream foundation.",
        descriptionZh: "Local Arena 增强人机功能的原始上游代码基础。",
      },
      {
        name: "Metamod:Source",
        version: "2.0.0-git1406",
        license: "zlib/libpng",
        url: "https://github.com/alliedmodders/metamod-source",
        description: "Native Source engine plugin loader distributed with the managed payload.",
        descriptionZh: "随受管负载分发的 Source 引擎原生插件加载器。",
      },
      {
        name: "CounterStrikeSharp",
        version: "v1.0.371",
        license: "GPL-3.0 + MIT plugin exception",
        url: "https://github.com/roflmuffin/CounterStrikeSharp",
        description: "Managed CS2 plugin runtime. Published plugins may use the repository's MIT exception.",
        descriptionZh: "CS2 托管插件运行时；其许可证为 GPL-3.0，并为已发布插件提供 MIT 例外。",
      },
      {
        name: "Ray-Trace",
        version: "v1.0.16",
        license: "GPL-3.0",
        url: "https://github.com/FUNPLAY-pro-CS2/Ray-Trace",
        description: "Native and CounterStrikeSharp ray-tracing bridge used by bot perception.",
        descriptionZh: "为机器人感知提供射线检测的原生与 CounterStrikeSharp 桥接组件。",
      },
      {
        name: "CS2-Bot-Hider",
        version: "v0.3.3",
        license: "AGPL-3.0",
        url: "https://github.com/XBribo/CS2-Bot-Hider",
        description: "Bot visibility and shared-state component included in the payload.",
        descriptionZh: "负载中用于机器人可见性与共享状态处理的组件。",
      },
      {
        name: "CS2-Bot-Controller",
        license: "AGPL-3.0",
        url: "https://github.com/XBribo/CS2-Bot-Controller",
        description: "Bot movement and control implementation integrated into the plugin set.",
        descriptionZh: "集成在插件组中的机器人移动与控制实现。",
      },
      {
        name: "CS2-Bot-Randomizer",
        license: "AGPL-3.0",
        url: "https://github.com/ed0ard/CS2-Bot-Randomizer",
        description: "Bot identity and profile randomization source component.",
        descriptionZh: "机器人身份与档案随机化功能的源码组件。",
      },
      {
        name: "CS2-BotAI",
        license: "AGPL-3.0",
        url: "https://github.com/ed0ard/CS2-BotAI",
        description: "Enhanced decision-making and behavior source component.",
        descriptionZh: "增强机器人决策与行为逻辑的源码组件。",
      },
      {
        name: "CS2-Bot-Buy",
        license: "AGPL-3.0",
        url: "https://github.com/ed0ard/CS2-Bot-Buy",
        description: "Bot purchasing and economy behavior source component.",
        descriptionZh: "机器人购买与经济行为的源码组件。",
      },
      {
        name: "CS2-Bot-NadeSystem",
        license: "AGPL-3.0",
        url: "https://github.com/ed0ard/CS2-Bot-NadeSystem",
        description: "Grenade selection, aiming, and throwing source component.",
        descriptionZh: "机器人投掷物选择、瞄准与投掷逻辑的源码组件。",
      },
      {
        name: "RoundDamageRecap",
        license: "AGPL-3.0",
        url: "https://github.com/YuGeYu/LBTV-CS2-Bot-Enhancer",
        description: "Round damage summary component adapted from LBTV-CS2-Bot-Enhancer.",
        descriptionZh: "基于 LBTV-CS2-Bot-Enhancer 适配的回合伤害汇总组件。",
      },
      {
        name: "Lib.Harmony",
        version: "v2.4.2",
        license: "MIT",
        url: "https://github.com/pardeike/Harmony",
        description: "Runtime method patching library referenced by BotHiderImpl.",
        descriptionZh: "BotHiderImpl 使用的运行时方法补丁库。",
      },
    ],
  },
  {
    id: "panel",
    title: "Panel runtime",
    titleZh: "面板运行时",
    projects: [
      {
        name: "Tauri and official plugins",
        version: "v2",
        license: "MIT OR Apache-2.0",
        url: "https://github.com/tauri-apps/tauri",
        description: "Desktop shell, IPC, dialogs, clipboard, opener, and single-instance support.",
        descriptionZh: "桌面外壳、IPC、对话框、剪贴板、外部打开与单实例支持。",
      },
      {
        name: "React / React DOM",
        version: "v18.3.1",
        license: "MIT",
        url: "https://github.com/facebook/react",
        description: "Panel component and rendering runtime.",
        descriptionZh: "面板组件与界面渲染运行时。",
      },
      {
        name: "Lucide React",
        version: "v1.24.0",
        license: "ISC",
        url: "https://github.com/lucide-icons/lucide",
        description: "Interface icon library.",
        descriptionZh: "面板使用的界面图标库。",
      },
      {
        name: "Inter",
        license: "SIL OFL-1.1",
        url: "https://github.com/rsms/inter",
        description: "Bundled variable user-interface typeface.",
        descriptionZh: "随面板打包的可变界面字体。",
      },
      {
        name: "Serde / serde_json",
        license: "MIT OR Apache-2.0",
        url: "https://github.com/serde-rs/serde",
        description: "Rust configuration and data serialization.",
        descriptionZh: "Rust 配置与结构化数据序列化。",
      },
      {
        name: "Reqwest",
        version: "v0.12",
        license: "MIT OR Apache-2.0",
        url: "https://github.com/seanmonstar/reqwest",
        description: "HTTPS client used by online update features.",
        descriptionZh: "在线更新功能使用的 HTTPS 客户端。",
      },
      {
        name: "ed25519-dalek",
        version: "v2",
        license: "BSD-3-Clause",
        url: "https://github.com/dalek-cryptography/curve25519-dalek",
        description: "Ed25519 signature verification for update metadata.",
        descriptionZh: "用于校验更新元数据 Ed25519 签名的密码学库。",
      },
      {
        name: "sha2 / base64",
        license: "MIT OR Apache-2.0",
        url: "https://github.com/RustCrypto/hashes",
        description: "Hashing and binary-text encoding utilities.",
        descriptionZh: "哈希校验与二进制文本编码工具。",
      },
      {
        name: "fs2",
        version: "v0.4",
        license: "MIT OR Apache-2.0",
        url: "https://github.com/danburkert/fs2-rs",
        description: "Portable file locking used by atomic storage operations.",
        descriptionZh: "原子存储操作使用的跨平台文件锁。",
      },
      {
        name: "sysinfo",
        version: "v0.33",
        license: "MIT",
        url: "https://github.com/GuillaumeGomez/sysinfo",
        description: "Process and system inspection used by safety checks.",
        descriptionZh: "安全检查使用的进程与系统信息读取库。",
      },
      {
        name: "zip",
        version: "v2.4",
        license: "MIT",
        url: "https://github.com/zip-rs/zip2",
        description: "ZIP archive support for diagnostics and updates.",
        descriptionZh: "诊断包与更新文件使用的 ZIP 归档支持。",
      },
      {
        name: "notify",
        version: "v8.2",
        license: "CC0-1.0",
        url: "https://github.com/notify-rs/notify",
        description: "Filesystem change notification support.",
        descriptionZh: "文件系统变更通知支持。",
      },
      {
        name: "winreg / windows-sys",
        license: "MIT; MIT OR Apache-2.0",
        url: "https://github.com/microsoft/windows-rs",
        description: "Windows registry and operating-system API bindings.",
        descriptionZh: "Windows 注册表与系统 API 绑定。",
      },
    ],
  },
  {
    id: "build",
    title: "Build toolchain",
    titleZh: "构建工具链",
    projects: [
      {
        name: "TypeScript",
        version: "v5.6",
        license: "Apache-2.0",
        url: "https://github.com/microsoft/TypeScript",
        description: "Static typing and frontend compilation.",
        descriptionZh: "前端静态类型检查与编译工具。",
      },
      {
        name: "Vite / @vitejs/plugin-react",
        version: "v6",
        license: "MIT",
        url: "https://github.com/vitejs/vite",
        description: "Frontend development server and production bundler.",
        descriptionZh: "前端开发服务器与生产构建工具。",
      },
      {
        name: "Tauri CLI / tauri-build",
        version: "v2",
        license: "MIT OR Apache-2.0",
        url: "https://github.com/tauri-apps/tauri",
        description: "Desktop application build and packaging tools.",
        descriptionZh: "桌面应用构建与打包工具。",
      },
    ],
  },
  {
    id: "data",
    title: "Catalog and capability data",
    titleZh: "目录与能力数据",
    projects: [
      {
        name: "ByMykel/CSGO-API",
        version: "commit 342d496",
        license: "MIT",
        url: "https://github.com/ByMykel/CSGO-API",
        description: "Pinned sticker identifiers, localized names, and image metadata.",
        descriptionZh: "固定提交来源的贴纸 ID、本地化名称与图片元数据。",
      },
      {
        name: "SteamTracking/GameTracking-CS2",
        version: "commit 88d5684",
        license: "No repository license published",
        url: "https://github.com/SteamTracking/GameTracking-CS2",
        description: "Pinned factual schema reference used to constrain supported weapons; the repository publishes no license file.",
        descriptionZh: "用于限制支持武器范围的固定事实型 schema 参考；该仓库未发布许可证文件。",
      },
    ],
  },
];
