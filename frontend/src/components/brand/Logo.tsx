import { createUniqueId, type Component } from "solid-js";

interface LogoProps {
  size?: number;
  class?: string;
}

/**
 * "Signal Hex" mark: a hexagon (network node) with a signal fanning out from
 * a single point (an IP Client reporting its address). Colors are fixed —
 * this is a brand mark, not part of the light/dark UI palette — so it reads
 * the same on both themes and at favicon scale (public/favicon.svg mirrors
 * this exact shape). The gradient id is instance-unique so two logos never
 * collide if both end up mounted on the same page at once.
 */
export const Logo: Component<LogoProps> = (props) => {
  const gradientId = `flux-logo-gradient-${createUniqueId()}`;
  return (
    <svg viewBox="0 0 100 100" width={props.size ?? 24} height={props.size ?? 24} class={props.class} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#7B76F5" />
          <stop offset="100%" stop-color="#5147E0" />
        </linearGradient>
      </defs>
      <polygon points="50,10 84.64,30 84.64,70 50,90 15.36,70 15.36,30" fill={`url(#${gradientId})`} />
      <circle cx="50" cy="72" r="4.5" fill="#FFFFFF" />
      <path d="M 41.34 67 A 10 10 0 0 1 58.66 67" fill="none" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round" />
      <path
        d="M 35.28 63.5 A 17 17 0 0 1 64.72 63.5"
        fill="none"
        stroke="#FFFFFF"
        stroke-width="4.2"
        stroke-linecap="round"
        opacity="0.75"
      />
      <path
        d="M 29.22 60 A 24 24 0 0 1 70.78 60"
        fill="none"
        stroke="#FFFFFF"
        stroke-width="4.2"
        stroke-linecap="round"
        opacity="0.5"
      />
    </svg>
  );
};
