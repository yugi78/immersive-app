import type { SVGProps } from 'react';

/** Icônes du back-office : trait 1.8, couleur héritée (style Lucide, dessinées ici). */
const Svg = ({ children, size = 18, ...p }: SVGProps<SVGSVGElement> & { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    {children}
  </svg>
);
type P = { size?: number };

export const Icon = {
  logo: (p: P) => (
    <Svg {...p} strokeWidth={1.6}>
      <path d="M4 20h16M6 20v-7M10 20v-7M14 20v-7M18 20v-7M4 13h16M6 13a6 6 0 0 1 12 0M12 4v3" />
    </Svg>
  ),
  scene: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </Svg>
  ),
  camera: (p: P) => (
    <Svg {...p}>
      <path d="M3 8.5a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  ),
  cut: (p: P) => (
    <Svg {...p}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </Svg>
  ),
  route: (p: P) => (
    <Svg {...p}>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.5" />
    </Svg>
  ),
  map: (p: P) => (
    <Svg {...p}>
      <path d="M11 18l-2-1-6 3V7l6-3 6 3 6-3v7.5" />
      <path d="M9 4v13M15 7v5" />
      <circle cx="16.5" cy="17.5" r="2.5" />
      <path d="m18.5 19.5 2.5 2.5" />
    </Svg>
  ),
  layout: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </Svg>
  ),
  bug: (p: P) => (
    <Svg {...p}>
      <path d="M8 3v3M16 3v3M3 12h3M18 12h3M6 21l2-3M18 21l-2-3" />
      <rect x="7" y="6" width="10" height="12" rx="5" />
      <path d="M12 10v4" />
    </Svg>
  ),
  undo: (p: P) => (
    <Svg {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  ),
  redo: (p: P) => (
    <Svg {...p}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Svg>
  ),
  desktop: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </Svg>
  ),
  mobile: (p: P) => (
    <Svg {...p}>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </Svg>
  ),
  upload: (p: P) => (
    <Svg {...p} strokeWidth={2}>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </Svg>
  ),
  target: (p: P) => (
    <Svg {...p} strokeWidth={2}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 1v3M12 20v3M1 12h3M20 12h3" />
    </Svg>
  ),
  move: (p: P) => (
    <Svg {...p}>
      <path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" />
    </Svg>
  ),
  rotate: (p: P) => (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </Svg>
  ),
  eye: (p: P) => (
    <Svg {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  trash: (p: P) => (
    <Svg {...p}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  ),
  plus: (p: P) => (
    <Svg {...p} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  play: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <path d="M7 4.5v15l12-7.5z" />
    </Svg>
  ),
  stop: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Svg>
  ),
  arrowRight: (p: P) => (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  ),
  pin: (p: P) => (
    <Svg {...p}>
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  ),
  fly: (p: P) => (
    <Svg {...p}>
      <path d="M2 12h4l3-8 6 16 3-8h4" />
    </Svg>
  ),
  frame: (p: P) => (
    <Svg {...p}>
      <path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4" />
      <circle cx="12" cy="12" r="2.5" />
    </Svg>
  ),
  image: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </Svg>
  ),
  box: (p: P) => (
    <Svg {...p}>
      <path d="M12 3.2 19.6 7.6v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M4.4 7.6 12 12l7.6-4.4M12 12v8.8" />
    </Svg>
  ),
  chevronUp: (p: P) => (
    <Svg {...p} strokeWidth={2}>
      <path d="m6 15 6-6 6 6" />
    </Svg>
  ),
  chevronDown: (p: P) => (
    <Svg {...p} strokeWidth={2}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  grip: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </Svg>
  ),
  close: (p: P) => (
    <Svg {...p} strokeWidth={2}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  ),
  text: (p: P) => (
    <Svg {...p}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </Svg>
  ),
};
