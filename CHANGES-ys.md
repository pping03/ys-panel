# ys-site 改动说明（基于 NovaTV）

- 基线：`https://github.com/lingxuxiaoyao/NovaTV`，提交 `12766fd5528d68c2bafc716d25e26cecf6f9750a`（MIT）
- 定位：自用「空壳」播放站。**不内置任何片源**，不含 VIP 解析线路、去水印、短视频解析。
- 状态：只在本地整理与构建验证，**未推送、未部署**。

## 一、清空的内容（片源）

| 文件 | 改动 |
| --- | --- |
| `config.json` | 原有 20 个内置采集站条目全部删除，`api_site` 现为 `{}`，只保留 `cache_time` |
| `src/lib/runtime.ts` | 构建时由 `config.json` 自动生成（不入库），随之为空 |

全仓库检索确认：`src/` 里没有其他写死的资源站、解析接口或直播源列表。代码里剩下的外部地址只有豆瓣（见第五节）。

## 二、删除的内容（广告 / 引流 / 回连上游）

| 路径 | 原来做什么 | 处理 |
| --- | --- | --- |
| `src/lib/version.ts` | 浏览器端每次进登录页、每次页面跳转都去 `ghfast.top` / `raw.githubusercontent.com` 拉上游仓库的 `VERSION.txt` 做版本检查 | 整个文件删除 |
| `src/lib/systemUpdate.ts` | 服务端请求 `api.github.com`（上游仓库提交记录）、`ghcr.io`（镜像标签），以及通过 docker.sock / watchtower 一键更新 | 整个文件删除 |
| `src/app/api/admin/update/route.ts` | 「站长面板一键更新」接口 | 整个文件删除（现在访问返回 404） |
| `src/app/admin/page.tsx` | 管理页「系统更新」标签页及其全部逻辑 | 删除该标签页与相关代码、无用图标引用 |
| `src/app/login/page.tsx` | 登录页底部版本号按钮（点击跳上游 GitHub 仓库）+ 版本检查 | 删除 |
| `src/components/UserMenu.tsx` | 用户菜单底部版本号按钮（点击跳上游 GitHub 仓库）、更新小圆点、版本检查 | 删除 |
| `proxy.worker.js` | 独立的 Cloudflare Worker 代理脚本，页面里引用第三方 CDN、icons8 图片和 `imgapi.cn` 背景图 | 整个文件删除（与 Vercel 部署无关） |
| `public/screenshot1.png`、`screenshot2.png`、`screenshot3.png` | 上游 README 宣传截图（共约 18.9 MB） | 删除 |
| `.github/workflows/docker-image.yml` | 上游的 Docker 镜像自动发布流程 | 删除 |
| `VERSION.txt`、`scripts/generate-version.js`、`package.json` 的 `gen:version`、`.husky/pre-commit` 里的版本生成步骤 | 上游版本号机制 | 删除 |
| `README.md` | 上游宣传文案、徽章、截图、内置资源站示例、一键更新说明 | 重写为简短自用说明（保留致谢） |
| 默认公告弹窗（`src/lib/config.ts` 4 处、`src/app/layout.tsx`、`src/components/SiteProvider.tsx`） | 首次进站弹出默认声明 | 默认值改为空：不设置 `ANNOUNCEMENT` 就不弹窗 |
| `src/middleware.ts` | 放行列表里的 `/screenshot.png` | 删除 |

检索结果：`src/` 里**没有**统计/跟踪脚本（百度统计、Google Analytics、umami、clarity 等）、赞助链接、QQ 群/Telegram 推广、打赏提示，所以这几类没有可删的东西。构建产物里已检索不到 `lingxuxiaoyao`、`ghfast`、`VERSION.txt`、`ghcr.io`。

**保留**：播放器里的「去广告」开关（`src/app/play/page.tsx` 的 `filterAdsFromM3U8`，过滤 HLS 里的切片广告），这是播放功能。

## 三、品牌

- 默认站名改为「私人影视库」（`src/lib/config.ts`、`src/app/layout.tsx`、`src/components/SiteProvider.tsx`、`scripts/generate-manifest.js`、`src/app/warning/page.tsx`、`src/app/play/page.tsx` 的媒体信息），仍可用 `SITE_NAME` 覆盖。
- `package.json` 的包名改为 `ys-site`。
- `LICENSE`（MIT，含原作者版权行）原样保留；`README.md` 末尾保留对 NovaTV / MoonTV / LibreTV 的致谢。
- 浏览器本地存储的键名仍是 `novatv_*`（纯内部标识，界面上看不到），未改。

## 四、新增 / 加强

### 1. 首页分区选择（`src/lib/discover.ts`、`src/components/HomeDiscover.tsx`、`src/app/page.tsx`）

首页改为一排可选分区（手机上可横向滑动，记住上次选择），选中后显示该分区的海报墙。
列表只是豆瓣公开的片名/海报/评分；点条目进入本站播放页，由本站在**你配置的片源**里搜索。

| 分区 | 类型 | 数据来源 |
| --- | --- | --- |
| 热播剧 | 真实榜单 | 豆瓣「近期热门剧集」（`recent_hot/tv`，`type=tv`） |
| 推荐剧 | 真实榜单（口径有说明） | 豆瓣选剧「热门」标签按推荐排序（`search_subjects`，`sort=recommend`）；会混入少量综艺 |
| 电影 | 真实榜单 | 豆瓣「近期热门电影」（`recent_hot/movie`） |
| 综艺 | 真实榜单 | 豆瓣「近期热门综艺」（`type=show`） |
| 动漫 | 真实榜单 | 豆瓣「近期热门动画剧集」（`type=tv_animation`），不含动画电影 |
| 网剧 | **近似** | 豆瓣没有「网剧」分类（实测 `网剧`/`网络剧` 标签返回空），显示的是「国产剧近期热门」（`type=tv_domestic`），页面上有说明 |
| AI短剧 | **搜索快捷入口，不是榜单** | 豆瓣没有短剧榜单（实测 `短剧`/`微短剧` 标签返回空）。只放三个关键词按钮（AI短剧 / 短剧 / 微短剧），点了去本站搜索页，按片名在你的片源里搜；有没有结果取决于你的片源 |

原首页的「热门电影 / 热门剧集 / 热门综艺」三行已并入上面的分区。侧边栏与底部导航的 电影 / 剧集 / 综艺 分类页保持不变。

### 2. 播放失败自动换源（`src/app/play/page.tsx`）

上游原有：进入播放页时并发搜索所有片源 → 首包测速淘汰失效源 → 分辨率/网速测速选最优源；播放中可手动换源。
上游**没有**的：播放中当前源挂掉后自动切换（原来只是销毁播放器）。
本次新增：HLS 出现致命错误时（网络错误先重试 2 次），自动切到下一个未失败且测速最快的源，并在播放器上提示；全部失败才提示无可用源。

### 3. 密码门加固（`src/app/api/login/route.ts`、`src/middleware.ts`）

- 上游在 localstorage 模式下把**明文密码写进 `auth` cookie**（且 cookie 可被页面脚本读取）。现改为 cookie 里只放「登录时间戳 + 用 `PASSWORD` 做密钥的 HMAC-SHA256 签名」，中间件验签，并限制 7 天有效。
- https 下 cookie 加 `Secure`。
- PWA 的 `sw.js` 与 `workbox-*.js` 加入免登录放行（纯静态脚本），否则未登录时 service worker 注册不上。

### 4. 小修

- `src/lib/douban.client.ts`：设置了豆瓣代理时，`fetchDoubanList` 读错了返回字段（读 `items`，接口实际返回 `subjects`），已修正。

## 五、代码审查：回连与密码泄露

- **回连上游**：第二节列出的版本检查与一键更新是仅有的回连点，已全部删除。
- **仍会访问的外部地址**：只有豆瓣（`m.douban.com`、`movie.douban.com`，用于榜单元数据和海报）；以及你自己配置的片源、你自己设置的图片/豆瓣代理。构建时 Next.js 会从 Google Fonts 下载 Inter 字体并打包进站点，运行时不再访问 Google。
- **密码**：明文进 cookie 的问题已修（见上）。登录时密码只通过 POST `/api/login` 发给本站。
- `src/components/ActivityReporter.tsx`：只向本站 `/api/user/activity` 上报，且 localstorage 模式下不启用。
- `/api/image-proxy`：可以代取任意图片地址，但在密码门之后，未登录访问返回 401。
- `/api/cron`、`/api/server-config`、`/api/session/check`：免登录；localstorage 模式下 `/api/cron` 不做任何事，`/api/server-config` 只返回站名和存储类型。`vercel.json` 里每天一次的 `/api/cron` 定时任务保留未动（localstorage 模式下是空跑，想去掉可删 `vercel.json` 的 `crons` 段）。
- 未设置 `PASSWORD` 时，全站跳到警告页，无法使用——所以 `PASSWORD` 必须配置。

## 六、Vercel 需要的环境变量（只列名字）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PASSWORD` | 是 | 访问密码，由你自己设定 |
| `NEXT_PUBLIC_STORAGE_TYPE` | 否 | 填 `localstorage`（不填默认也是它） |
| `SITE_NAME` | 否 | 默认「私人影视库」 |
| `ANNOUNCEMENT` | 否 | 想要首页弹公告时才填 |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE` | 否 | 每个片源最多搜几页，默认 5 |
| `NEXT_PUBLIC_IMAGE_PROXY` | 否 | 海报加载不出来时可配图片代理 |
| `NEXT_PUBLIC_DOUBAN_PROXY` | 否 | Vercel 访问豆瓣受限时可配豆瓣代理 |
| `NEXT_PUBLIC_DISABLE_YELLOW_FILTER` | 否 | `true` 关闭成人内容过滤 |

站名、公告等在构建时写入页面，改了环境变量要重新部署。

## 七、以后怎么填自己的片源

编辑仓库根目录 `config.json`，在 `api_site` 里按下面格式添加（域名为占位符，接口需兼容苹果 CMS V10 的 JSON 接口），提交后 Vercel 会自动重新部署：

```json
{
  "cache_time": 7200,
  "api_site": {
    "mysource1": {
      "api": "https://example.com/api.php/provide/vod",
      "name": "我的片源1",
      "detail": "https://example.com"
    }
  }
}
```

- 键名（如 `mysource1`）：唯一标识；`api`：vod 接口根地址；`name`：显示名；`detail`：可选。
- 可以填多个，搜索时会并发查询、按响应速度排序，播放时自动测速选源、失败自动换源。
- `api_site` 为空时，搜索返回空结果，不会报错。
- localstorage 模式下片源只能通过 `config.json` 配置（管理后台需要 Redis/Upstash/D1 存储才可用）。

## 八、验证情况

已验证（本地虚拟机，2026-11-17）：

- `pnpm install`、`tsc --noEmit`、`eslint src` 通过；`pnpm build` 成功。
- `next start` 本地起服务后用 curl 检查：未登录访问 `/`、`/search` → 307 跳 `/login`；未登录访问 `/api/search` → 401；`/login` → 200，标题为「私人影视库」；错误密码 → 401；正确密码 → 200，cookie 里只有签名和时间戳、不含密码；旧式明文 cookie 与伪造签名都被拒；登录后 `/`、`/search`、`/play` → 200；零片源时 `/api/search?q=test` 返回 `{"results":[]}`；`/api/admin/update` → 404；`/manifest.json`、`/sw.js` 免登录可取。
- 7 个分区用到的豆瓣接口，直接请求均返回数据（网剧、短剧相关标签确认为空）。

未验证：

- **本站的豆瓣接口（`/api/douban*`）在这台虚拟机里跑不通**（返回「fetch failed」）：虚拟机出网要走代理，而 Next 的 edge 运行时不走代理。所以「首页分区在浏览器里实际显示出海报」没有实测；部署到 Vercel 后是否能访问豆瓣也未实测（不通时可配 `NEXT_PUBLIC_DOUBAN_PROXY`）。
- 浏览器里的实际界面（分区切换、手机布局、PWA 安装）未实测，只做了编译和接口层验证。
- 播放与自动换源没有片源可测，属于只通过编译的代码。
- 未在 Vercel 上构建过。
