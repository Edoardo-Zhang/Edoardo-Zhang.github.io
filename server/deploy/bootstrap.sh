#!/usr/bin/env bash
# 在服务器上执行一次：装 Node/nginx/certbot，建用户、目录、systemd 服务、nginx 站点。
# 用法（在服务器上，需要 root）：  bash /opt/zuoyexiang/server/deploy/bootstrap.sh
set -euo pipefail

DOMAIN=${DOMAIN:-bitjiaxin.cn}
APP_DIR=/opt/zuoyexiang
SVC_USER=zuoyexiang

echo "== 1/6 安装依赖 =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl rsync nginx certbot python3-certbot-nginx
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "node: $(node -v)  npm: $(npm -v)"

echo "== 2/6 服务账号与目录 =="
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP_DIR/dist" "$APP_DIR/server"
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"

echo "== 3/6 后端依赖 =="
cd "$APP_DIR/server"
sudo -u "$SVC_USER" npm ci --omit=dev || sudo -u "$SVC_USER" npm install --omit=dev

echo "== 4/6 systemd 服务 =="
install -m 644 "$APP_DIR/server/deploy/zuoyexiang.service" /etc/systemd/system/zuoyexiang.service
systemctl daemon-reload
systemctl enable zuoyexiang

echo "== 5/6 nginx 站点 =="
install -m 644 "$APP_DIR/server/deploy/nginx-zuoyexiang.conf" /etc/nginx/sites-available/zuoyexiang
sed -i "s/__DOMAIN__/$DOMAIN/g" /etc/nginx/sites-available/zuoyexiang
ln -sf /etc/nginx/sites-available/zuoyexiang /etc/nginx/sites-enabled/zuoyexiang
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "== 6/6 启动后端 =="
systemctl restart zuoyexiang
sleep 1
curl -fsS http://127.0.0.1:3000/api/health && echo
echo
echo "完成。接下来（域名解析指向本机后）： certbot --nginx -d $DOMAIN -d www.$DOMAIN"
