
import { useEffect, useState } from "react";
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} from "../api/addresses";
import AccountLayout from "../Components/AccountLayout";
import ConfirmDialog from "../Components/ConfirmDialog";
import "../styles/address.css";

const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan",
  "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
  "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia",
  "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica", "Dominican Republic",
  "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia",
  "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana",
  "Haiti", "Honduras", "Hungary",
  "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Jamaica", "Japan", "Jordan",
  "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
  "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
  "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway",
  "Oman",
  "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
  "Qatar",
  "Romania", "Russia", "Rwanda",
  "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
  "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan",
  "Vanuatu", "Vatican City", "Venezuela", "Vietnam",
  "Yemen",
  "Zambia", "Zimbabwe",
];

const POSTAL_CODE_PATTERNS = {
  India: /^[1-9]\d{5}$/,
  "United States": /^\d{5}(?:-\d{4})?$/,
  Canada: /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/,
  "United Kingdom": /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/,
  Australia: /^\d{4}$/,
  "New Zealand": /^\d{4}$/,
  Japan: /^\d{3}-?\d{4}$/,
  Singapore: /^\d{6}$/,
  Germany: /^\d{5}$/,
  France: /^\d{5}$/,
  Spain: /^\d{5}$/,
  Italy: /^\d{5}$/,
  China: /^\d{6}$/,
  Mexico: /^\d{5}$/,
  Brazil: /^\d{5}-?\d{3}$/,
  Netherlands: /^\d{4}\s?[A-Z]{2}$/,
  Poland: /^\d{2}-\d{3}$/,
  Russia: /^\d{6}$/,
  "South Africa": /^\d{4}$/,
};

function getPostalCodeError(value, country) {
  const postalCode = value.trim().toUpperCase();
  if (!postalCode) return "Enter a postal code.";

  const pattern = POSTAL_CODE_PATTERNS[country];
  const isValid = pattern
    ? pattern.test(postalCode)
    : /^(?=.*\d)[A-Z0-9](?:[A-Z0-9 -]{1,10}[A-Z0-9])$/.test(postalCode);

  return isValid ? "" : `Check the postal code format for ${country}.`;
}

const emptyAddress = {
  full_name: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  district: "",
  state: "",
  postal_code: "",
  country: "India",
  address_type: "home",
  is_default: false,
};

export default function Address() {
  const [addresses, setAddresses] = useState([]);
  const [form, setForm] = useState(emptyAddress);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [postalCodeError, setPostalCodeError] = useState("");
  const [districtLookupResult, setDistrictLookupResult] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadAddresses() {
    setLoading(true);
    setError("");

    try {
      const response = await getAddresses();
      setAddresses(response.data);
    } catch (err) {
      setError(
        err.response?.status === 401
          ? "Please log in to manage your delivery addresses."
          : "Unable to load addresses. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // This initial load updates state only after the async request settles.
    void Promise.resolve().then(loadAddresses);
  }, []);

  useEffect(() => {
    const postalCode = form.postal_code.trim();
    if (form.country !== "India" || !/^[1-9]\d{5}$/.test(postalCode)) return undefined;
    if (form.district) return undefined;

    const controller = new AbortController();

    async function lookupDistrict() {
      try {
        const response = await fetch(
          `https://api.postalpincode.in/pincode/${postalCode}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("Postal lookup failed");

        const result = await response.json();
        const district = result[0]?.PostOffice?.[0]?.District;
        if (!district) {
          setDistrictLookupResult({ postalCode, message: "District not found. Enter it manually." });
          return;
        }

        setForm((previous) => {
          if (
            previous.country !== "India" ||
            previous.postal_code.trim() !== postalCode ||
            previous.district
          ) {
            return previous;
          }
          return { ...previous, district };
        });
        setDistrictLookupResult({ postalCode, message: "District filled automatically." });
      } catch (lookupError) {
        if (lookupError.name !== "AbortError") {
          setDistrictLookupResult({ postalCode, message: "Could not look up district. Enter it manually." });
        }
      }
    }

    lookupDistrict();
    return () => controller.abort();
  }, [form.country, form.district, form.postal_code]);

  const postalCode = form.postal_code.trim();
  const districtLookupStatus =
    form.country === "India" &&
    /^[1-9]\d{5}$/.test(postalCode) &&
    !form.district
      ? districtLookupResult?.postalCode === postalCode
        ? districtLookupResult.message
        : "Looking up district..."
      : "";

  function handleChange(event) {
    const { name, value, checked, type } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
      ...(name === "postal_code" || name === "country" ? { district: "" } : {}),
    }));

    if (name === "postal_code" && postalCodeError) {
      setPostalCodeError(getPostalCodeError(value, form.country));
    } else if (name === "country") {
      setPostalCodeError("");
    }

  }

  function startEdit(address) {
    setEditingId(address.id);
    setForm({
      full_name: address.full_name || "",
      phone: address.phone || "",
      address_line1: address.address_line1 || "",
      address_line2: address.address_line2 || "",
      city: address.city || "",
      district: address.district || "",
      state: address.state || "",
      postal_code: address.postal_code || "",
      country: address.country || "India",
      address_type: address.address_type || "home",
      is_default: address.is_default,
    });
    setNotice("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyAddress);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const postalError = getPostalCodeError(form.postal_code, form.country);
    if (postalError) {
      setPostalCodeError(postalError);
      return;
    }

    setPostalCodeError("");
    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (editingId) {
        await updateAddress(editingId, form);
        setNotice("Address updated successfully.");
      } else {
        await createAddress(form);
        setNotice("Address added successfully.");
      }

      setEditingId(null);
      setForm(emptyAddress);
      await loadAddresses();
    } catch (err) {
      const data = err.response?.data;
      const message =
        data && typeof data === "object"
          ? Object.values(data).flat().join(" ")
          : "Unable to save the address. Please try again.";

      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deletingId === null) return;

    setError("");
    setNotice("");

    try {
      setDeleting(true);
      await deleteAddress(deletingId);

      if (editingId === deletingId) {
        cancelEdit();
      }

      setNotice("Address deleted successfully.");
      await loadAddresses();
    } catch {
      setError("Unable to delete this address. Please try again.");
    } finally {
      setDeleting(false);
      setDeletingId(null);
    }
  }

  async function makeDefault(address) {
    setError("");
    setNotice("");

    try {
      await updateAddress(address.id, { is_default: true });
      setNotice("Default delivery address updated.");
      await loadAddresses();
    } catch {
      setError("Unable to change the default address.");
    }
  }

  return (
    <AccountLayout>
      <div className="address-page">
      <header className="address-heading">
        <p className="address-eyebrow">YOUR ACCOUNT</p>
        <h1>Delivery addresses</h1>
        <p>Manage where your Aurevo orders are delivered.</p>
      </header>

      {error && <p className="address-alert error">{error}</p>}
      {notice && <p className="address-alert success">{notice}</p>}

      <div className="address-layout">
        <section className="address-list-section">
          <div className="address-section-heading">
            <h2>Saved addresses</h2>
            <span>{addresses.length} saved</span>
          </div>

          {loading ? (
            <p className="address-empty">Loading addresses...</p>
          ) : addresses.length === 0 ? (
            <div className="address-empty">
              <h3>No saved addresses yet</h3>
              <p>Add an address to make future checkout easier.</p>
            </div>
          ) : (
            <div className="address-list">
              {addresses.map((address) => (
                <article className="address-card" key={address.id}>
                  <div className="address-card-top">
                    <span className="address-type">
                      {address.address_type}
                    </span>
                    {address.is_default && (
                      <span className="address-default">DEFAULT</span>
                    )}
                  </div>

                  <h3>{address.full_name}</h3>
                  <p>{address.phone}</p>
                  <p>{address.address_line1}</p>

                  {address.address_line2 && (
                    <p>{address.address_line2}</p>
                  )}

                  <p>
                      {address.city}{address.district ? `, ${address.district}` : ""}, {address.state} {address.postal_code}
                  </p>
                  <p>{address.country}</p>

                  <div className="address-card-actions">
                    <button
                      type="button"
                      onClick={() => startEdit(address)}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="address-delete"
                      onClick={() => setDeletingId(address.id)}
                    >
                      Delete
                    </button>

                    {!address.is_default && (
                      <button
                        type="button"
                        onClick={() => makeDefault(address)}
                      >
                        Set default
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="address-form-section">
          <h2>{editingId ? "Edit address" : "Add a new address"}</h2>

          <form className="address-form" onSubmit={handleSubmit}>
            <label>
              Full name
              <input
                name="full_name"
                value={form.full_name}
                onChange={handleChange}
                maxLength={150}
                required
              />
            </label>

            <label>
              Phone number
              <input
                name="phone"
                type="tel"
                value={form.phone}
                onChange={handleChange}
                maxLength={20}
                required
              />
            </label>

            <label>
              Address line 1
              <input
                name="address_line1"
                value={form.address_line1}
                onChange={handleChange}
                maxLength={255}
                required
              />
            </label>

            <label>
              Address line 2 (optional)
              <input
                name="address_line2"
                value={form.address_line2}
                onChange={handleChange}
                maxLength={255}
              />
            </label>

            <div className="address-form-row">
              <label>
                City
                <input
                  name="city"
                  value={form.city}
                  onChange={handleChange}
                  maxLength={100}
                  required
                />
              </label>

              <label>
                District
                <input
                  name="district"
                  value={form.district}
                  onChange={handleChange}
                  maxLength={100}
                  required
                />
                {districtLookupStatus && (
                  <span className="address-field-hint" role="status">
                    {districtLookupStatus}
                  </span>
                )}
              </label>
            </div>

            <div className="address-form-row">
              <label>
                State
                <input
                  name="state"
                  value={form.state}
                  onChange={handleChange}
                  maxLength={100}
                  required
                />
              </label>

              <label>
                Postal code
                <input
                  name="postal_code"
                  value={form.postal_code}
                  onChange={handleChange}
                  onBlur={() => setPostalCodeError(getPostalCodeError(form.postal_code, form.country))}
                  aria-invalid={Boolean(postalCodeError)}
                  aria-describedby={postalCodeError ? "postal-code-error" : undefined}
                  maxLength={12}
                  required
                />
                {postalCodeError && (
                  <span className="address-field-error" id="postal-code-error" role="alert">
                    {postalCodeError}
                  </span>
                )}
              </label>
            </div>

            <label>
              Country
              <select
                name="country"
                value={form.country}
                onChange={handleChange}
                required
              >
                {!COUNTRIES.includes(form.country) && form.country && (
                  <option value={form.country}>{form.country}</option>
                )}
                {COUNTRIES.map((country) => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </label>

            <label>
              Address type
              <select
                name="address_type"
                value={form.address_type}
                onChange={handleChange}
              >
                <option value="home">Home</option>
                <option value="work">Work</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="address-checkbox">
              <input
                type="checkbox"
                name="is_default"
                checked={form.is_default}
                onChange={handleChange}
              />
              Set as my default address
            </label>

            <button
              className="address-submit"
              type="submit"
              disabled={saving}
            >
              {saving
                ? "Saving..."
                : editingId
                  ? "Save changes"
                  : "Save address"}
            </button>

            {editingId && (
              <button
                className="address-cancel"
                type="button"
                onClick={cancelEdit}
              >
                Cancel editing
              </button>
            )}
          </form>
        </section>
      </div>
      {deletingId !== null && (
        <ConfirmDialog
          title="Delete this address?"
          text="This saved delivery address will be permanently removed."
          confirmLabel="Delete address"
          danger
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => {
            if (!deleting) setDeletingId(null);
          }}
        />
      )}
      </div>
    </AccountLayout>
  );
}
