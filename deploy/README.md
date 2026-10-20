# 部署到云服务器（24 小时在线，不依赖你的电脑）

## 一、先明确两件事

1. **云端读不到你本地的通达信数据**：没有 `vipdoc`，程序会自动切到「在线数据模式」
   （腾讯/新浪日线），选股、评分、历史、打卡都能用。
2. **云端不能写入你本地的通达信板块**：板块写入必须在本机版操作。
   云端定位是「随时能打开的网页版」；本机版保留写板块和 14:45 精确快照。

## 二、准备

- **服务器**：腾讯云轻量 / 阿里云轻量，2 核 2G，Ubuntu 22.04 或 24.04。
  - 大陆节点：访问快，但绑定域名需要 **ICP 备案**（1~3 周）。
  - 香港/新加坡节点：免备案，国内访问稍慢，行情接口更稳。
- **域名**（可选但推荐）：A 记录指向服务器公网 IP。
- **费用**：轻量服务器约 ¥24~60/月（新用户活动更低），域名约 ¥30/年。

## 三、上传代码

在本地项目目录执行（把 IP 换成你的服务器）：

```bash
scp -r . root@你的服务器IP:/opt/picker
```

或者把代码放到 GitHub，服务器上 `git clone`。

## 四、安装 Docker（Ubuntu）

```bash
curl -fsSL https://get.docker.com | sh
```

国内服务器如果拉镜像慢，可在 `/etc/docker/daemon.json` 配镜像加速后
`systemctl restart docker`。

## 五、配置并启动

```bash
cd /opt/picker
mkdir -p data
cp deploy/config.cloud.json data/config.json   # 在线模式 + 关闭自动写板块
nano Caddyfile                                 # 把 stock.example.com 改成你的域名
docker compose up -d --build
```

首次构建约 1~3 分钟。检查：

```bash
docker compose ps
curl http://127.0.0.1:8765/api/health
```

浏览器打开 `https://你的域名`，Caddy 会自动申请 HTTPS 证书。

> 没有域名也能先用 `http://服务器IP:8765`，但需要把 compose 里的端口映射改成
> `"8765:8765"`，且没有 HTTPS，不建议长期这样用。

## 六、第一次选股

在线模式第一次要把全市场约 5000 只股票的日线抓下来，约 2~3 分钟，
页面会显示「正在下载日线 xx%」。

可以直接在网页点「开始选股」，也可以在服务器上触发：

```bash
curl -X POST http://127.0.0.1:8765/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"boards":["main","gem","star"],"strategy":"fourtypes"}'
```

## 七、定时任务

容器内按北京时间运行：14:45 记录涨跌幅快照，15:05 自动选股。
`restart: unless-stopped` 会在崩溃或重启后自动拉起，服务器开机即恢复。

## 八、更新代码

本地改完后重新上传，然后：

```bash
cd /opt/picker
docker compose up -d --build
```

`data/` 是挂载在宿主机的，更新不会丢配置和历史。

## 九、数据与备份

- 宿主机目录 `./data`：`config.json`、`last_result.json`、`history/`、`kline/` 缓存、板块备份。
- 备份：`tar czf picker-backup-$(date +%F).tgz data`
- 重置：`docker compose down`，删除 `data/`，再 `up -d`。

## 十、安全建议

- 公网只开 80/443；8765 只绑定 `127.0.0.1`，不要直接暴露。
- 访客默认只读：写入板块、改设置都会返回 403。
- 访客可以点「开始选股」，如果不想被刷，把 `data/config.json` 里
  `share.allow_remote_scan` 改成 `false`，重启容器；站长用上面的 curl 触发。
- 对外分享用域名，不要用 IP+端口。

## 十一、常见问题

**HTTPS 证书申请失败**
域名是否解析到这台服务器、安全组是否放行 80/443；看日志：
`docker compose logs caddy`。

**行情抓不到 / 选股一直转圈**
云厂商 IP 可能被腾讯/新浪限流。换香港节点，或在服务器上配代理；
看 `docker compose logs -f picker` 的进度。

**内存不够**
5000 只日线缓存约几百 MB，2G 内存够用，1G 会紧张。

**时间不对**
确认 compose 里 `TZ=Asia/Shanghai`，容器内 `date` 应为北京时间。

**想写回本地通达信**
云端做不到。流程是：云端选股 → 导出 CSV → 本机版导入/手动写入板块。

## 十二、其他方案对比

| 方案 | 24 小时 | 国内访问 | 难度 | 说明 |
|---|---|---|---|---|
| 云服务器 + Docker（本文） | ✅ | 好（大陆需备案） | 中 | 推荐，可控、便宜 |
| Railway / Render / Fly.io | ✅（付费） | 一般 | 低 | 免费档会休眠，需持久卷 |
| Vercel / Netlify 等静态托管 | ❌ | 好 | 低 | 跑不了 Python 定时任务和扫描 |
| Cloudflare Tunnel + 你的电脑 | ❌ | 好 | 低 | 电脑关机就断，不符合需求 |

## 十三、只给几个人用（推荐）

不需要公开大站，一台最小服务器 + 一个密码就够：

1. 用 `deploy/Caddyfile.friends` 代替 `Caddyfile`：
   ```bash
   # 生成密码哈希（把 你的密码 换成实际密码）
   docker run --rm caddy:2 caddy hash-password --plaintext '你的密码'
   ```
   把输出的哈希填进 `Caddyfile.friends`；多人就在 `basic_auth` 里加多行。
2. 手机/电脑打开 `https://你的域名`，输入一次密码，浏览器会记住。
3. 页面已做手机适配：统计卡三列、战法按钮换行、表格横向滚动。
4. 更私密（完全不暴露公网）：用 Tailscale 免费版（3 用户/100 设备），
   每人装 Tailscale App，通过 `100.x` 内网地址访问，适合家人。
5. 更省事：Cloudflare Access 免费版 50 人以内，邮箱验证码登录
   （域名需要托管在 Cloudflare）。

配置建议：1 核 2G 足够几个人用；首次扫描内存峰值约 300~500MB。
不想让访客点「开始选股」，把 `data/config.json` 里
`share.allow_remote_scan` 设为 `false`，重启容器即可。
