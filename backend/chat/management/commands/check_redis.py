from django.conf import settings
from django.core.management.base import BaseCommand

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None


class Command(BaseCommand):
    help = "Check Redis connectivity based on REDIS_URL."

    def handle(self, *args, **options):
        redis_url = getattr(settings, "REDIS_URL", "")
        if not redis_url:
            self.stdout.write("REDIS_URL is empty. InMemoryChannelLayer is active.")
            return

        if redis is None:
            self.stderr.write("redis package not available.")
            return

        try:
            client = redis.Redis.from_url(redis_url)
            pong = client.ping()
        except Exception as exc:  # pragma: no cover
            self.stderr.write(f"Redis connection failed: {exc}")
            return

        if pong:
            self.stdout.write("Redis connection OK.")
            return

        self.stderr.write("Redis ping failed.")
