#!/usr/bin/env bash
# Prints the chat id(s) of people who have messaged your Telegram bot.
# Usage: make telegram-chat-id   (reads TELEGRAM_BOT_TOKEN from .env)
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Set TELEGRAM_BOT_TOKEN in .env first (get it from @BotFather)." >&2
  exit 1
fi
if ! resp=$(curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" 2>&1); then
  echo "Could not reach Telegram (check the token and your internet connection): $resp" >&2
  exit 1
fi
printf '%s' "$resp" | python3 -c '
import sys, json
data = json.load(sys.stdin)
if not data.get("ok"):
    sys.exit("Telegram error: %s" % data.get("description"))
chats = {}
for u in data.get("result", []):
    msg = u.get("message") or u.get("channel_post") or {}
    chat = msg.get("chat")
    if chat:
        chats[chat["id"]] = chat.get("first_name") or chat.get("title") or ""
if not chats:
    print("No messages yet: open your bot in Telegram, send it any message, then run this again.")
for cid, name in chats.items():
    print("TELEGRAM_CHAT_ID=%s   (%s)" % (cid, name))
'
