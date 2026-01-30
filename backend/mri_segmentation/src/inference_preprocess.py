"""
Preprocessing Module for Phase 1 Segmentation Inference
Matches the exact preprocessing pipeline used during training.
"""
import torch
import numpy as np
from monai.transforms import (
    Compose, LoadImaged, EnsureChannelFirstd, Orientationd,
    Spacingd, NormalizeIntensityd, EnsureTyped
)
import config


def get_inference_transforms():
    """
    Returns the preprocessing transform pipeline for inference.
    Must match the training preprocessing exactly.
    """
    return Compose([
        LoadImaged(keys=["image"], image_only=False),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes="RAS"),
        Spacingd(
            keys=["image"],
            pixdim=config.SPACING,
            mode="bilinear"
        ),
        # Select first 4 sequences (matching training)
        # This assumes input has shape [C, H, W, D] where C >= 4
        NormalizeIntensityd(keys=["image"], nonzero=True, channel_wise=True),
        EnsureTyped(keys=["image"], dtype=torch.float32)
    ])


def preprocess_single_case(image_path, num_sequences=4):
    """
    Preprocess a single DCE-MRI case for inference.
    
    Args:
        image_path: Path to either:
            - A single multi-sequence NIfTI file (e.g., patient_001.nii.gz)
            - A folder containing individual sequence files (e.g., DUKE_001/)
        num_sequences: Number of sequences to use (default: 4, matching training)
    
    Returns:
        dict: Preprocessed data dictionary with keys:
            - 'image': Tensor of shape [1, 4, H, W, D] (batch dimension added)
            - 'image_meta_dict': Metadata for coordinate restoration
    """
    from pathlib import Path
    import glob
    
    image_path = Path(image_path)
    
    # Check if input is a directory (multi-file case)
    if image_path.is_dir():
        # Try to find NIfTI files first
        sequence_files = sorted(glob.glob(str(image_path / "*.nii.gz")))
        sequence_files = [f for f in sequence_files if "metadata" not in f.lower()]
        
        # If no NIfTI files, check for DICOM files
        if len(sequence_files) == 0:
            dicom_files = sorted(glob.glob(str(image_path / "*.dcm")))
            
            # If no DICOM files in root, check subdirectories (e.g., seq_0, seq_1, ...)
            if len(dicom_files) == 0:
                subdirs = sorted([d for d in image_path.iterdir() if d.is_dir()])
                if len(subdirs) > 0:
                    # Check if subdirectories contain DICOM files
                    first_subdir_dcm = list(subdirs[0].glob("*.dcm"))
                    if len(first_subdir_dcm) > 0:
                        # Use subdirectories as sequence folders
                        sequence_folders = subdirs[:num_sequences]
                        if len(sequence_folders) < num_sequences:
                            raise ValueError(
                                f"Found {len(sequence_folders)} DICOM sequence folders in {image_path}, "
                                f"but {num_sequences} required."
                            )
                        print(f"  Loading {len(sequence_folders)} DICOM sequence folders...")
                        image_input = [str(d) for d in sequence_folders]
                    else:
                        raise FileNotFoundError(f"No .nii.gz or .dcm files found in {image_path} or subdirectories")
                else:
                    raise FileNotFoundError(f"No .nii.gz or .dcm files found in {image_path}")
            else:
                # DICOM files found in root directory
                print(f"  Loading DICOM series from folder ({len(dicom_files)} files)...")
                image_input = str(image_path)
        else:
            # Select first N sequences (matching training)
            sequence_files = sequence_files[:num_sequences]
            
            if len(sequence_files) < num_sequences:
                raise ValueError(
                    f"Found {len(sequence_files)} sequences in {image_path}, "
                    f"but {num_sequences} required."
                )
            
            print(f"  Loading {len(sequence_files)} sequence files from folder...")
            image_input = sequence_files
    else:
        # Single file case
        if not image_path.exists():
            raise FileNotFoundError(f"File not found: {image_path}")
        image_input = str(image_path)
    
    transforms = get_inference_transforms()
    
    # Load and preprocess
    data = {"image": image_input}
    preprocessed = transforms(data)
    
    # CRITICAL: pixdim 명시적 저장 (Invertd 성공을 위해)
    # Spacingd 적용 후 MetaTensor에 spacing은 있지만 pixdim이 없을 수 있음
    from monai.data import MetaTensor
    image = preprocessed["image"]
    
    if isinstance(image, MetaTensor):
        original_spacing = image.meta.get("spacing", None)
        if original_spacing is not None and "pixdim" not in image.meta:
            # spacing을 pixdim 형식으로 변환하여 저장
            # NIfTI pixdim 형식: [1.0, x, y, z, ...]
            if hasattr(original_spacing, 'tolist'):
                spacing_list = original_spacing.tolist()
            elif hasattr(original_spacing, '__iter__') and not isinstance(original_spacing, str):
                spacing_list = list(original_spacing)
            else:
                spacing_list = [original_spacing]
            
            # 최소 3개 요소 확보 (x, y, z)
            if len(spacing_list) >= 3:
                # NIfTI pixdim 형식: [1.0, x, y, z]
                pixdim = np.array([1.0] + spacing_list[:3], dtype=np.float32)
                image.meta["pixdim"] = pixdim
                # image_meta_dict에도 저장 (postprocess_prediction에서 사용)
                if "image_meta_dict" not in preprocessed:
                    preprocessed["image_meta_dict"] = {}
                preprocessed["image_meta_dict"]["pixdim"] = pixdim
                preprocessed["image_meta_dict"]["spacing"] = original_spacing
                if "spatial_shape" in image.meta:
                    preprocessed["image_meta_dict"]["spatial_shape"] = image.meta["spatial_shape"]
                print(f"  DEBUG: pixdim 저장 완료: {pixdim}")
    
    # Ensure we have the right number of sequences
    if image.shape[0] > num_sequences:
        image = image[:num_sequences]
    elif image.shape[0] < num_sequences:
        raise ValueError(
            f"Input has {image.shape[0]} sequences, but {num_sequences} required. "
            f"Please check your DCE-MRI data."
        )
    
    # Add batch dimension
    preprocessed["image"] = image.unsqueeze(0)  # [1, 4, H, W, D]
    
    return preprocessed


if __name__ == "__main__":
    # Example usage
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python inference_preprocess.py <path_to_nifti>")
        sys.exit(1)
    
    test_path = sys.argv[1]
    print(f"Preprocessing: {test_path}")
    
    result = preprocess_single_case(test_path)
    print(f"Output shape: {result['image'].shape}")
    print(f"Value range: [{result['image'].min():.3f}, {result['image'].max():.3f}]")
    print("Preprocessing successful!")
