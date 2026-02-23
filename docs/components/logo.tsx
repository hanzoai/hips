'use client';

interface LogoProps {
  size?: number;
  className?: string;
}

// Hanzo H mark SVG
function HanzoMark({ size = 24, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M4 4h4v7h8V4h4v16h-4v-5H8v5H4V4z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Logo({ size = 24, className = '' }: LogoProps) {
  return (
    <HanzoMark
      size={size}
      className={`transition-transform duration-200 ${className}`}
    />
  );
}

export function LogoWithText({ size = 24 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2 group logo-with-text">
      <Logo
        size={size}
        className="group-hover:scale-110"
      />
      <div className="relative h-6">
        <span className="font-bold text-lg inline-block transition-all duration-300 ease-out group-hover:opacity-0 group-hover:-translate-y-full">
          HIPs
        </span>
        <span className="font-bold text-lg absolute left-0 top-0 opacity-0 translate-y-full transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-y-0 whitespace-nowrap">
          Hanzo Proposals
        </span>
      </div>
    </div>
  );
}

export function LogoStatic({ size = 24, text = 'HIPs' }: { size?: number; text?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Logo size={size} />
      <span className="font-bold text-lg">{text}</span>
    </div>
  );
}
