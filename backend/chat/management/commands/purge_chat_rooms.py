from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Count, F, Q
from django.db.models.functions import Coalesce
from django.utils import timezone

from chat.models import ChatRoom


class Command(BaseCommand):
    help = "Purge chat rooms hidden by all users and inactive beyond retention."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=None, help="Retention window in days.")
        parser.add_argument("--dry-run", action="store_true", help="Show how many rooms would be removed.")

    def handle(self, *args, **options):
        days = options.get("days")
        if days is None:
            days = int(getattr(settings, "CHAT_ROOM_RETENTION_DAYS", 30))
        if days < 0:
            self.stderr.write("Days must be non-negative.")
            return

        cutoff = timezone.now() - timedelta(days=days)
        stale_rooms = (
            ChatRoom.objects.annotate(
                last_activity_at=Coalesce(F("last_message_at"), F("created_at")),
                total_states=Count("user_states", distinct=True),
                hidden_states=Count(
                    "user_states",
                    filter=Q(user_states__is_hidden=True),
                    distinct=True,
                ),
            )
            .filter(last_activity_at__lt=cutoff)
            .filter(Q(total_states=0) | Q(hidden_states=F("total_states")))
        )

        count = stale_rooms.count()
        if options.get("dry_run"):
            self.stdout.write(f"Would delete {count} rooms older than {days} days.")
            return

        if count:
            stale_rooms.delete()
        self.stdout.write(f"Deleted {count} rooms older than {days} days.")
