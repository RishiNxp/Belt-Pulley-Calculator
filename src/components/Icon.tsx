import type { ReactNode } from 'react';

export type IconName =
  | 'brand' | 'folder' | 'save' | 'gear' | 'info' | 'plus' | 'pointer' | 'pan'
  | 'pulley' | 'tensioner' | 'belt' | 'ruler' | 'horizontal' | 'vertical'
  | 'trash' | 'fit' | 'home' | 'reset' | 'undo' | 'redo' | 'arrow-right'
  | 'grid' | 'layers' | 'chevron-down' | 'check' | 'close' | 'unlock';

const artwork: Record<IconName, ReactNode> = {
  brand: <><path d="M3.5 8.5h2.1M18.4 8.5h2.1M7.7 8.5a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0-7.6 0Z"/><path d="M4 15.5h2.3m11.4 0H20M8 15.5a4 4 0 1 0 8 0a4 4 0 1 0-8 0Z"/></>,
  folder: <><path d="M3.5 7.5h6l1.7 2H20a1.5 1.5 0 0 1 1.5 1.5v6.8a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7V9a1.5 1.5 0 0 1 1-1.5Z"/><path d="M2.8 12.2h18.4"/></>,
  save: <><path d="M5 3.5h12.4L20.5 7v13.5H3.5v-17Z"/><path d="M7 3.8v5h9v-5M7 20v-7h10v7"/></>,
  gear: <><path d="m9.8 3.5-.5 2.1a7 7 0 0 0-1.8 1l-2-.7-1.7 3 1.5 1.5a7 7 0 0 0 0 2.1l-1.5 1.5 1.7 3 2-.7a7 7 0 0 0 1.8 1l.5 2.2h3.5l.5-2.2a7 7 0 0 0 1.8-1l2 .7 1.7-3-1.5-1.5a7 7 0 0 0 0-2.1l1.5-1.5-1.7-3-2 .7a7 7 0 0 0-1.8-1l-.5-2.1Z"/><circle cx="11.5" cy="11.5" r="2.6"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 10.7v5.1M12 7.5h.01"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  pointer: <path d="m5 3 13 10-6 .7-3.2 5.3L5 3Z"/>,
  pan: <><path d="m12 2.8 2.5 2.5L12 7.8 9.5 5.3 12 2.8ZM12 16.2l2.5 2.5-2.5 2.5-2.5-2.5 2.5-2.5ZM2.8 12l2.5-2.5L7.8 12l-2.5 2.5L2.8 12ZM16.2 12l2.5-2.5 2.5 2.5-2.5 2.5-2.5-2.5Z"/><circle cx="12" cy="12" r="2.2"/></>,
  pulley: <><circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.1"/><path d="M12 3.6v2M20.4 12h-2M12 20.4v-2M3.6 12h2"/></>,
  tensioner: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1"/></>,
  belt: <><path d="M7 6.5h10a5.5 5.5 0 0 1 0 11H7a5.5 5.5 0 0 1 0-11Z"/><path d="M7.2 6.8 9 8.6M17 15.4l1.8 1.8"/></>,
  ruler: <><path d="m4 17 13-13 3 3L7 20l-3-3Z"/><path d="m13.5 7.5 2 2M10.5 10.5l2 2M7.5 13.5l2 2"/></>,
  horizontal: <><path d="M4 9.5h16M7 14.5h10"/><path d="m4 9.5 2-2m-2 2 2 2m14-2-2-2m2 2-2 2"/></>,
  vertical: <><path d="M9.5 4v16M14.5 7v10"/><path d="m9.5 4-2 2m2-2 2 2m-2 14-2-2m2 2 2-2"/></>,
  trash: <><path d="M4.5 7h15M9 7V4.5h6V7m-8.5 0 1 13h9l1-13M10 10.5v6M14 10.5v6"/></>,
  fit: <><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/><path d="m4.5 4.5 5 5m10-5-5 5m-10 10 5-5m10 5-5-5"/></>,
  home: <><path d="m3.5 10 8.5-6.5 8.5 6.5M5.5 9v11h13V9M9.5 20v-6h5v6"/></>,
  reset: <><path d="M4.5 10a7.8 7.8 0 1 1-.1 4.5"/><path d="M4.5 4.8V10h5.2"/></>,
  undo: <><path d="m8 7-4 4 4 4M4.5 11h9a5.5 5.5 0 0 1 0 11"/></>,
  redo: <><path d="m16 7 4 4-4 4m3.5-4h-9a5.5 5.5 0 0 0 0 11"/></>,
  'arrow-right': <><path d="M4 12h15M13 6l6 6-6 6"/></>,
  grid: <><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M9.2 3.5v17m5.6-17v17m5.7-11.3h-17m17 5.6h-17"/></>,
  layers: <><path d="m12 3 9 4.7-9 4.8-9-4.8L12 3Z"/><path d="m3 12 9 4.8 9-4.8M3 16.4l9 4.8 9-4.8"/></>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  check: <path d="m5 12.5 4.2 4.2L19 7"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  unlock: <><rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.6-1.7"/></>,
};

export default function Icon({ name, size = 18, strokeWidth = 1.8, className }: {
  name: IconName; size?: number; strokeWidth?: number; className?: string;
}) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {artwork[name]}
  </svg>;
}
