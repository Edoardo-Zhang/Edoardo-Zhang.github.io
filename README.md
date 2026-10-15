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
| POST | `/api/auth/login` | 姓名 + 10 位学号登录（首次绑定姓名）；**若配置了 `ADMIN_PASSWORD_HASH`**，管理员学号会返回 `needPassword`，需带口令再登录一次 |
| GET / POST | `/api/auth/me` / `/api/auth/logout` | 当前登录用户 / 退出 |
| GET | `/api/homework` | 作业列表（按时间倒序，**需登录**，服务端内存缓存） |
| POST | `/api/homework/prepare` | 传文件清单（可为空）→ 返回 `id` 与每个文件的预签名上传地址 |
| POST | `/api/homework/commit` | 文件传完后落库；**会先确认每个对象真的存在** |
| POST | `/api/homework/:id/abort` | 失败回滚：删掉本次已传的附件 |
| POST | `/api/homework/:id/prepare` | 修改作业时为新增附件签发上传地址（沿用原 id 目录） |
| PUT | `/api/homework/:id` | 保存修改：传完整附件清单；保留 `createdAt`、写入 `updatedAt`；新附件须已上传；写入成功后删除被移除的旧附件 |
| DELETE | `/api/homework/:id` | 删除作业及其附件 |
| GET | `/api/download?key=&name=` | 作业附件下载（需登录，仅限 `files/`），302 到短期签名链接 |
| POST | `/api/homework/:id/submit/{prepare,commit,abort}` | 学生交作业（卡片须开启收作业）：要上传地址 → 直传 OSS → 确认提交；失败回滚 |
| GET | `/api/homework/:id/my-submission` | 自己在这张卡片上的最新提交 |
| GET | `/api/admin/stats` | **管理员**：每张收作业卡片的已交 / 未交 / 迟交（非管理员 403“暂无权限”） |
| GET | `/api/admin/file?key=&name=` | **管理员**：下载学生提交的文件 |
| DELETE | `/api/admin/users/:studentId` | **管理员**：解除学号与姓名的绑定（同学首次登录打错名字时用） |

布置 / 修改 / 删除作业卡片（`prepare`、`commit`、`PUT`、`DELETE`、`abort`）**仅管理员**可用。

发布流程：`prepare` → 浏览器直传 OSS（带进度/重试）→ `commit`；任一步失败都会 `abort` 回滚，桶里不留孤儿文件。

## 数据布局（前缀默认 `zuoyexiang/`）

- `zuoyexiang/cards/<id>.json` —— 一份作业（科目、逐项内容、截止日期、布置人、附件信息）
- `zuoyexiang/files/<id>/<n>-<rand>.<ext>` —— 附件原文件（原始文件名保存在卡片 JSON 中）
- `zuoyexiang/users/<学号>.json` —— 登录过的同学（姓名、首次 / 最近登录时间），也是统计里“未交名单”的来源
- `zuoyexiang/submissions/<卡片id>/<学号>/<版本>/` —— 一次提交的文件 + `meta.json`；`<学号>/latest.json` 指向最新一次。**旧版本永不删除，删除卡片也不会删除提交**

## 登录与管理员

- 同学：姓名 + 10 位学号即可登录（不是 10 位数字不让进）；首次登录把姓名绑定到学号，之后同一学号必须用同一姓名。会话 Cookie 30 天有效。
- 管理员（**默认不需要口令**，按学号白名单判定）：在项目根目录运行一次，写入 `server/.env` 并重启后端：
  ```bash
  node scripts/set-admins.mjs 1120260810 [更多学号...]   # 会顺带生成 SESSION_SECRET、清空口令
  sudo systemctl restart zuoyexiang
  ```
  白名单里的学号用「姓名 + 学号」直接登录即管理员。以后**加管理员就再跑一次这个脚本**（或直接改 `server/.env` 的 `ADMIN_STUDENT_IDS=学号1,学号2`）。
- 管理员**可选的**口令加固：想再要一道口令就运行 `node scripts/setup-admin.mjs <学号>`（口令在终端里隐藏输入，只存 scrypt 哈希）；把 `ADMIN_PASSWORD_HASH` 清空就恢复成免口令。
- 登录限流只统计**失败**的尝试（每 IP 每分钟 20 次），全班在同一校园网出口下同时登录不受影响。

## 收作业同步到本机

`sync/sync-submissions.mjs` 直接读 OSS（用本机 `server/.env` 的凭证，不依赖服务器在线），把提交增量下载到 `D:\作业箱收件\`：

```
D:\作业箱收件\<科目>_<截止日期>_<卡片id后6位>\<学号>_<姓名>\<提交时间>（迟交）\<原文件名>
                                             \提交汇总.csv   ← 每人最新状态（含未交名单）
```

- 先下载到 `.part`，校验大小后再改名；本地删掉的文件下次会重新下载；**永不删除**本地或 OSS 上的任何文件。
- 断网 / 关机期间提交的作业留在 OSS，下次联网自动补齐；日志在 `_sync.log`。
- 安装计划任务（登录时 + 每 30 分钟）：
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/install-sync-task.ps1
  ```
  卸载：同一命令加 `-Uninstall`。也可随时手动运行 `node sync/sync-submissions.mjs`。

## 测试

对着真实 OSS 跑，建议给测试后端用独立前缀（如 `OSS_PREFIX=zuoyexiang/_test/`）和测试管理员：

```bash
BASE=http://127.0.0.1:3010 ADMIN_ID=<管理员学号> ADMIN_PASSWORD=<口令> node server/test-auth.mjs    # 登录 / 权限 / 收作业 / 统计
BASE=http://127.0.0.1:3010 ADMIN_ID=<管理员学号> ADMIN_PASSWORD=<口令> node server/test-e2e.mjs     # 发布 / 附件 / 回滚
BASE=http://127.0.0.1:3010 ADMIN_ID=<管理员学号> ADMIN_PASSWORD=<口令> node server/test-update.mjs  # 修改作业
BASE=http://127.0.0.1:3011 ADMIN_ID=<管理员学号> node server/test-admin-nopassword.mjs                # 免口令管理员模式
```

## 当前线上状态（2026-10-15 起）

| 项 | 值 |
| --- | --- |
| 站点 | **https://bitjiaxin.cn**（`www` 同样可用，http 自动跳 https） |
| 服务器 | 腾讯云轻量 · **上海** · `43.142.131.119`（root 登录） |
| 服务 | nginx（静态 + 反代）+ systemd `zuoyexiang`（Node 后端，只监听 127.0.0.1:3000） |
| 证书 | Let's Encrypt，含 `bitjiaxin.cn` + `www.bitjiaxin.cn`，自动续期 |
| 备案 | **浙ICP备2026086083号**（页脚展示并链接工信部）；公安联网备案需在开通 30 日内办理 |
| 管理员 | 学号白名单（默认免口令）：`1120260810` |
| 已退役 | 香港 `43.129.85.64`（备案期临时中转，可退订） |

遇到 502/静态页 404 时：`systemctl status zuoyexiang nginx`；改完代码用上面的 `publish.ps1` 发布（默认目标已是上海）。

## 部署（当前线上：腾讯云轻量 · 上海 · Ubuntu）

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
| `golden-hour-v2.mp4` 等四段 MP4 | 四种风景，H.264 / 720p，已去除未使用的音轨并启用 faststart |
| `golden-hour-v2.webp` 等四张 WebP | 视频准备期间立即显示的首帧画面 |
| `window.webp` | 透明列车车厢前景 |
| `headline-serif-traced.ttf` | 标题字体（仅含标题用到的 19 个字形，缺字如"作业"回退到系统衬线体） |

未压缩的原视频保存在 `source-assets/video-originals/`，不会被打包进网站。四段网页视频合计约 5 MB（原先约 28 MB），每段视频保留 1280×720 分辨率；这是源素材的上限，真正提升大屏细节需要更高分辨率的原片。可用 `scripts/encode-videos.ps1` 和 FFmpeg 重新生成视频及首帧图；换素材时请使用新的版本名，并同步更新 `src/components/Hero.tsx` 与 `index.html`，以避开浏览器的 7 天缓存。

## 行为说明

- 上传失败会自动重试：网络中断、超时、5xx 最多重试到第 3 次尝试（指数退避 + 抖动，每次重试都用后端新签的地址），4xx 立即失败；界面显示"重试中（第 N 次）"。整份作业发布失败时会**回滚**本次已上传的附件，桶里不留孤儿文件。
- 四段风景按顺序循环，每段停留时长等于其视频自身时长：视频从第一帧播放，结束前 1 秒开始 1000 ms 交叉淡化到下一段（时序由视频本身驱动，后台时随视频一起暂停）；点击风景标签立即切换并从该视频开头重新计时；淡化期间忽略其他切换。作业页背景（调暗、模糊）同样按顺序连续轮播四段，从不单段重播。
- 弱网体验：脚本下载期间先显示第一段风景的静帧（不黑屏）；视频按顺序预取（当前段下载完才下一段，互不抢带宽）；一段视频能流畅播完才开始播放，此前显示其静帧；下一段还没下载完时，当前段停在最后一帧等待，最多 8 秒后带着静帧切换；正在下载的视频不会被打断重下，只有真正出错才按 1→16 秒退避重试。
- 进入作业页前须登录；只有管理员能布置、修改、删除作业卡片（删除需二次确认）。布置 / 修改时可打开“开启收作业”，同学即可在卡片上“交作业 / 重新提交”，截止日期（北京时间当天 23:59:59）之后提交标记“迟交”。作业页页脚有一个不起眼的统计图标，管理员点开是作业统计（已交 / 未交 / 迟交、搜索、下载、导出 CSV），其他人点击提示“暂无权限”。“修改”原位展开为表单，可改科目、内容、截止日期、布置人，移除已有附件或追加新附件；修改过的卡片显示“已修改”。
- "深林"选中时，徽章、标题、说明、控件与风景切换器在 700 ms 内过渡为 `#182C41`。
- 首屏与作业页是两个全屏视图，页面本身不滚动：点击"获取作业"后首屏轻微放大、模糊并淡出，作业页随后上浮淡入；作业页只包含作业卡片，左上角返回按钮、页尾"回到车窗"或浏览器后退可回到首屏。
