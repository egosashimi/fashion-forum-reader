// Tiny inline icon set (stroke icons, 1em) to avoid an icon dependency.
import type { SVGProps } from 'react';

const base = (d: string, fill = false) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        <path d={d} />
      </svg>
    );
  };

export const IconBookmark = base('M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z');
export const IconBookmarkFilled = base('M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z', true);
export const IconExternal = base('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3');
export const IconReplies = base('M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z');
export const IconViews = base('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z');
export const IconPin = base('M12 17v5M9 10.8V4h6v6.8l3 3.2v2H6v-2z');
export const IconLock = base('M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4');
export const IconEdit = base('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z');
export const IconSun = base('M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4');
export const IconMoon = base('M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z');
export const IconFeed = base('M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z');
export const IconTrophy = base('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3');
export const IconSearch = base('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3');
export const IconEye = base('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z');
export const IconLibrary = base('M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5');
export const IconCheck = base('M20 6L9 17l-5-5');
export const IconClose = base('M18 6L6 18M6 6l12 12');
export const IconInfo = base('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01');
