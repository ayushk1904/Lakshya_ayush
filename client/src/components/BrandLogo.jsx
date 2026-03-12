import lakshyaLogo from "../assets/lakshya-logo.png";

function BrandLogo({ compact = false, className = "" }) {
  const classes = ["brand-logo", compact ? "brand-logo-compact" : "", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <img className="brand-logo-art" src={lakshyaLogo} alt="Lakshya logo" />
    </div>
  );
}

export default BrandLogo;
