"""
모든 예약의 doctor_department를 doctor의 실제 부서로 업데이트하는 관리 명령
"""
from django.core.management.base import BaseCommand
from patients.models import Appointment
from eventeye.doctor_utils import get_department


class Command(BaseCommand):
    help = '모든 예약의 doctor_department를 doctor의 실제 부서로 업데이트'

    def handle(self, *args, **options):
        appointments = Appointment.objects.filter(doctor__isnull=False)
        total = appointments.count()
        updated = 0
        
        self.stdout.write(f'총 {total}개의 예약을 확인합니다...')
        
        for appointment in appointments:
            if appointment.doctor:
                actual_dept = get_department(appointment.doctor.id)
                if actual_dept and appointment.doctor_department != actual_dept:
                    self.stdout.write(
                        f'예약 ID {appointment.id}: '
                        f'doctor_department "{appointment.doctor_department}" -> "{actual_dept}"'
                    )
                    appointment.doctor_department = actual_dept
                    appointment.save(update_fields=['doctor_department'])
                    updated += 1
        
        self.stdout.write(
            self.style.SUCCESS(f'완료: {updated}개의 예약 업데이트됨 (총 {total}개 중)')
        )
