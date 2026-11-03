/**
 * Turns an axios error into { fields, form, code }.
 *  fields: { email: "...", password: "..." }  (shown under each input)
 *  form:   one message for the whole form
 *  code:   machine-readable code from the API, e.g. "email_not_verified"
 */
export function parseApiError(error) {
  const data = error.response?.data;

  if (!error.response) {
    return { fields: {}, form: "Can't reach the server. Check your connection and try again.", code: "network" };
  }
  if (!data || typeof data !== "object") {
    return { fields: {}, form: "Something went wrong. Please try again.", code: "unknown" };
  }

  const fields = {};
  let form = data.detail || "";
  for (const [key, value] of Object.entries(data)) {
    if (key === "detail" || key === "code" || key === "email") {
      if (key === "email" && value) fields.email = Array.isArray(value) ? value[0] : String(value);
      continue;
    }
    const message = Array.isArray(value) ? value[0] : String(value);
    if (key === "non_field_errors") form = message;
    else fields[key] = message;
  }
  if (!form && Object.keys(fields).length === 0) form = "Something went wrong. Please try again.";
  return { fields, form, code: data.code || "" };
}