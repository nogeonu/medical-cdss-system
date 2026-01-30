# Generated manually for tissue_exam order type

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ocs', '0002_notification_and_imaging_analysis'),
    ]

    operations = [
        migrations.AlterField(
            model_name='order',
            name='order_type',
            field=models.CharField(
                choices=[
                    ('prescription', '처방전'),
                    ('lab_test', '검사'),
                    ('imaging', '영상촬영'),
                    ('tissue_exam', '조직검사'),
                ],
                max_length=20,
                verbose_name='주문 유형',
            ),
        ),
    ]
