import logoAsset from "@/assets/iv-doc-logo.svg.asset.json";

export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <img
      src={logoAsset.url}
      alt="IV Doc"
      className={`rounded-lg ${className}`}
    />
  );
}
