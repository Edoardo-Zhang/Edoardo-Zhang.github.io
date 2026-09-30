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
2. 在 OSS 控制台为 Bucket 设置跨域（CORS）规则：
   - 来源：你的站点域名（开发时 `http://localhost:5173`）
   - 允许 Methods：`GET, PUT, DELETE, HEAD`
   - 允许 Headers：`*`
   - 暴露 Headers：`ETag`
3. Bucket 可保持**私有**：读写都通过带签名的 URL 完成（签名方式为 OSS V1 查询字符串签名，已与官方 `ali-oss` SDK 逐字节对照）。

数据布局（前缀默认为 `zuoyexiang/`）：

- `zuoyexiang/cards/<id>.json` —— 一份作业（科目、逐项内容、截止日期、布置人、附件信息）
- `zuoyexiang/files/<id>/<n>-<rand>.<ext>` —— 附件原文件（原始文件名保存在卡片 JSON 中）

> **安全提示**：没有后端时，凭证会被打包进前端，任何访问者都能看到。请务必使用**只授权该 Bucket + 前缀**（`oss:GetObject`、`oss:PutObject`、`oss:DeleteObject`、`oss:ListObjects`）的 RAM 子账号，或短期 STS 临时凭证；如需更严格的权限控制，请增加一个签发 STS 的小后端。

## 行为说明

- 四段风景按顺序循环，每段停留时长等于其视频自身时长：视频从第一帧播放，结束前 1 秒开始 1000 ms 交叉淡化到下一段（时序由视频本身驱动，后台时随视频一起暂停）；点击风景标签立即切换并从该视频开头重新计时；淡化期间忽略其他切换。停留在作业页时背景保持当前风景，以柔和溶解循环。
- “深林”选中时，徽章、标题、说明、控件与风景切换器在 700 ms 内过渡为 `#182C41`。
- 首屏与作业页是两个全屏视图，页面本身不滚动：点击“获取作业”后首屏轻微放大、模糊并淡出，作业页随后上浮淡入；作业页只包含作业卡片，左上角返回按钮、页尾“回到车窗”或浏览器后退可回到首屏。
