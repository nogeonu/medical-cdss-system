from rest_framework import serializers
from .models import LabTest, RNATest
from patients.models import Patient


class LabTestSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.name', read_only=True)
    patient_id = serializers.CharField(source='patient.patient_id', read_only=True)
    patient_birth_date = serializers.DateField(source='patient.birth_date', read_only=True)
    patient_age = serializers.IntegerField(source='patient.age', read_only=True)
    patient_gender = serializers.CharField(source='patient.gender', read_only=True)
    
    class Meta:
        model = LabTest
        fields = '__all__'


class RNATestSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.name', read_only=True)
    patient_id = serializers.CharField(source='patient.patient_id', read_only=True)
    patient_birth_date = serializers.DateField(source='patient.birth_date', read_only=True)
    patient_age = serializers.IntegerField(source='patient.age', read_only=True)
    patient_gender = serializers.CharField(source='patient.gender', read_only=True)
    
    class Meta:
        model = RNATest
        fields = '__all__'
