from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("chat", "0006_chatroomuserstate_cleared_at"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChatAttachment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("file", models.FileField(upload_to="chat_attachments/")),
                ("original_name", models.CharField(max_length=255)),
                ("content_type", models.CharField(blank=True, max_length=100)),
                ("size", models.PositiveIntegerField(blank=True, null=True)),
                ("is_used", models.BooleanField(default=False)),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="chat_attachments",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(fields=["uploaded_by", "created_at"], name="att_up_cr_idx"),
                    models.Index(fields=["is_used", "created_at"], name="att_used_cr_idx"),
                ],
            },
        ),
    ]
