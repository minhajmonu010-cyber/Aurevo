import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { useObjectUrl } from "../utils/hooks";
import { Modal } from "./ui";

export default function ImageCropDialog({ file, onCancel, onComplete }) {
  const imageRef = useRef(null);
  const source = useObjectUrl(file);
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const onImageLoad = () => {
    setCrop({ unit: "%", x: 10, y: 10, width: 80, height: 80 });
    setCompletedCrop(null);
    setError("");
  };

  const useCrop = async () => {
    const image = imageRef.current;
    if (!image || !completedCrop?.width || !completedCrop?.height) {
      setError("Select an area of the image to crop.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(completedCrop.width * scaleX);
      canvas.height = Math.round(completedCrop.height * scaleY);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image cropping is unavailable in this browser.");

      context.drawImage(
        image,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("Could not crop this image.")),
          file.type,
          0.92
        );
      });
      const croppedFile = new File([blob], file.name, { type: file.type, lastModified: Date.now() });
      await onComplete(croppedFile);
    } catch (cropError) {
      setError(cropError.message || "Could not crop this image.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <Modal
      eyebrow="Image editor"
      title="Crop image"
      width={760}
      onClose={onCancel}
      locked={saving}
      footer={
        <>
          <button type="button" className="ad-btn ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="ad-btn primary" onClick={useCrop} disabled={saving || !completedCrop?.width}>
            {saving ? "Applying crop…" : "Use cropped image"}
          </button>
        </>
      }
    >
      <p className="ad-section-sub">Drag and resize the selection to choose any crop shape.</p>
      <div className="ad-image-crop">
        {source && (
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            onComplete={(pixelCrop) => {
              setCompletedCrop(pixelCrop);
              if (pixelCrop.width && pixelCrop.height) setError("");
            }}
            ruleOfThirds
          >
            <img ref={imageRef} src={source} alt="Choose the area to crop" onLoad={onImageLoad} />
          </ReactCrop>
        )}
      </div>
      {error && <p className="ad-field-error" role="alert">{error}</p>}
    </Modal>,
    document.body
  );
}
