import { useState } from "react";
import { mediaUrl } from "../utils/media";

/**
 * The user's picture, or their initials when there is none.
 * Pass `src` to show something else (for example a preview before saving); `src={null}` forces the initials.
 */
export default function Avatar({ user, size = 40, glow = false, src }) {
  const url = src !== undefined ? src : mediaUrl(user?.profile_image);
  const [failedUrl, setFailedUrl] = useState(null);

  const name = user?.full_name || user?.email || "?";
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?";

  return (
    <span className={`avatar${glow ? " glow" : ""}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {url && failedUrl !== url ? <img src={url} alt="" onError={() => setFailedUrl(url)} /> : <span aria-hidden="true">{initials}</span>}
    </span>
  );
}