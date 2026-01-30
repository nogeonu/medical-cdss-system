from django.db import models
from patients.models import Patient


class LabTest(models.Model):
    """혈액검사 결과"""
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='lab_tests')
    accession_number = models.CharField(max_length=50, unique=True)
    test_date = models.DateField()
    result_date = models.DateField()
    
    # 혈액검사 항목들
    wbc = models.FloatField(null=True, blank=True, verbose_name='WBC')
    wbc_unit = models.CharField(max_length=20, default='x10^9/L')
    
    hemoglobin = models.FloatField(null=True, blank=True, verbose_name='Hemoglobin')
    hemoglobin_unit = models.CharField(max_length=20, default='g/dL')
    
    neutrophils = models.FloatField(null=True, blank=True, verbose_name='Neutrophils')
    neutrophils_unit = models.CharField(max_length=20, default='x10^9/L')
    
    lymphocytes = models.FloatField(null=True, blank=True, verbose_name='Lymphocytes')
    lymphocytes_unit = models.CharField(max_length=20, default='x10^9/L')
    
    platelets = models.FloatField(null=True, blank=True, verbose_name='Platelets')
    platelets_unit = models.CharField(max_length=20, default='x10^9/L')
    
    nlr = models.FloatField(null=True, blank=True, verbose_name='NLR')
    
    crp = models.FloatField(null=True, blank=True, verbose_name='CRP')
    crp_unit = models.CharField(max_length=20, default='mg/L')
    
    ldh = models.FloatField(null=True, blank=True, verbose_name='LDH')
    ldh_unit = models.CharField(max_length=20, default='U/L')
    
    albumin = models.FloatField(null=True, blank=True, verbose_name='Albumin')
    albumin_unit = models.CharField(max_length=20, default='g/dL')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-test_date', '-created_at']
        verbose_name = 'Lab Test'
        verbose_name_plural = 'Lab Tests'
    
    def __str__(self):
        return f"{self.accession_number} - {self.patient.name} ({self.test_date})"


class RNATest(models.Model):
    """유전체검사 결과 (27개 유전자 발현)"""
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='rna_tests')
    accession_number = models.CharField(max_length=50, unique=True)
    test_date = models.DateField()
    result_date = models.DateField()
    
    # 27개 유전자 발현값
    CXCL13 = models.FloatField(null=True, blank=True)
    CD8A = models.FloatField(null=True, blank=True)
    CCR7 = models.FloatField(null=True, blank=True)
    C1QA = models.FloatField(null=True, blank=True)
    LY9 = models.FloatField(null=True, blank=True)
    CXCL10 = models.FloatField(null=True, blank=True)
    CXCL9 = models.FloatField(null=True, blank=True)
    STAT1 = models.FloatField(null=True, blank=True)
    CCND1 = models.FloatField(null=True, blank=True)
    MKI67 = models.FloatField(null=True, blank=True)
    TOP2A = models.FloatField(null=True, blank=True)
    BRCA1 = models.FloatField(null=True, blank=True)
    RAD51 = models.FloatField(null=True, blank=True)
    PRKDC = models.FloatField(null=True, blank=True)
    POLD3 = models.FloatField(null=True, blank=True)
    POLB = models.FloatField(null=True, blank=True)
    LIG1 = models.FloatField(null=True, blank=True)
    ERBB2 = models.FloatField(null=True, blank=True)
    ESR1 = models.FloatField(null=True, blank=True)
    PGR = models.FloatField(null=True, blank=True)
    ARAF = models.FloatField(null=True, blank=True)
    PIK3CA = models.FloatField(null=True, blank=True)
    AKT1 = models.FloatField(null=True, blank=True)
    MTOR = models.FloatField(null=True, blank=True)
    TP53 = models.FloatField(null=True, blank=True)
    PTEN = models.FloatField(null=True, blank=True)
    MYC = models.FloatField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-test_date', '-created_at']
        verbose_name = 'RNA Test'
        verbose_name_plural = 'RNA Tests'
    
    def __str__(self):
        return f"{self.accession_number} - {self.patient.name} ({self.test_date})"
