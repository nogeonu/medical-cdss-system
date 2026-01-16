"""
OCS Admin
"""
from django.contrib import admin
from .models import Order, OrderStatusHistory, DrugInteractionCheck, AllergyCheck


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'order_type', 'patient', 'doctor', 'status', 'priority',
        'target_department', 'validation_passed', 'created_at'
    ]
    list_filter = ['order_type', 'status', 'priority', 'target_department', 'validation_passed', 'created_at']
    search_fields = ['patient__name', 'patient__patient_number', 'doctor__username', 'notes']
    readonly_fields = ['id', 'created_at', 'updated_at', 'completed_at']
    date_hierarchy = 'created_at'
    
    fieldsets = (
        ('기본 정보', {
            'fields': ('id', 'order_type', 'patient', 'doctor', 'status', 'priority')
        }),
        ('주문 내용', {
            'fields': ('order_data', 'target_department', 'due_time', 'notes')
        }),
        ('검증', {
            'fields': ('validation_passed', 'validation_notes')
        }),
        ('일시', {
            'fields': ('created_at', 'updated_at', 'completed_at')
        }),
    )


@admin.register(OrderStatusHistory)
class OrderStatusHistoryAdmin(admin.ModelAdmin):
    list_display = ['order', 'status', 'changed_by', 'created_at']
    list_filter = ['status', 'created_at']
    search_fields = ['order__id', 'changed_by__username', 'notes']
    readonly_fields = ['created_at']
    date_hierarchy = 'created_at'


@admin.register(DrugInteractionCheck)
class DrugInteractionCheckAdmin(admin.ModelAdmin):
    list_display = ['order', 'severity', 'checked_at', 'checked_by']
    list_filter = ['severity', 'checked_at']
    search_fields = ['order__id', 'checked_by__username']
    readonly_fields = ['checked_at']


@admin.register(AllergyCheck)
class AllergyCheckAdmin(admin.ModelAdmin):
    list_display = ['order', 'has_allergy_risk', 'checked_at', 'checked_by']
    list_filter = ['has_allergy_risk', 'checked_at']
    search_fields = ['order__id', 'checked_by__username']
    readonly_fields = ['checked_at']
