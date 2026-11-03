import { API_URL } from "../api/axios";

const API_ORIGIN = new URL(API_URL, window.location.origin).origin;

/**
 * profile_image from the API is either a full URL (Google picture) or a path of an uploaded file
 * ("profile_images/5/abc.png"). Uploaded files are served by the backend under /media/.
 */
export function mediaUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}/media/${path.replace(/^\/+/, "")}`;
}