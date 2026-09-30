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
| POST | `/api/homework/prepare` | 传文件清单（可为空）→ 返回 `id` 与每个文件的预签名上传地址 |
| POST | `/api/homework/commit` | 文件传完后落库；**会先确认每个对象真的存在** |
| POST | `/api/homework/:id/abort` | 失败回滚：删掉本次已传的附件 |
| POST | `/api/homework/:id/prepare` | 修改作业时为新增附件签发上传地址（沿用原 id 目录） |
| PUT | `/api/homework/:id` | 保存修改：传完整附件清单；保留 `createdAt`、写入 `updatedAt`；新附件须已上传；写入成功后删除被移除的旧附件 |
| DELETE | `/api/homework/:id` | 删除作业及其附件 |
| GET | `/api/download?key=&name=` | 校验 key 在前缀内后 302 到短期签名链接 |

发布流程：`prepare` → 浏览器直传 OSS（带进度/重试）→ `commit`；任一步失败都会 `abort` 回滚，桶里不留孤儿文件。

## 数据布局（前缀默认 `zuoyexiang/`）

- `zuoyexiang/cards/<id>.json` —— 一份作业（科目、逐项内容、截止日期、布置人、附件信息）
- `zuoyexiang/files/<id>/<n>-<rand>.<ext>` —— 附件原文件（原始文件名保存在卡片 JSON 中）

## 备案期间暂停（当前状态）

备案审核期间站点必须对外关闭，因此两台服务器的 nginx 均已 **stop + disable**（80/443 无监听）；
后端仍只监听本机 `127.0.0.1:3000`，外网不可达。

备案通过后恢复（在要对外服务的机器上执行）：

```bash
sudo systemctl enable --now nginx
```

再把 DNSPod 的 A 记录指向该机公网 IP：上海 `43.142.131.119`（正式）／香港 `43.129.85.64`（临时）。

证书：两台都是 Let's Encrypt，有效期至 2026-12-29；nginx 停止期间自动续期会失败，
恢复后执行 `sudo certbot renew --force-renewal` 重新签发即可。

## 部署（当前线上：腾讯云轻量 · 香港 · Ubuntu）

> 为什么要香港：域名未备案时，指向**内地**服务器会被腾讯云拦截（HTTP 302 到备案拦截页、HTTPS 握手被重置）。
> 上海那台（43.142.131.119）已完整部署、证书已签，**备案通过后把 A 记录改回去即可**（publish.ps1 -Server 43.142.131.119 -User root）。
> 备案号下来后要加进页脚。

| 项 | 当前 |
| --- | --- |
| 在服务 | 香港 43.129.85.64（ubuntu 用户） |
| 备用 | 上海 43.142.131.119（root 用户，备案用） |
| 域名 | bitjiaxin.cn / www.bitjiaxin.cn（Let's Encrypt，自动续期） |

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
- 四段风景按顺序循环，每段停留时长等于其视频自身时长：视频从第一帧播放，结束前 1 秒开始 1000 ms 交叉淡化到下一段（时序由视频本身驱动，后台时随视频一起暂停）；点击风景标签立即切换并从该视频开头重新计时；淡化期间忽略其他切换。作业页背景（调暗、模糊）同样按顺序连续轮播四段，从不单段重播。下一段在当前段开始 0.5 秒后预取。
- 无需登录：任何人都能修改、删除任何作业卡片（删除需二次确认）。“修改”原位展开为表单，可改科目、内容、截止日期、布置人，移除已有附件或追加新附件；修改过的卡片显示“已修改”。
- "深林"选中时，徽章、标题、说明、控件与风景切换器在 700 ms 内过渡为 `#182C41`。
- 首屏与作业页是两个全屏视图，页面本身不滚动：点击"获取作业"后首屏轻微放大、模糊并淡出，作业页随后上浮淡入；作业页只包含作业卡片，左上角返回按钮、页尾"回到车窗"或浏览器后退可回到首屏。
