export const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

// The server is the final judge (common passwords, similarity to your email, ...).
export function passwordProblem(value) {
  if (value.length < 8) return "Password must be at least 8 characters long.";
  if (/^\d+$/.test(value)) return "Password can't be only numbers.";
  return "";
}