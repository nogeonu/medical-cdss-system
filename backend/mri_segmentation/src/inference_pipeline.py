"""
End-to-End Inference Pipeline for Phase 1 Segmentation
One-stop solution for deployment team.
"""
import torch
from pathlib import Path
from monai.inferers import sliding_window_inference
import config
from models import create_segmentation_model
from inference_preprocess import preprocess_single_case
from inference_postprocess import postprocess_prediction, save_segmentation


class SegmentationInferencePipeline:
    """
    Complete inference pipeline: Preprocessing -> Model -> Postprocessing
    """
    
    def __init__(
        self, 
        model_path,
        device="cuda",
        threshold=0.5,
        use_ema=False
    ):
        """
        Initialize the inference pipeline.
        
        Args:
            model_path: Path to trained model checkpoint (.pth file)
            device: 'cuda' or 'cpu'
            threshold: Segmentation threshold (default: 0.5)
            use_ema: Whether to use EMA weights if available
        """
        self.device = device
        self.threshold = threshold
        self.use_ema = use_ema
        
        # Load model
        print(f"Loading model from: {model_path}")
        self.model = self._load_model(model_path)
        self.model.eval()
        print("Model loaded successfully!")
    
    def _load_model(self, checkpoint_path):
        """Load trained model from checkpoint."""
        # Create model architecture
        model = create_segmentation_model(
            use_lora=True,  # Assuming LoRA was used in training
            device=self.device
        )
        
        # Load weights
        checkpoint = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        
        # Handle different checkpoint formats
        if "model_state_dict" in checkpoint:
            state_dict = checkpoint["model_state_dict"]
        elif "ema_state_dict" in checkpoint and self.use_ema:
            state_dict = checkpoint["ema_state_dict"]
            print("Using EMA weights")
        else:
            state_dict = checkpoint
        
        model.load_state_dict(state_dict)
        return model
    
    def predict(self, image_path, output_path=None, return_probabilities=False, output_format="nifti"):
        """
        Run complete inference pipeline on a single case.
        
        Args:
            image_path: Path to input DCE-MRI NIfTI file or DICOM folder
            output_path: Optional path to save segmentation mask
            return_probabilities: If True, return probability map instead of binary mask
            output_format: 'nifti' or 'dicom' (requires input to be DICOM folder)
        
        Returns:
            dict: Results containing:
                - 'segmentation': Binary mask (or probabilities if requested)
                - 'tumor_detected': Boolean indicating if tumor was found
                - 'tumor_volume_voxels': Number of positive voxels
        """
        print(f"\n{'='*60}")
        print(f"Processing: {Path(image_path).name}")
        print(f"{'='*60}")
        
        # 1. Preprocessing
        print("Step 1/3: Preprocessing...")
        # Note: preprocess_single_case currently optimized for NIfTI
        # If input is DICOM folder, ensure it converts/loads correctly.
        # For now, assuming preprocess_single_case handles the loading (via MONAI LoadImaged)
        preprocessed = preprocess_single_case(image_path)
        image_tensor = preprocessed["image"].to(self.device)
        
        # Extract meta_dict from preprocessed data
        # MONAI LoadImaged stores metadata in image.meta, not image_meta_dict
        from monai.data import MetaTensor
        meta_dict = preprocessed.get("image_meta_dict", None)
        if meta_dict is None and isinstance(preprocessed["image"], MetaTensor):
            # Extract from MetaTensor.meta if image_meta_dict not available
            meta_dict = dict(preprocessed["image"].meta)
        
        print(f"  Input shape: {image_tensor.shape}")
        
        # 2. Model Inference
        print("Step 2/3: Running model inference...")
        with torch.no_grad():
            # Use sliding window inference for large volumes
            prediction = sliding_window_inference(
                inputs=image_tensor,
                roi_size=config.PATCH_SIZE,
                sw_batch_size=1,
                predictor=self.model,
                overlap=config.OVERLAP,
                mode="gaussian"  # Smooth blending
            )
            
            # Apply sigmoid to get probabilities
            probabilities = torch.sigmoid(prediction)
        
        print(f"  Output shape: {probabilities.shape}")
        print(f"  Probability range: [{probabilities.min():.3f}, {probabilities.max():.3f}]")
        
        # 3. Post-processing
        print("Step 3/3: Post-processing...")
        if return_probabilities:
            result_mask = probabilities.squeeze().cpu().numpy()
        else:
            result_mask = postprocess_prediction(
                probabilities,
                meta_dict,
                preprocessed_data=preprocessed,
                threshold=self.threshold,
                apply_morphology=True,
                restore_original_spacing=True
            )
        
        # Calculate statistics
        tumor_volume = int(result_mask.sum()) if not return_probabilities else int((result_mask > self.threshold).sum())
        tumor_detected = tumor_volume > 0
        
        print(f"  Tumor detected: {tumor_detected}")
        print(f"  Tumor volume: {tumor_volume} voxels")
        
        # Save if requested
        if output_path is not None and not return_probabilities:
            if output_format == "dicom":
                from inference_postprocess import save_as_dicom_seg
                # For DICOM SEG, we need the reference DICOM series path
                if Path(image_path).is_dir():
                    print("Generating DICOM SEG object...")
                    save_as_dicom_seg(result_mask, output_path, image_path)
                else:
                    print(f"Warning: Input is not a directory ({image_path}). Cannot generate DICOM SEG. Saving as NIfTI instead.")
                    save_segmentation(result_mask, str(output_path).replace('.dcm', '.nii.gz'), meta_dict)
            else:
                save_segmentation(result_mask, output_path, meta_dict)
        
        print(f"{'='*60}\n")
        
        return {
            "segmentation": result_mask,
            "tumor_detected": tumor_detected,
            "tumor_volume_voxels": tumor_volume,
            "probabilities": probabilities.cpu() if return_probabilities else None
        }


def main():
    """Example usage for deployment team."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Phase 1 Segmentation Inference")
    parser.add_argument("--model", required=True, help="Path to model checkpoint (.pth)")
    parser.add_argument("--input", required=True, help="Path to input NIfTI file")
    parser.add_argument("--output", default=None, help="Path to save segmentation mask")
    parser.add_argument("--threshold", type=float, default=0.5, help="Segmentation threshold")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    parser.add_argument("--use-ema", action="store_true", help="Use EMA weights if available")
    
    args = parser.parse_args()
    
    # Initialize pipeline
    pipeline = SegmentationInferencePipeline(
        model_path=args.model,
        device=args.device,
        threshold=args.threshold,
        use_ema=args.use_ema
    )
    
    # Run inference
    results = pipeline.predict(
        image_path=args.input,
        output_path=args.output
    )
    
    print("\n✅ Inference completed successfully!")
    print(f"Tumor detected: {results['tumor_detected']}")
    print(f"Tumor volume: {results['tumor_volume_voxels']} voxels")


if __name__ == "__main__":
    main()
