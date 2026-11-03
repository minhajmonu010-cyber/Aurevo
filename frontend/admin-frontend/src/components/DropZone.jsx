import { useRef, useState } from "react";
import Icon from "./Icon";

export const MAX_MB = 5;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Drag and drop (or click) to choose pictures. Checks the type and size, then calls onFiles(validFiles). */
export default function DropZone({ onFiles, multiple = false, title = "Drag & drop a picture, or", hint, compact = false, onError }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const take = (list) => {
    const files = Array.from(list || []);
    const good = files.filter((f) => TYPES.includes(f.type) && f.size <= MAX_MB * 1024 * 1024);
    if (good.length !== files.length) onError?.(`Use JPG, PNG or WebP pictures up to ${MAX_MB} MB.`);
    else onError?.("");
    if (good.length) onFiles(multiple ? good : good.slice(0, 1));
    if (input.current) input.current.value = "";
  };

  return (
    <div
      className={`ad-drop${over ? " over" : ""}${compact ? " compact" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      <input ref={input} type="file" accept={TYPES.join(",")} multiple={multiple} hidden onChange={(e) => take(e.target.files)} />
      <span className="ad-drop-icon">
        <Icon name="image-plus" size={compact ? 18 : 22} />
      </span>
      <p>
        {title}{" "}
        <button type="button" className="ad-link" onClick={() => input.current?.click()}>
          browse files
        </button>
      </p>
      <small>{hint || `PNG, WEBP, JPG (max ${MAX_MB} MB)`}</small>
    </div>
  );
}
