# 作业箱

电影感首屏 + 作业卡片的纯前端作业通知网站（Vite · React · TypeScript · Tailwind CSS v4）。

```bash
npm install
npm run dev      # 开发
npm run build    # 正式构建，输出 dist/
npm run preview  # 预览构建产物
```

## 素材

全部本地加载，位于 `public/input-assets/`，以相对路径引用（`vite.config.ts` 中 `base: './'`）：

| 文件 | 用途 |
| --- | --- |
| `golden-hour.mp4` | 金色时刻 |
| `still-water.mp4` | 静水 |
| `deep-forest.mp4` | 深林 |
| `quiet-dawn.mp4` | 静谧黎明 |
| `window.png` | 透明列车车厢前景 |
| `headline-serif-traced.ttf` | 标题字体（仅含标题用到的 19 个字形，缺字如“作业”回退到系统衬线体） |

## 阿里云 OSS（让别人看到作业与附件）

未配置时，作业只保存在当前浏览器（localStorage），附件只记录文件名/大小/类型，不会上传。

1. 复制 `.env.example` 为 `.env.local`，填写 Region、Bucket 与凭证，然后重新 `npm run dev` / `npm run build`。
2. 在 OSS 控制台为 Bucket 设置跨域（CORS）规则（当前线上配置）：
   - 来源：`https://bitjiaxin.cn`、`https://www.bitjiaxin.cn`（开发时另加 `http://localhost:5173`）
   - 允许 Methods：`GET, HEAD, POST, PUT, DELETE`
   - 允许 Headers：`*`
   - 暴露 Headers：`Content-Length, Content-Range, Accept-Ranges, ETag, x-oss-request-id`
   - 缓存时间：`600` 秒
3. Bucket 必须为**私有**（`GET /?acl` 应返回 `private`）：列举、上传、读取、下载全部走带签名的 URL，不依赖任何匿名读权限。
   签名方式为 **OSS V4（`OSS4-HMAC-SHA256`）查询字符串签名**，payload 用 `UNSIGNED-PAYLOAD`；注意请求里若带了 `x-oss-*` 头（例如 `x-oss-acl`），**必须一并纳入签名**，否则 OSS 返回 `SignatureDoesNotMatch`。

数据布局（前缀默认为 `zuoyexiang/`）：

- `zuoyexiang/cards/<id>.json` —— 一份作业（科目、逐项内容、截止日期、布置人、附件信息）
- `zuoyexiang/files/<id>/<n>-<rand>.<ext>` —— 附件原文件（原始文件名保存在卡片 JSON 中）

> **安全提示**：没有后端时，凭证会被打包进前端，任何访问者都能看到。请务必使用**只授权该 Bucket + 前缀**（`oss:GetObject`、`oss:PutObject`、`oss:DeleteObject`、`oss:ListObjects`）的 RAM 子账号，或短期 STS 临时凭证；如需更严格的权限控制，请增加一个签发 STS 的小后端。

## 部署

线上站点：**https://bitjiaxin.cn/**（`www.bitjiaxin.cn` 会 301 跳到主域名）

- 仓库本身就是 GitHub Pages **用户站仓库**（`Edoardo-Zhang.github.io`），所以域名挂在**根路径**。仓库名不要改回普通项目名，否则地址会变成 `bitjiaxin.cn/<仓库名>/`。
- `public/CNAME` 内容为 `bitjiaxin.cn`；DNS（DNSPod）需要：

  | 主机记录 | 类型 | 记录值 |
  | --- | --- | --- |
  | `@` | A | `185.199.108.153`（官方推荐补齐 .109/.110/.111 四条，套餐受限时 1 条也能用） |
  | `www` | CNAME | `edoardo-zhang.github.io` |

- 推送 `main` 或手动触发 `workflow_dispatch` 即运行 `.github/workflows/deploy.yml` 构建并发布；HTTPS 证书由 GitHub 自动签发，签发后在仓库 Settings → Pages 打开 **Enforce HTTPS**。
- 构建时由 GitHub Secrets 注入 `VITE_OSS_ACCESS_KEY_ID` / `VITE_OSS_ACCESS_KEY_SECRET`（工作流内写死 Region `oss-cn-hangzhou`、Bucket `bitjiaxin`）。
- OSS 侧配套：CORS 允许上述来源；RAM 子账号策略**只授权 `bitjiaxin/zuoyexiang/*`**（`oss:PutObject/GetObject/DeleteObject/AbortMultipartUpload`，另加带 `oss:Prefix` 条件的 `oss:ListObjects`），不要给整桶权限。

## 行为说明

- 四段风景按顺序循环，每段停留时长等于其视频自身时长：视频从第一帧播放，结束前 1 秒开始 1000 ms 交叉淡化到下一段（时序由视频本身驱动，后台时随视频一起暂停）；点击风景标签立即切换并从该视频开头重新计时；淡化期间忽略其他切换。停留在作业页时背景保持当前风景，以柔和溶解循环。
- “深林”选中时，徽章、标题、说明、控件与风景切换器在 700 ms 内过渡为 `#182C41`。
- 上传失败会自动重试：网络中断、超时、5xx、429 最多重试到第 3 次尝试（指数退避 + 抖动，每次重试重新签名），4xx 立即失败不空转；界面显示"重试中（第 N 次）"。整份作业发布失败时会**回滚**本次已上传的附件与卡片，桶里不留孤儿文件。
- 首屏与作业页是两个全屏视图，页面本身不滚动：点击“获取作业”后首屏轻微放大、模糊并淡出，作业页随后上浮淡入；作业页只包含作业卡片，左上角返回按钮、页尾“回到车窗”或浏览器后退可回到首屏。
