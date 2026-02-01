"""
OCS Admin
"""
from django.contrib import admin
from .models import Order, OrderStatusHistory, DrugInteractionCheck, AllergyCheck, PathologyAnalysisResult


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


@admin.register(PathologyAnalysisResult)
class PathologyAnalysisResultAdmin(admin.ModelAdmin):
    list_display = ['id', 'order', 'class_name', 'confidence', 'has_dzi_url', 'created_at']
    list_filter = ['class_name', 'created_at']
    search_fields = ['order__id', 'order__patient__name', 'filename']
    readonly_fields = ['id', 'created_at', 'updated_at']
    list_editable = []  # list_editable에 넣지 않고 필드만 노출

    def has_dzi_url(self, obj):
        return bool(obj.dzi_url or obj.viewer_url)

    has_dzi_url.boolean = True
    has_dzi_url.short_description = 'DZI/뷰어 URL'

    fieldsets = (
        ('주문', {'fields': ('order',)}),
        ('분석 결과', {'fields': ('class_id', 'class_name', 'confidence', 'probabilities')}),
        ('이미지', {'fields': ('filename', 'image_url', 'dzi_url', 'viewer_url')}),
        ('소견', {'fields': ('findings', 'recommendations')}),
        ('메타', {'fields': ('id', 'analyzed_by', 'created_at', 'updated_at')}),
    )
