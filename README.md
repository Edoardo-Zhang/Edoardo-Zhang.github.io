# 作业箱

电影感首屏 + 作业卡片的作业通知网站（Vite · React · TypeScript · Tailwind CSS v4 + Node 后端 + 阿里云 OSS）。

**架构**（密钥不出服务器）：

```
同学浏览器 ──► nginx :443（bitjiaxin.cn）
                ├─ /            静态前端（dist/）
                └─ /api/*       Node 后端 ──► 阿里云 OSS（私有桶）
                                    └─ AccessKey 只存在服务器的 .env 里
```

- 前端**不含任何凭证**：上传用后端签发的 5 分钟临时 URL 直传 OSS，下载走后端 302 跳转。
- OSS 桶保持**私有**；前端产物里搜不到 AK/SK（可用 `grep -r LTAI dist/` 自查，应为空）。

## 本地开发

需要两个终端：

```bash
# 终端 1：后端（3000）
cd server && cp .env.example .env   # 填 OSS 配置，只在本机使用
npm install && npm run dev

# 终端 2：前端（5173，/api 自动代理到 3000）
npm install && npm run dev
```

构建：`npm run build` → 产物在 `dist/`。

## 后端 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（含当前 bucket/前缀） |
| GET | `/api/homework` | 作业列表（按时间倒序） |
| POST | `/api/homework/prepare` | 传文件清单 → 返回 `id` 与每个文件的预签名上传地址 |
| POST | `/api/homework/commit` | 文件传完后落库；**会先确认每个对象真的存在** |
| POST | `/api/homework/:id/abort` | 失败回滚：删掉本次已传的附件 |
| DELETE | `/api/homework/:id` | 删除作业及其附件 |
| GET | `/api/download?key=&name=` | 校验 key 在前缀内后 302 到短期签名链接 |

发布流程：`prepare` → 浏览器直传 OSS（带进度/重试）→ `commit`；任一步失败都会 `abort` 回滚，桶里不留孤儿文件。

## 数据布局（前缀默认 `zuoyexiang/`）

- `zuoyexiang/cards/<id>.json` —— 一份作业（科目、逐项内容、截止日期、布置人、附件信息）
- `zuoyexiang/files/<id>/<n>-<rand>.<ext>` —— 附件原文件（原始文件名保存在卡片 JSON 中）

## 部署（当前线上：腾讯云轻量服务器 · 上海 · Ubuntu）

1. **控制台**：防火墙放行 TCP 80/443；准备好 OSS 的 RAM 子账号密钥。
2. **上传代码与产物**：把 `dist/`、`server/`（不含 node_modules）同步到服务器 `/opt/zuoyexiang/`，把 `server/.env`（`chmod 600`）单独传上去。
3. **初始化**（服务器上以 root 执行一次）：
   ```bash
   bash /opt/zuoyexiang/server/deploy/bootstrap.sh
   ```
   会装 Node 22/nginx/certbot，建 `zuoyexiang` 服务账号，装 systemd 服务与 nginx 站点并启动。
4. **域名解析**：`bitjiaxin.cn` 的 A 记录指向服务器公网 IP（`www` 可 CNAME 到主域名）。
5. **HTTPS**：
   ```bash
   certbot --nginx -d bitjiaxin.cn -d www.bitjiaxin.cn
   ```
6. **日常发布**（Windows 本机一键）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File server/deploy/publish.ps1 -Key "<ssh 私钥路径>"
   ```
   构建前端 → 打包上传 → 重装后端依赖 → 重启服务。

线上目录：`/opt/zuoyexiang/{dist,server}`；服务名 `zuoyexiang`（systemd，已设开机自启）。

OSS 侧要求：桶**私有**；CORS 允许站点来源（浏览器直传需要）；RAM 子账号**只授权 `<bucket>/zuoyexiang/*`**。

## 素材

全部本地加载，位于 `public/input-assets/`，以相对路径引用（`vite.config.ts` 中 `base: './'`）：

| 文件 | 用途 |
| --- | --- |
| `golden-hour.mp4` | 金色时刻 |
| `still-water.mp4` | 静水 |
| `deep-forest.mp4` | 深林 |
| `quiet-dawn.mp4` | 静谧黎明 |
| `window.png` | 透明列车车厢前景 |
| `headline-serif-traced.ttf` | 标题字体（仅含标题用到的 19 个字形，缺字如"作业"回退到系统衬线体） |

## 行为说明

- 上传失败会自动重试：网络中断、超时、5xx 最多重试到第 3 次尝试（指数退避 + 抖动，每次重试都用后端新签的地址），4xx 立即失败；界面显示"重试中（第 N 次）"。整份作业发布失败时会**回滚**本次已上传的附件，桶里不留孤儿文件。
- 四段风景按顺序循环，每段停留时长等于其视频自身时长：视频从第一帧播放，结束前 1 秒开始 1000 ms 交叉淡化到下一段（时序由视频本身驱动，后台时随视频一起暂停）；点击风景标签立即切换并从该视频开头重新计时；淡化期间忽略其他切换。停留在作业页时背景保持当前风景，以柔和溶解循环。
- "深林"选中时，徽章、标题、说明、控件与风景切换器在 700 ms 内过渡为 `#182C41`。
- 首屏与作业页是两个全屏视图，页面本身不滚动：点击"获取作业"后首屏轻微放大、模糊并淡出，作业页随后上浮淡入；作业页只包含作业卡片，左上角返回按钮、页尾"回到车窗"或浏览器后退可回到首屏。
