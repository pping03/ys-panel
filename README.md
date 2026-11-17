# 私人影视库（ys-site）

自用的影视库「空壳」：带密码门、多源并发搜索、测速优选与自动换源、移动端适配与 PWA。
**本仓库不内置任何片源**（`config.json` 的 `api_site` 为空），也不含解析线路、去水印或短视频解析功能。
片源由使用者自行配置，使用者需自行确认所配置来源的合法性与授权。

改动清单与部署说明见 [CHANGES-ys.md](CHANGES-ys.md)。

## 技术栈

Next.js 14（App Router）· TypeScript · Tailwind CSS · ArtPlayer · HLS.js · next-pwa

## 本地运行

```bash
pnpm install
PASSWORD=<你的访问密码> pnpm build
PASSWORD=<你的访问密码> pnpm start
```

## 环境变量

| 变量 | 说明 | 是否必填 |
| --- | --- | --- |
| `PASSWORD` | 访问密码（未设置时全站跳转到警告页，不可用） | 必填 |
| `NEXT_PUBLIC_STORAGE_TYPE` | 存储方式，自用填 `localstorage`（默认值） | 可选 |
| `SITE_NAME` | 站点名称，默认「私人影视库」 | 可选 |
| `ANNOUNCEMENT` | 首页公告弹窗文字，留空则不弹 | 可选 |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE` | 每个片源搜索的最大页数，默认 5 | 可选 |
| `NEXT_PUBLIC_IMAGE_PROXY` | 海报图片代理前缀 | 可选 |
| `NEXT_PUBLIC_DOUBAN_PROXY` | 豆瓣数据代理前缀 | 可选 |
| `NEXT_PUBLIC_DISABLE_YELLOW_FILTER` | 设为 `true` 关闭成人内容过滤 | 可选 |

## 片源配置格式

片源写在根目录 `config.json` 的 `api_site` 里（JSON 不支持注释，格式说明放在这里）。
接口需兼容苹果 CMS V10 的 JSON 接口（`?ac=videolist&wd=关键词`）。下面是**格式示意**，域名为占位符：

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

- `mysource1`：片源的唯一标识（小写字母/数字）。
- `api`：片源的 vod JSON 接口根地址。
- `name`：界面上显示的名字。
- `detail`：可选，个别片源需要网页详情地址时才填。

可选的自定义豆瓣分类（显示在导航「自定义」里）：

```json
"custom_category": [{ "name": "国产剧", "type": "tv", "query": "国产剧" }]
```

修改 `config.json` 后需重新构建/部署才生效。配置为空时，搜索返回空结果，不会报错。

## 致谢与许可

本项目基于 [lingxuxiaoyao/NovaTV](https://github.com/lingxuxiaoyao/NovaTV)（MIT，基线提交 `12766fd5528d68c2bafc716d25e26cecf6f9750a`）修改，
NovaTV 基于 [MoonTV](https://github.com/samqin123/MoonTV)，并受 [LibreTV](https://github.com/LibreSpark/LibreTV) 启发；
播放器使用 [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) 与 [HLS.js](https://github.com/video-dev/hls.js/)。
原项目的 MIT 许可证保留在 [LICENSE](LICENSE)。
