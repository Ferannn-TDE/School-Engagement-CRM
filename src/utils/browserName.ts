/**
 * A browser's user-agent string as people say it: "Chrome 156 on Mac". Order matters:
 * Edge and Opera also say "Chrome", Chrome also says "Safari", and iPhones say "Mac OS X".
 * Falls back to the raw string when nothing matches.
 */
export function browserName(userAgent: string): string {
  const ua = userAgent;
  const version = (re: RegExp) => ua.match(re)?.[1]?.split('.')[0];
  const browser =
    (version(/Edg(?:e|A|iOS)?\/([\d.]+)/) && `Edge ${version(/Edg(?:e|A|iOS)?\/([\d.]+)/)}`) ||
    (version(/OPR\/([\d.]+)/) && `Opera ${version(/OPR\/([\d.]+)/)}`) ||
    (version(/(?:Firefox|FxiOS)\/([\d.]+)/) && `Firefox ${version(/(?:Firefox|FxiOS)\/([\d.]+)/)}`) ||
    (version(/(?:Chrome|CriOS)\/([\d.]+)/) && `Chrome ${version(/(?:Chrome|CriOS)\/([\d.]+)/)}`) ||
    (/Safari\//.test(ua) && version(/Version\/([\d.]+)/) && `Safari ${version(/Version\/([\d.]+)/)}`) ||
    null;
  const os =
    (/iPhone/.test(ua) && 'iPhone') ||
    (/iPad/.test(ua) && 'iPad') ||
    (/Android/.test(ua) && 'Android') ||
    (/CrOS/.test(ua) && 'ChromeOS') ||
    (/Macintosh|Mac OS X/.test(ua) && 'Mac') ||
    (/Windows/.test(ua) && 'Windows') ||
    (/Linux/.test(ua) && 'Linux') ||
    null;
  if (!browser) return ua;
  return os ? `${browser} on ${os}` : browser;
}
