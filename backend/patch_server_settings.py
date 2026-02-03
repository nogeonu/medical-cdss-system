#!/usr/bin/env python3
"""서버 settings.py에 ASGI + CHANNEL_LAYERS 추가 (한 번 실행용)."""
import re

SETTINGS_PATH = "eventeye/settings.py"

with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
    content = f.read()

changed = False

# 1) INSTALLED_APPS에 "channels" 추가 (없을 때만)
if '"channels"' not in content and "'channels'" not in content:
    # "corsheaders", 다음에 channels 추가
    content = content.replace(
        '"corsheaders",',
        '"corsheaders",\n    "channels",',
        1,
    )
    changed = True

# 2) ASGI_APPLICATION + CHANNEL_LAYERS 추가 (없을 때만)
if "ASGI_APPLICATION" not in content:
    block = '''
ASGI_APPLICATION = "eventeye.asgi.application"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [("127.0.0.1", 6379)],
        },
    },
}
'''
    content = content.replace(
        'WSGI_APPLICATION = "eventeye.wsgi.application"',
        'WSGI_APPLICATION = "eventeye.wsgi.application"' + block,
        1,
    )
    changed = True

if changed:
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print("OK: settings.py patched (channels, ASGI_APPLICATION, CHANNEL_LAYERS).")
else:
    print("OK: no change needed.")
