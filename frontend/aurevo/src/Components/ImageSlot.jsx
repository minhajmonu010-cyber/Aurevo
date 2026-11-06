import { useState } from "react";

/** A picture with a coloured fallback: if the file is missing, the colour shows instead. */
export default function ImageSlot({
  src,
  alt = "",
  tint = "#1a2438",
  className = "",
  loading = "lazy",
  fetchPriority,
  children,
}) {
  const [broken, setBroken] = useState(false);

  return (
    <div className={`image-slot ${className}`.trim()} style={{ "--tint": tint }}>
      {src && !broken && (
        <img
          src={src}
          alt={alt}
          loading={loading}
          fetchPriority={fetchPriority}
          onError={() => setBroken(true)}
        />
      )}
      {children}
    </div>
  );
}