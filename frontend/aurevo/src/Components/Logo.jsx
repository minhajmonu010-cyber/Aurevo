import Icon from "./Icon";

export const BRAND_NAME = "Aurevo";

export default function Logo() {
  return (
    <div className="brand-logo">
      <span className="brand-mark">
        <Icon name="aurevo" size={20} />
      </span>
      <span className="brand-name">{BRAND_NAME.toUpperCase()}</span>
    </div>
  );
}